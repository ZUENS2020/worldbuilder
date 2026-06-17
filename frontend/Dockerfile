# syntax=docker/dockerfile:1

# ── Stage 1: build the Vite static bundle ──
FROM node:24.14.1 AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: serve static files + reverse-proxy /api ──
FROM nginx:1.28
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
