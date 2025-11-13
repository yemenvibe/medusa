FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/medusa-config.ts ./medusa-config.ts
COPY --from=builder /app/static ./static

EXPOSE 9000

CMD ["yarn", "start"]
