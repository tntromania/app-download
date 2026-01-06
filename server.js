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

// Get video info
app.post('/api/yt-download', async (req, res) => {
  const { url } = req.body;
  console.log('[SmartDownloader] Procesez URL:', url);

  if (!url) return res.status(400).json({ success: false, error: 'URL lipsă' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ success: false, error: 'Link invalid' });

  try {
    const response = await axios.get('https://youtube-media-downloader.p.rapidapi.com/v2/video/details', {
      params: { videoId: videoId },
      headers: {
        'x-rapidapi-key': '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3',
        'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com'
      },
      timeout: 12000
    });

    const data = response.data;
    if (!data || !data.videos) throw new Error('API-ul nu a returnat date.');

    const allVideos = data.videos.items;
    let validFormats = allVideos
      .filter(v => v.extension === 'mp4')
      .map(v => {
        const resMatch = v.quality?.match(/(\d+)p?/);
        const resolution = resMatch ? parseInt(resMatch[1]) : 0;
        return {
          qualityLabel: v.quality || `${resolution}p`,
          resolution: resolution
        };
      })
      .filter(v => v.resolution > 0);

    const uniqueFormats = [];
    const seenResolutions = new Set();
    for (const format of validFormats) {
      if (!seenResolutions.has(format.resolution)) {
        seenResolutions.add(format.resolution);
        uniqueFormats.push(format);
      }
    }
    uniqueFormats.sort((a, b) => b.resolution - a.resolution);

    if (uniqueFormats.length === 0) throw new Error('Nu am găsit formate video valide.');

    let transcriptText = null;
    if (data.subtitles && data.subtitles.items && data.subtitles.items.length > 0) {
      const subs = data.subtitles.items;
      const targetSub = subs.find(s => s.code === 'ro' || (s.name && s.name.toLowerCase().includes('romanian'))) ||
        subs.find(s => s.code === 'en' || (s.name && s.name.toLowerCase().includes('english'))) ||
        subs[0];

      if (targetSub && targetSub.url) {
        try {
          const subRes = await axios.get(targetSub.url, { timeout: 5000 });
          transcriptText = cleanTranscriptXML(subRes.data);
        } catch (err) {
          console.log('[Warning] Nu s-a putut descărca transcriptul.');
        }
      }
    }

    res.json({
      success: true,
      videoId: videoId,
      videoUrl: url,
      title: data.title || 'YouTube Video',
      thumbnail: data.thumbnails ? data.thumbnails[data.thumbnails.length - 1].url : '',
      duration: data.lengthSeconds ? new Date(data.lengthSeconds * 1000).toISOString().substr(14, 5) : '',
      formats: uniqueFormats,
      transcript: transcriptText
    });

  } catch (error) {
    console.error('[Eroare Server]:', error.message);
    if (error.response && error.response.status === 429) {
      return res.status(429).json({ success: false, error: 'Limita zilnică RapidAPI atinsă.' });
    }
    res.status(500).json({ success: false, error: 'Eroare procesare video.' });
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