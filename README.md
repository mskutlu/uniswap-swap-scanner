# Uniswap Volume Tracker

## Description

This Uniswap Volume Tracker is a Node.js application that monitors and notifies users about high-volume trading pairs on Uniswap. It leverages technologies such as Axios for HTTP requests, Redis for caching, dotenv for managing environment variables, and nodemailer for sending email notifications. The application supports both Uniswap v2 and v3 and allows for notifications to be sent via email or Telegram according to the user's configuration.

## Features

- Compatibility with Uniswap versions 2 and 3.
- Real-time tracking of swap volumes, fees, and total value locked (TVL).
- Customizable notification system via email or Telegram.
- Efficient data caching using Redis.
- Adjustable notification threshold for tailored alerts.

## Installation

1. Clone the repository to your local machine.
2. Install the necessary dependencies by running:

   ```bash
   npm install
   ```
3. Configure your environment variables by creating a `.env` file in the root directory (refer to the Environment Variables section below).
4. To start the application in a development environment, run:

   ```bash
   npx ts-node index.ts
   ```

## Docker Usage

To run the application using Docker, use the following command:

```bash
docker-compose up --build -d
```

This command builds the Docker image and starts the container in detached mode.

## Environment Variables

Ensure your `.env` file contains the following variables:

- `TELEGRAM_TOKEN`: Your Telegram bot token.
- `TELEGRAM_CHAT_ID`: Your Telegram chat ID.
- `SMTP_HOST`: Your SMTP server host for email notifications.
- `SMTP_PORT`: Your SMTP server port.
- `EMAIL_USER`: The email address used for sending notifications.
- `EMAIL_PASS`: The password for your email address.
- `RECIPIENT_EMAIL`: The recipient's email address for notifications.
- `UNISWAP_VERSION`: The version of Uniswap to monitor (`v2` or `v3`).
- `EMAIL_THRESHOLD`: The USD threshold for notifications.
- `REDIS_URL`: Your Redis server URL.
- `UNISWAP_v2_GRAPH_URL`: The Graph API URL for Uniswap v2.
- `UNISWAP_v3_GRAPH_URL`: The Graph API URL for Uniswap v3.
- `NOTIFICATION_SEND_INTERVAL`: The interval for sending notifications (in milliseconds).
- `NOTIFICATION_TYPE`: The type of notification (`email` or `telegram`).

## Usage

Once the application is running, it will automatically begin monitoring Uniswap swaps based on the configured parameters. Notifications will be sent out when trading pairs exceed the defined thresholds.

## License

This project is licensed under the MIT License. See the LICENSE file in the project repository for more information.

## Contributing

Contributions to the project are welcome. Please fork the repository, make your changes, and submit a pull request with your updates.

---

This README provides all necessary information to get started with the Uniswap Volume Tracker. Ensure you follow the setup instructions closely and configure your environment variables correctly for optimal performance.
