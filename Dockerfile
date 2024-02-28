# Use a Node.js base image
FROM node:16

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
# Ensure you have ts-node and typescript in your dependencies or devDependencies
RUN npm install

# Copy the rest of your application's source code
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Command to run your app using ts-node
CMD ["npx", "ts-node", "index.ts"]
