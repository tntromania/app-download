const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURARE CORS - FOARTE IMPORTANT!
// ============================================
app.use(cors({
    origin: [
        'https://smartcreator.ro',
        'https://www.smartcreator.ro',
        'http://localhost:3000',
        'http://localhost:5500'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Middleware standard
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servește fișiere statice (dacă ai)
// app.use(express.static('public'));

// ============================================
// COOKIES YOUTUBE
// ============================================
const COOKIES_FILE = path.join(__dirname, 'youtube_cookies.txt');

if (fs.existsSync(COOKIES_FILE)) {
    console.log('✅ YouTube cookies găsite!');
} else {
    console.warn('⚠️ ATENȚIE: youtube_cookies.txt NU există!');
}

// ============================================
// ENDPOINT: GET VIDEO INFO
// ============================================
app.post('/api/yt-download', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL lipsă' 
            });
        }
        
        console.log('📥 Getting info for:', url);
        
        // Construiește comanda
        let command = 'yt-dlp ';
        
        // COOKIES
        if (fs.existsSync(COOKIES_FILE)) {
            command += `--cookies "${COOKIES_FILE}" `;
        }
        
        // CLIENT MWEB
        command += '--extractor-args "youtube:player_client=mweb" ';
        
        // DUMP JSON
        command += '--dump-json ';
        command += '--no-warnings ';
        command += `"${url}"`;
        
        console.log('Executing:', command);
        
        const { stdout } = await execPromise(command);
        const videoInfo = JSON.parse(stdout);
        
        // Filtrează formate
        const formats = videoInfo.formats
            .filter(f => f.vcodec !== 'none' && f.acodec !== 'none')
            .filter(f => f.ext === 'mp4')
            .map(f => ({
                formatId: f.format_id,
                qualityLabel: f.format_note || `${f.height}p`,
                resolution: f.height,
                ext: f.ext,
                filesize: f.filesize || 'N/A'
            }))
            .sort((a, b) => b.resolution - a.resolution);
        
        console.log('✅ Found formats:', formats.length);
        
        res.json({
            success: true,
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration_string,
            formats: formats,
            videoUrl: url,
            transcript: null // sau extrage transcript dacă vrei
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// ENDPOINT: DOWNLOAD VIDEO
// ============================================
app.get('/api/download-video', async (req, res) => {
    try {
        const { url, quality, title } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL lipsă' });
        }
        
        console.log('📥 Downloading:', url, 'Quality:', quality);
        
        // Construiește comanda
        let command = 'yt-dlp ';
        
        // COOKIES
        if (fs.existsSync(COOKIES_FILE)) {
            command += `--cookies "${COOKIES_FILE}" `;
        }
        
        // CLIENT MWEB
        command += '--extractor-args "youtube:player_client=mweb" ';
        
        // RATE LIMITING
        command += '--sleep-interval 5 --max-sleep-interval 10 ';
        
        // NO WARNINGS
        command += '--no-warnings ';
        
        // FORMAT
        const qualityNum = quality || 720;
        command += `-f "bestvideo[height<=${qualityNum}]+bestaudio/best[height<=${qualityNum}]" `;
        command += '--merge-output-format mp4 ';
        
        // OUTPUT
        const outputDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const filename = `${Date.now()}.mp4`;
        const outputPath = path.join(outputDir, filename);
        command += `-o "${outputPath}" `;
        
        // URL
        command += `"${url}"`;
        
        console.log('Executing download...');
        
        // Execută
        await execPromise(command);
        
        // Verifică dacă fișierul există
        if (!fs.existsSync(outputPath)) {
            throw new Error('Fișierul nu a fost creat');
        }
        
        console.log('✅ Download complete!');
        
        // Trimite fișierul
        const downloadName = `${title || 'video'}.mp4`;
        res.download(outputPath, downloadName, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Cleanup
            try {
                fs.unlinkSync(outputPath);
                console.log('🗑️ Cleanup done');
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================
app.get('/debug/cookies', (req, res) => {
    res.json({
        cookiesExist: fs.existsSync(COOKIES_FILE),
        cookiesPath: COOKIES_FILE,
        files: fs.readdirSync(__dirname).slice(0, 20)
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        cookies: fs.existsSync(COOKIES_FILE)
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('🚀 Server running on port', PORT);
    console.log('📁 Cookies:', fs.existsSync(COOKIES_FILE) ? '✅' : '❌');
});