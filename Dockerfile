FROM node:18-slim

# Instalează yt-dlp și dependențele necesare
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Instalează yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Creează directorul de lucru
WORKDIR /app

# Copiază fișierele
COPY package*.json ./
COPY server.js ./

# Instalează dependențele Node.js
RUN npm install --production

# Creează directoarele necesare
RUN mkdir -p downloads temp

# Expune portul
EXPOSE 3000

# Pornește serverul
CMD ["node", "server.js"]
