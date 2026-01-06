const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use(cors({
    origin: [
        'https://smartcreator.ro',
        'https://www.smartcreator.ro',
        'http://localhost:3000',
        'http://localhost:5500'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.options('*', cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
    next();
});

// Cookies
const COOKIES_FILE = path.join(__dirname, 'youtube_cookies.txt');

if (fs.existsSync(COOKIES_FILE)) {
    console.log('✅ YouTube cookies găsite!');
} else {
    console.warn('⚠️ youtube_cookies.txt NU există!');
}

// ============================================
// GET VIDEO INFO (fără extractor-args!)
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
        
        // Comandă SIMPLĂ pentru info - FĂRĂ extractor-args!
        let command = 'yt-dlp ';
        
        // Doar cookies
        if (fs.existsSync(COOKIES_FILE)) {
            command += `--cookies "${COOKIES_FILE}" `;
        }
        
        // Info flags
        command += '--dump-json ';
        command += '--no-warnings ';
        command += '--skip-download ';
        command += `"${url}"`;
        
        console.log('⚡ Command:', command);
        
        const { stdout } = await execPromise(command, {
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        const videoInfo = JSON.parse(stdout);
        
        // Filtrează formate disponibile
        let formats = [];
        
        if (videoInfo.formats && videoInfo.formats.length > 0) {
            formats = videoInfo.formats
                .filter(f => {
                    // Filtrează doar formate cu video ȘI audio
                    return f.vcodec && f.vcodec !== 'none' && 
                           f.acodec && f.acodec !== 'none' &&
                           f.ext === 'mp4' &&
                           f.height;
                })
                .map(f => ({
                    formatId: f.format_id,
                    qualityLabel: f.format_note || `${f.height}p`,
                    resolution: f.height,
                    ext: f.ext,
                    filesize: f.filesize || 'N/A'
                }))
                // Elimină duplicate pe baza resolution
                .filter((format, index, self) => 
                    index === self.findIndex(f => f.resolution === format.resolution)
                )
                .sort((a, b) => b.resolution - a.resolution);
        }
        
        // Dacă nu găsim formate combinate, oferim rezoluții standard
        if (formats.length === 0) {
            formats = [
                { formatId: 'best', qualityLabel: '720p', resolution: 720, ext: 'mp4' },
                { formatId: 'best', qualityLabel: '480p', resolution: 480, ext: 'mp4' },
                { formatId: 'best', qualityLabel: '360p', resolution: 360, ext: 'mp4' }
            ];
        }
        
        console.log('✅ Formats found:', formats.length);
        
        res.json({
            success: true,
            title: videoInfo.title || 'Video',
            thumbnail: videoInfo.thumbnail || '',
            duration: videoInfo.duration_string || 'N/A',
            formats: formats,
            videoUrl: url,
            transcript: null
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        
        // Dacă comanda eșuează, oferă formate default
        res.json({
            success: true,
            title: 'YouTube Video',
            thumbnail: '',
            duration: 'N/A',
            formats: [
                { formatId: 'best', qualityLabel: '720p', resolution: 720, ext: 'mp4' },
                { formatId: 'best', qualityLabel: '480p', resolution: 480, ext: 'mp4' },
                { formatId: 'best', qualityLabel: '360p', resolution: 360, ext: 'mp4' }
            ],
            videoUrl: req.body.url,
            transcript: null
        });
    }
});

// ============================================
// DOWNLOAD VIDEO (cu extractor-args!)
// ============================================
app.get('/api/download-video', async (req, res) => {
    try {
        const { url, quality, title } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL lipsă' });
        }
        
        console.log('📥 Download:', url, 'Quality:', quality);
        
        // Comandă pentru DOWNLOAD - CU extractor-args!
        let command = 'yt-dlp ';
        
        // Cookies
        if (fs.existsSync(COOKIES_FILE)) {
            command += `--cookies "${COOKIES_FILE}" `;
        }
        
        // Extractor args (ACUM DA!)
        command += '--extractor-args "youtube:player_client=mweb" ';
        
        // Rate limiting
        command += '--sleep-interval 5 ';
        
        // No warnings
        command += '--no-warnings ';
        
        // Format
        const qualityNum = quality || 720;
        command += `-f "bestvideo[height<=${qualityNum}]+bestaudio/best[height<=${qualityNum}]/best" `;
        command += '--merge-output-format mp4 ';
        
        // Output
        const outputDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const filename = `${Date.now()}.mp4`;
        const outputPath = path.join(outputDir, filename);
        command += `-o "${outputPath}" `;
        
        // URL
        command += `"${url}"`;
        
        console.log('⚡ Download command:', command);
        
        // Execută cu timeout mai mare
        await execPromise(command, {
            maxBuffer: 1024 * 1024 * 100, // 100MB buffer
            timeout: 300000 // 5 minute timeout
        });
        
        if (!fs.existsSync(outputPath)) {
            throw new Error('Fișierul nu a fost creat');
        }
        
        console.log('✅ Download complete!');
        
        const downloadName = `${title || 'video'}.mp4`;
        res.download(outputPath, downloadName, (err) => {
            if (err) console.error('Download error:', err);
            try {
                fs.unlinkSync(outputPath);
                console.log('🗑️ Cleanup done');
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        
    } catch (error) {
        console.error('❌ Download error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        cookies: fs.existsSync(COOKIES_FILE)
    });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => {
    console.log('🚀 Server on port', PORT);
    console.log('📁 Cookies:', fs.existsSync(COOKIES_FILE) ? '✅' : '❌');
});