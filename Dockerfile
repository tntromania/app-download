FROM node:18-alpine

# Instalează dependințe sistem
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg

# Instalează yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# Workdir
WORKDIR /app

# Copiază package files
COPY package*.json ./

# Instalează dependințe npm
RUN npm install --production

# Copiază tot codul (inclusiv cookies!)
COPY . .

# IMPORTANT: Verifică că youtube_cookies.txt există
RUN ls -la /app/youtube_cookies.txt || echo "WARNING: youtube_cookies.txt not found!"

# Expune portul
EXPOSE 3000

# Start
CMD ["node", "server.js"]