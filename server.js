const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public')); // dacă ai folder public/

// Cookies path
const COOKIES_FILE = path.join(__dirname, 'youtube_cookies.txt');

// Verifică cookies la startup
if (fs.existsSync(COOKIES_FILE)) {
    console.log('✅ YouTube cookies găsite!');
} else {
    console.warn('⚠️ ATENȚIE: youtube_cookies.txt NU există!');
}

// Endpoint pentru info video
app.post('/api/yt-download', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL lipsă' });
        }
        
        // Construiește comanda pentru info
        let command = 'yt-dlp ';
        
        if (fs.existsSync(COOKIES_FILE)) {
            command += `--cookies "${COOKIES_FILE}" `;
        }
        
        command += '--extractor-args "youtube:player_client=mweb" ';
        command += '--dump-json ';
        command += '--no-warnings ';
        command += `"${url}"`;
        
        console.log('Getting video info...');
        
        const { stdout } = await execPromise(command);
        const videoInfo = JSON.parse(stdout);
        
        // Filtrează formate (doar video+audio, MP4)
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
        
        res.json({
            success: true,
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration_string,
            formats: formats,
            videoUrl: url
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint pentru download
app.get('/api/download-video', async (req, res) => {
    try {
        const { url, quality, title } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL lipsă' });
        }
        
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
        
        console.log('Downloading video...');
        console.log('Command:', command);
        
        // Execută
        await execPromise(command);
        
        // Verifică dacă fișierul există
        if (!fs.existsSync(outputPath)) {
            throw new Error('Fișierul nu a fost creat');
        }
        
        // Trimite fișierul
        const downloadName = `${title || 'video'}.mp4`;
        res.download(outputPath, downloadName, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Cleanup
            try {
                fs.unlinkSync(outputPath);
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint
app.get('/debug/cookies', (req, res) => {
    res.json({
        cookiesExist: fs.existsSync(COOKIES_FILE),
        cookiesPath: COOKIES_FILE,
        files: fs.readdirSync(__dirname).slice(0, 20)
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Cookies: ${fs.existsSync(COOKIES_FILE) ? '✅' : '❌'}`);
});