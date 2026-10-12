# Node.js runtime is taken from the official image and added on top of the Google Maps engine image.
FROM node:20-bookworm-slim AS node

# gosom/google-maps-scraper (MIT): the engine binary at /usr/bin/google-maps-scraper plus Chromium and its libraries.
FROM gosom/google-maps-scraper:v1.18.1

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && node --version \
    && npm --version \
    && google-maps-scraper -version

ENV DISABLE_TELEMETRY=1

WORKDIR /usr/src/app

COPY package.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true)

COPY . ./

# The base image starts the engine directly; the actor starts Node, which runs the engine per search.
ENTRYPOINT []
CMD ["node", "src/main.js"]
