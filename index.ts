import axios from 'axios';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as nodemailer from 'nodemailer';

dotenv.config();

// Environment variables
const telegramToken = process.env.TELEGRAM_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || '465');
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;
const recipientEmail = process.env.RECIPIENT_EMAIL;
const uniswapVersion = process.env.UNISWAP_VERSION || 'v3'; // Default to v3
const notificationTreashold = parseFloat(process.env.EMAIL_THRESHOLD || '500000');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const UNISWAP_GRAPH_URL = process.env[`UNISWAP_${uniswapVersion!.toUpperCase()}_GRAPH_URL`];
const notificationSendInterval = parseInt(process.env.NOTIFICATION_SEND_INTERVAL || '60000');
const notificationType = process.env.NOTIFICATION_TYPE || 'email';

let lastTimestamp = Math.floor(Date.now() / 1000);

// Initialize Redis client
const redis = new Redis(redisUrl!);
let transporter: nodemailer.Transporter | undefined;
if (notificationType === 'email') {
    // Email setup
    transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: true,
        auth: {
            user: emailUser,
            pass: emailPass,
        },
    });
}

const querySwaps = async (): Promise<Swap[]> => {
    const query = uniswapVersion === 'v2' ?
        `{
            swaps(where: {timestamp_gt: ${lastTimestamp}}, orderBy: timestamp, orderDirection: asc, first: 1000) {
                id
                pair {
                    token0 {
                        symbol
                    }
                    token1 {
                        symbol
                    }
                    reserveUSD 
                }
                amountUSD
                timestamp
            }
        }` :
        `{
            swaps(where: {timestamp_gt: ${lastTimestamp}}, orderBy: timestamp, orderDirection: asc, first: 1000) {
                id
                pool {
                    token0 {
                        symbol
                    }
                    token1 {
                        symbol
                    }
                    totalValueLockedUSD 
                    feeTier
                }
                amountUSD
                timestamp
            }
        }`;

    try {
        const response = await axios.post(UNISWAP_GRAPH_URL!, { query });
        if (response.data.data.swaps.length > 0) {
            lastTimestamp = response.data.data.swaps[response.data.data.swaps.length - 1].timestamp;
        }
        return response.data.data.swaps;
    } catch (error) {
        console.error('Error fetching swaps from The Graph', error);
        return [];
    }
};


async function updateVolumes(swaps: Swap[]) {
    for (const swap of swaps) {
        // Determine the pair name
        const pair = swap.pair ? `${swap.pair.token0.symbol}-${swap.pair.token1.symbol}` : `${swap.pool!.token0.symbol}-${swap.pool!.token1.symbol}`;

        // Extract volume and feeTier
        const volumeUSD = parseFloat(swap.amountUSD);
        const feeTier = swap.pool ? swap.pool.feeTier : 'unknownFeeTier'; // Default feeTier in case it's not provided

        // Get current values from Redis
        const currentVolumeKey = `volume_${pair}-${feeTier}`;
        const currentVolume = parseFloat(await redis.get(currentVolumeKey) || '0');

        const currentFeesKey = `fees_${pair}-${feeTier}`;
        const currentFees = parseFloat(await redis.get(currentFeesKey) || '0');

        const currentTVLKey = `tvl_${pair}-${feeTier}`;
        const currentTVL = parseFloat(await redis.get(currentTVLKey) || '0');

        // Calculate new values
        const newVolume = currentVolume + volumeUSD;
        const feeRate = parseFloat(feeTier) / 10000; // Convert basis points to a decimal
        const feesUSD = volumeUSD * feeRate;
        const newFees = currentFees + feesUSD;

        // Assuming `swap.pool.liquidity` or `swap.pool.totalValueLockedUSD` represents TVL
        let liquidity = 0;
        if (uniswapVersion === 'v2') {
            liquidity = parseFloat(swap.pool!.reserveUSD); // Adjusted for v2 structure
        } else {
            liquidity = parseFloat(swap.pool!.totalValueLockedUSD);
        }
        const tvl = liquidity + currentTVL; // Assuming we want to aggregate TVL, adjust this logic if needed

        // Update Redis with new volume, TVL, and fees
        await redis.set(currentVolumeKey, newVolume.toString(), 'EX', 4 * 60 * 60); // Set TTL for 4 hours
        await redis.set(currentTVLKey, tvl.toString(), 'EX', 4 * 60 * 60); // Store TVL with same TTL
        await redis.set(currentFeesKey, newFees.toString(), 'EX', 4 * 60 * 60); // Store fees with same TTL
    }
}


async function checkAndSendNotification() {
    console.log(Date.now(), ': Checking and sending notification...');
    const volumeData = []; // Array to hold key-volume pairs along with their TVL and fees

    // Fetch all keys from Redis
    const keys = await redis.keys('volume_*'); // This pattern matches only volume keys

    // Extract unique pair-feeTier combinations from keys
    const uniqueKeys = new Set(keys.map(key => key.replace('volume_', '')));
    console.log('Unique Keys:', uniqueKeys);
    const lpSize = 1000; // Assuming LP size is $1000, adjust this if needed

    for (const uniqueKey of Array.from(uniqueKeys)) {
        const [pair, feeTier] = uniqueKey.split('_');
        const volumeKey = `volume_${uniqueKey}`;
        const tvlKey = `tvl_${uniqueKey}`;
        const feesKey = `fees_${uniqueKey}`;

        const volume = parseFloat(await redis.get(volumeKey) || '0');
        const tvl = parseFloat(await redis.get(tvlKey) || '0');
        const fees = parseFloat(await redis.get(feesKey) || '0');
        // Calculate TVL/fee ratio, ensure no division by zero
        const tvlFeeRatio = tvl !== 0 ? (fees / tvl) * lpSize : 0;

        console.log('Key:', uniqueKey, 'Volume:', volume, 'TVL:', tvl, 'Fees:', fees, 'TVL/Fee Ratio:', tvlFeeRatio);

        if (tvlFeeRatio > notificationTreashold && tvl > 10000) {
            volumeData.push({ key: uniqueKey, volume, tvl, fees, tvlFeeRatio }); // Include all metrics for messaging
        }
    }

    // Sort the pairs by TVL in descending order
    volumeData.sort((a, b) => b.tvlFeeRatio - a.tvlFeeRatio);

    console.log('High volume pairs:', volumeData);

    // Convert sorted data into message format
    const highVolumePairs = volumeData.map(data => `${data.key} (Fee Tier: ${data.key.split('-')[1]}): $${data.volume.toLocaleString()} (TVL: $${data.tvl.toLocaleString()}, Fees: $${data.fees.toLocaleString()}, Fee/TVL Earnings for ${lpSize}$ LP: ${data.tvlFeeRatio.toFixed(2)})`);

    if (highVolumePairs.length > 0) {
        let message = `**Uniswap High Volume Pairs:**\n\n`;
        const baseMessageLength = message.length;
        const telegramApiUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;

        for (const pairMessage of highVolumePairs) {
            if (message.length + pairMessage.length + 1 > 4000) { // +1 for newline
                try {
                    console.log('Sending Telegram notification...', message, ' message:', message.length, ' pairMessage:', pairMessage.length);
                    await axios.post(telegramApiUrl, {
                        chat_id: telegramChatId,
                        text: message,
                        parse_mode: 'Markdown'
                    });
                    message = `**Uniswap High Volume Pairs:**\n\n${pairMessage}\n`; // Start a new message
                } catch (error) {
                    console.error('Error sending Telegram notification:', error);
                }
            } else {
                message += `${pairMessage}\n`; // Add the pair to the message
            }
        }

        if (message.length > baseMessageLength) {
            try {
                await axios.post(telegramApiUrl, {
                    chat_id: telegramChatId,
                    text: message,
                    parse_mode: 'Markdown'
                });
                console.log('Telegram notification sent successfully.');
            } catch (error) {
                console.error('Error sending Telegram notification:', error);
            }
        }
    }
}


function escapeMarkdown(text: string) {
    return text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
}

async function checkAndSendEmail() {
    console.log(Date.now(), ': Checking and sending email...')
    const highVolumePairs = [];
    const keys = await redis.keys('*');
    for (const key of keys) {
        const volume = parseFloat(await redis.get(key) || '0');
        if (volume > notificationTreashold) {
            highVolumePairs.push(`${key}: $${volume.toLocaleString()}`);
        }
    }

    if (highVolumePairs.length > 0) {
        const mailOptions = {
            from: emailUser,
            to: recipientEmail,
            subject: 'Uniswap High Volume Pairs',
            text: `The following pairs have volumes greater than $${notificationTreashold.toLocaleString()}:\n\n${highVolumePairs.join('\n')}`,
        };

        transporter!.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
            } else {
                console.log('Email sent:', info.response);
            }
        });
    }
}

async function main() {
    console.log(`Starting to monitor Uniswap ${uniswapVersion} swaps...`);

    setInterval(async () => {
        const swaps = await querySwaps();
        if (swaps.length > 0) {
            await updateVolumes(swaps);
        }
    }, 80000); // 30 seconds delay for demo purposes, adjust as needed
    setInterval(async () => {
        if (notificationType === 'email') {
            await checkAndSendEmail();
        }
        else {
            await checkAndSendNotification();
        }
    }, notificationSendInterval);
}

main().catch(console.error);


interface Token {
    symbol: string;
}

interface Swap {
    id: string;
    amountUSD: string;
    timestamp: string;
    pair?: {
        token0: Token;
        token1: Token;
    };
    pool?: {
        totalValueLockedUSD: string;
        reserveUSD: string;
        liquidity: string;
        token0: Token;
        token1: Token;
        feeTier: string;
    };
}
