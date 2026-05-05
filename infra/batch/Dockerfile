FROM node:18-bullseye-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY batch ./batch
COPY lambda ./lambda
COPY lib ./lib
COPY layers/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg

RUN chmod +x /usr/local/bin/ffmpeg

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg

CMD ["node", "batch/worker.js"]