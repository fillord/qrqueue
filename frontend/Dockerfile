# Этап 1: сборка React (Vite → dist/)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

# Этап 2: раздача статики + прокси на backend
FROM nginx:alpine
ARG APP_VERSION=dev
LABEL org.opencontainers.image.revision=${APP_VERSION}
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
