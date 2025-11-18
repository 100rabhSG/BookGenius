# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory to /app
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Copy the .env file
COPY .env .

# Install production dependencies
RUN npm install --production

# Copy the rest of the application's code
COPY . .

# Copy the firestore-service-account.json file
COPY firestore-service-account.json .

# Make port 8080 available to the world outside this container
EXPOSE 8080

# Define the command to run your app
CMD [ "npm", "start" ]
