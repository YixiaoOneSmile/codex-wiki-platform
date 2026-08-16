FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web apps/web
RUN npm ci && npm run build -w @cwp/web

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
