FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/binoex.db
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "start"]
