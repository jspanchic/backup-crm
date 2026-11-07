# Panel image for the test VPS: static build of backoffice served by nginx. Build context = repository root:
#   docker build -f infra/vps/panel.Dockerfile -t salvionix-crm/panel:test .
# Build the images on the PC and ship them with docker save/load: the vite build needs a lot of memory.
ARG NODE_IMAGE=node:24.22.2-alpine
ARG NGINX_IMAGE=nginx:1.30.6-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app/backoffice
COPY backoffice/package.json backoffice/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY backoffice ./
# VITE_CORE_API_URL empty = same origin: nginx forwards /admin/ to core-api, so the panel needs no CORS.
ARG VITE_DATA_PROVIDER=core-api
ARG VITE_CORE_API_URL=
ARG PANEL_PRESENTATION_MODE=true
# backoffice/vite.config.ts opens the bundle report in a browser unless NODE_ENV is "CI". With NODE_ENV=CI vite
# also bundles the development build of React, so NODE_ENV stays production and the opener gets stubs that do
# nothing: xdg-open (Linux) and the powershell.exe path the opener uses when the builder is WSL2 (Docker Desktop).
ENV NODE_ENV=production \
    VITE_DATA_PROVIDER=${VITE_DATA_PROVIDER} \
    VITE_CORE_API_URL=${VITE_CORE_API_URL} \
    VITE_PRESENTATION_MODE=${PANEL_PRESENTATION_MODE}
RUN printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/xdg-open \
 && mkdir -p /mnt/c/Windows/System32/WindowsPowerShell/v1.0 \
 && cp /usr/local/bin/xdg-open /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
 && chmod +x /usr/local/bin/xdg-open /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
RUN npx vite build \
 && rm -f dist/stats.html \
 && find dist -name '*.map' -delete

FROM ${NGINX_IMAGE}
COPY infra/vps/panel-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/backoffice/dist /usr/share/nginx/html
EXPOSE 8080