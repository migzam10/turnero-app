FROM node:20-slim
# Base debian (glibc) para que Piper (onnxruntime) corra en Docker; en Alpine (musl)
# el binario de Piper aborta. espeak-ng: motor TTS por defecto en dev (TTS_ENGINE=espeak).
# libgomp1: requerido por Piper. curl/ca-certificates: para scripts/setup-tts.sh.
RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng libgomp1 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
