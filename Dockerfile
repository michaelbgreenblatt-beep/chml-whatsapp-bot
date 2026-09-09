FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache git && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/whatsapp.js"]
