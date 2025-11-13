FROM node:20-alpine

WORKDIR /app

# Copy and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --production

# Copy source files and build
COPY . .
RUN yarn build

ENV NODE_ENV=production
EXPOSE 9000

# Default command for API
CMD ["yarn", "start"]
