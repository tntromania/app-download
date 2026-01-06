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

app.use(cors());
app.use(express.json());

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

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

app.get('/healthz', (req, res) => {
  res.json({ ok: true, message: 'YouTube Downloader Online' });
});

// VIDEO INFO - cu transcript
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

    // TRANSCRIPT - înapoi!
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

// DOWNLOAD VIDEO - folosește Cobalt.tools pentru download real
app.get('/api/download-video', async (req, res) => {
  const { url, quality, title } = req.query;

  if (!url) return res.status(400).send('URL lipsă');

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).send('Link invalid');

  const safeTitle = (title || 'video').replace(/[^a-z0-9\s\-_]/gi, '').trim().substring(0, 50) || 'video';

  console.log(`[Download Start] ${safeTitle} - ${quality}p`);

  try {
    // Folosim Cobalt API pentru download
    const cobaltResponse = await axios.post('https://api.cobalt.tools/api/json', {
      url: url,
      vCodec: "h264",
      vQuality: quality || "1080",
      aFormat: "best",
      filenamePattern: "basic",
      isAudioOnly: false
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const downloadUrl = cobaltResponse.data.url;

    if (!downloadUrl) {
      throw new Error('Nu s-a putut obține URL-ul de download.');
    }

    // Stream video-ul de la Cobalt către client
    const videoStream = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream',
      timeout: 120000
    });

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');

    videoStream.data.pipe(res);

    videoStream.data.on('end', () => {
      console.log(`[Download Complete] ${safeTitle}`);
    });

    videoStream.data.on('error', (err) => {
      console.error('[Stream Error]:', err);
      if (!res.headersSent) {
        res.status(500).send('Eroare la transfer.');
      }
    });

  } catch (error) {
    console.error('[Download Error]:', error.message);

    if (!res.headersSent) {
      res.status(500).send('Eroare la descărcare video. Încearcă din nou.');
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ YouTube Downloader pornit pe portul ${PORT}`);
});