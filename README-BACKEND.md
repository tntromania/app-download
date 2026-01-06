# YouTube Downloader Backend

Backend pentru aplicația YouTube Downloader care rulează pe Render.

## Instalare și Deploy pe Render

### 1. Pregătire fișiere

Asigură-te că ai următoarele fișiere în directorul backend:
- `server.js` - Serverul principal
- `package.json` - Dependențele Node.js
- `Dockerfile` - Configurația Docker
- `.dockerignore` - Fișiere de ignorat

### 2. Deploy pe Render

1. **Creează un nou Web Service pe Render**
   - Conectează repository-ul GitHub/GitLab
   - Selectează "Docker" ca Environment

2. **Configurare**
   - **Build Command**: (lasă gol, Docker se ocupă)
   - **Start Command**: (lasă gol, Docker se ocupă)
   - **Environment Variables**: Nu sunt necesare pentru moment

3. **Deploy**
   - Render va construi automat imaginea Docker
   - Serverul va rula pe portul 3000

### 3. Verificare

După deploy, testează:
- `https://your-app.onrender.com/health` - Ar trebui să returneze `{"status":"ok"}`

## Endpoint-uri API

### POST `/api/yt-download`
Obține informații despre un video YouTube.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
```json
{
  "success": true,
  "title": "Video Title",
  "thumbnail": "https://...",
  "duration": "10:30",
  "formats": [...],
  "videoUrl": "...",
  "transcript": "..."
}
```

### GET `/api/yt-transcript?videoId=VIDEO_ID`
Obține transcript-ul unui video.

### POST `/api/translate`
Traduce text.

**Request:**
```json
{
  "text": "Text to translate",
  "from": "en",
  "to": "ro"
}
```

### GET `/api/download-video?url=...&quality=720&title=...`
Descarcă video-ul.

## Dependențe

- Node.js 18+
- yt-dlp (instalat în Docker)
- ffmpeg (instalat în Docker)

## Note

- Serverul folosește `youtube_cookies.txt` dacă există (opțional)
- Fișierele descărcate sunt șterse automat după download
- Transcript-urile sunt obținute automat pentru video-urile care le au disponibile
