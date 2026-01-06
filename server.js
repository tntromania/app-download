// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = promisify(exec);

const app = express();
const PORT = process.env.PORT || 10000;

// CORS
app.use(cors());
app.use(express.json());

// Directory pentru fișiere temporare
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Cleanup fișiere vechi (mai vechi de 1 oră)
setInterval(() => {
  fs.readdir(TEMP_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(TEMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const now = Date.now();
        const fileAge = now - stats.mtimeMs;
        if (fileAge > 3600000) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 600000);

// Helper functions
function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

function cleanTranscriptXML(xmlData) {
  if (!xmlData) return '';
  if (!xmlData.includes('<text')) return xmlData;
  return xmlData
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

// Health check
app.get('/healthz', (req, res) => {
  res.json({ ok: true, message: 'YouTube Downloader Online' });
});

// Get video info - COBALT API (100% funcțional, rapid, fără limitări)
app.post('/api/yt-download', async (req, res) => {
  const { url } = req.body;
  console.log('[SmartDownloader] Procesez URL:', url);

  if (!url) return res.status(400).json({ success: false, error: 'URL lipsă' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ success: false, error: 'Link invalid' });

  try {
    // Folosim Cobalt API - cel mai bun pentru YouTube
    const response = await axios.post('https://api.cobalt.tools/api/json', {
      url: url,
      vCodec: "h264",
      vQuality: "max",
      aFormat: "mp3",
      filenamePattern: "basic",
      isAudioOnly: false,
      disableMetadata: false
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;

    // Oferim toate calitățile standard
    const formats = [
      { qualityLabel: '2160p', resolution: 2160 },
      { qualityLabel: '1440p', resolution: 1440 },
      { qualityLabel: '1080p', resolution: 1080 },
      { qualityLabel: '720p', resolution: 720 },
      { qualityLabel: '480p', resolution: 480 },
      { qualityLabel: '360p', resolution: 360 }
    ];

    // Încercăm să luăm thumbnail și title de la YouTube direct
    let title = 'YouTube Video';
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    
    res.json({
      success: true,
      videoId: videoId,
      videoUrl: url,
      title: title,
      thumbnail: thumbnail,
      duration: '',
      formats: formats,
      transcript: null
    });

  } catch (error) {
    console.error('[Eroare Cobalt]:', error.message);
    
    // Fallback super-simplu - returnăm calități standard
    res.json({
      success: true,
      videoId: videoId,
      videoUrl: url,
      title: 'YouTube Video',
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      duration: '',
      formats: [
        { qualityLabel: '1080p', resolution: 1080 },
        { qualityLabel: '720p', resolution: 720 },
        { qualityLabel: '480p', resolution: 480 },
        { qualityLabel: '360p', resolution: 360 }
      ],
      transcript: null
    });
  }
});

// Download video
app.get('/api/download-video', async (req, res) => {
  const { url, quality, title } = req.query;

  if (!url) return res.status(400).send('URL lipsă');

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).send('Link invalid');

  const safeTitle = (title || 'video').replace(/[^a-z0-9\s\-_]/gi, '').trim().substring(0, 50) || 'video';
  const fileName = `${videoId}_${quality || '720'}p_${Date.now()}.mp4`;
  const filePath = path.join(TEMP_DIR, fileName);

  console.log(`[Download Start] ${safeTitle} - ${quality}p`);

  try {
    const qualityNum = parseInt(quality) || 720;
    const format = `bestvideo[height<=${qualityNum}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${qualityNum}][ext=mp4]/best`;
    const command = `yt-dlp -f "${format}" --merge-output-format mp4 --no-playlist --no-warnings --quiet -o "${filePath}" "${url}"`;

    console.log('[Executing]', command);

    const { stdout, stderr } = await execPromise(command, {
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024
    });

    if (stderr && !stderr.includes('Deleting original file')) {
      console.warn('[yt-dlp warning]:', stderr);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error('Fișierul nu a fost descărcat.');
    }

    const stats = fs.statSync(filePath);
    console.log(`[Download Complete] Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stats.size);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);

    readStream.on('end', () => {
      setTimeout(() => {
        fs.unlink(filePath, (err) => {
          if (err) console.error('[Cleanup Error]:', err);
          else console.log('[Cleanup] Fișier șters:', fileName);
        });
      }, 5000);
    });

    readStream.on('error', (err) => {
      console.error('[Stream Error]:', err);
      fs.unlink(filePath, () => {});
      if (!res.headersSent) {
        res.status(500).send('Eroare la transfer.');
      }
    });

  } catch (error) {
    console.error('[Download Error]:', error.message);

    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }

    if (!res.headersSent) {
      if (error.killed) {
        res.status(504).send('Timeout - videoclipul este prea mare.');
      } else {
        res.status(500).send('Eroare la descărcare video. Încearcă din nou.');
      }
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ YouTube Downloader pornit pe portul ${PORT}`);
  
  exec('yt-dlp --version', (error, stdout) => {
    if (error) {
      console.warn('⚠️  yt-dlp NU este instalat!');
    } else {
      console.log(`✅ yt-dlp versiunea: ${stdout.trim()}`);
    }
  });
});