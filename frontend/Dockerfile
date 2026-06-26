# syntax=docker/dockerfile:1

# ---- Stage 1: build the static web bundle ----
FROM node:22-alpine AS build
WORKDIR /app

# API base URL is baked into the static bundle at build time.
ARG EXPO_PUBLIC_API_URL=http://localhost:8000
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and export the web build to dist/.
COPY . .
RUN npx expo export --platform web --output-dir dist

# ---- Stage 2: serve with nginx ----
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
