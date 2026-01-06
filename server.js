// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Innertube } = require('youtubei.js');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let youtube;

// Inițializează YouTube client
async function initYouTube() {
  try {
    youtube = await Innertube.create();
    console.log('✅ YouTube client inițializat');
  } catch (error) {
    console.error('❌ Eroare inițializare YouTube:', error);
  }
}

initYouTube();

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true, message: 'YouTube Downloader Online' });
});

// VIDEO INFO - cu YouTube.js (FĂRĂ API extern!)
app.post('/api/yt-download', async (req, res) => {
  const { url } = req.body;
  console.log('[SmartDownloader] Procesez URL:', url);

  if (!url) return res.status(400).json({ success: false, error: 'URL lipsă' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ success: false, error: 'Link invalid' });

  try {
    const info = await youtube.getInfo(videoId);
    
    // Extragem formatele disponibile
    const formats = info.streaming_data.formats || [];
    const adaptiveFormats = info.streaming_data.adaptive_formats || [];
    const allFormats = [...formats, ...adaptiveFormats];

    let validFormats = allFormats
      .filter(f => f.mime_type?.includes('video/mp4') && f.height)
      .map(f => ({
        qualityLabel: `${f.height}p`,
        resolution: f.height
      }));

    // Eliminăm duplicate
    const uniqueFormats = [];
    const seenResolutions = new Set();
    for (const format of validFormats) {
      if (!seenResolutions.has(format.resolution)) {
        seenResolutions.add(format.resolution);
        uniqueFormats.push(format);
      }
    }
    uniqueFormats.sort((a, b) => b.resolution - a.resolution);

    if (uniqueFormats.length === 0) {
      uniqueFormats.push(
        { qualityLabel: '1080p', resolution: 1080 },
        { qualityLabel: '720p', resolution: 720 },
        { qualityLabel: '480p', resolution: 480 },
        { qualityLabel: '360p', resolution: 360 }
      );
    }

    // Transcript
    let transcriptText = null;
    try {
      const transcript = await info.getTranscript();
      if (transcript && transcript.transcript) {
        transcriptText = transcript.transcript.content.body.initial_segments
          .map(segment => segment.snippet.text)
          .join(' ');
      }
    } catch (err) {
      console.log('[Warning] Nu s-a putut descărca transcriptul.');
    }

    const thumbnail = info.basic_info.thumbnail?.[0]?.url || 
                     `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    res.json({
      success: true,
      videoId: videoId,
      videoUrl: url,
      title: info.basic_info.title || 'YouTube Video',
      thumbnail: thumbnail,
      duration: info.basic_info.duration ? 
        new Date(info.basic_info.duration * 1000).toISOString().substr(14, 5) : '',
      formats: uniqueFormats,
      transcript: transcriptText
    });

  } catch (error) {
    console.error('[Eroare Server]:', error.message);
    res.status(500).json({ success: false, error: 'Eroare procesare video.' });
  }
});

// DOWNLOAD VIDEO - direct cu YouTube.js
app.get('/api/download-video', async (req, res) => {
  const { url, quality, title } = req.query;

  if (!url) return res.status(400).send('URL lipsă');

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).send('Link invalid');

  const safeTitle = (title || 'video').replace(/[^a-z0-9\s\-_]/gi, '').trim().substring(0, 50) || 'video';

  console.log(`[Download Start] ${safeTitle} - ${quality}p`);

  try {
    const info = await youtube.getInfo(videoId);
    const qualityNum = parseInt(quality) || 720;

    // Găsim formatul cel mai apropiat de calitatea cerută
    const formats = [...(info.streaming_data.formats || []), ...(info.streaming_data.adaptive_formats || [])];
    
    let bestFormat = formats
      .filter(f => f.mime_type?.includes('video/mp4') && f.height && f.has_audio)
      .sort((a, b) => Math.abs(a.height - qualityNum) - Math.abs(b.height - qualityNum))[0];

    if (!bestFormat) {
      bestFormat = formats.find(f => f.mime_type?.includes('video/mp4'));
    }

    if (!bestFormat || !bestFormat.url) {
      throw new Error('Nu s-a găsit format valid pentru download.');
    }

    // Stream direct către client
    const axios = require('axios');
    const videoStream = await axios({
      method: 'get',
      url: bestFormat.url,
      responseType: 'stream',
      timeout: 120000
    });

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');
    if (bestFormat.content_length) {
      res.setHeader('Content-Length', bestFormat.content_length);
    }

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