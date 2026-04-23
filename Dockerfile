FROM node:24-alpine AS deps
WORKDIR /app/neural-labs
COPY neural-labs/package.json neural-labs/package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY .env ./.env
COPY --from=deps /app/neural-labs/node_modules ./neural-labs/node_modules
COPY neural-labs ./neural-labs
WORKDIR /app/neural-labs
RUN npm run build

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache bash
COPY --from=builder /app/neural-labs ./neural-labs
WORKDIR /app/neural-labs
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
