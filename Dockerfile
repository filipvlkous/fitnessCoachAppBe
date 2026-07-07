# --- Build stage ---
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 8080

CMD ["node", "dist/src/main.js"]