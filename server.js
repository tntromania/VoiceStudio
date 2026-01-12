const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configurări generale ---
const APP_PATH = '/apps/voicestudio';
const PUBLIC_PATH = path.join(__dirname, 'apps', 'VoiceStudio', 'public');

// --- RAPIDAPI ---
const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// Middleware
app.use(cors());
app.use(express.json());

// ----------------------------
// 1️⃣ Health Check
// ----------------------------
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// ----------------------------
// 2️⃣ API Endpoint - Generare voce
// ----------------------------
app.post(`${APP_PATH}/api/generate`, async (req, res) => {
    const { text, voice, instructions, speed } = req.body;

    console.log('📝 Request generare voce:', { voice, speed, text: text?.substring(0,50) });

    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(
            `https://${RAPID_API_HOST}/`,
            {
                model: "tts-1-hd",
                input: text,
                voice: voice || "alloy",
                instructions: instructions || "Speak clearly.",
                speed: parseFloat(speed) || 1.0
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-rapidapi-host': RAPID_API_HOST,
                    'x-rapidapi-key': RAPID_API_KEY
                },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);
    } catch (err) {
        console.error('❌ Eroare RapidAPI:', err.message);
        if (err.response) {
            res.status(err.response.status).json({ 
                error: 'Eroare API RapidAPI', 
                details: err.response.data 
            });
        } else {
            res.status(500).json({ error: 'Eroare la generarea vocii.' });
        }
    }
});

// ----------------------------
// 3️⃣ Servirea fișierelor statice (CSS, JS, imagini)
// ----------------------------
app.use(APP_PATH, express.static(PUBLIC_PATH));

// ----------------------------
// 4️⃣ Rutare pentru HTML (index.html)
// ----------------------------
app.get([APP_PATH, `${APP_PATH}/`, `${APP_PATH}/index.html`], (req, res) => {
    res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

// ----------------------------
// 5️⃣ Fallback - SPA routing
// ----------------------------
app.get(`${APP_PATH}/*`, (req, res) => {
    res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

// ----------------------------
// 6️⃣ Error handling global
// ----------------------------
app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err.stack);
    res.status(500).send('Ceva nu a mers bine pe server!');
});

// ----------------------------
// Start server
// ----------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VoiceStudio activ pe portul ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}${APP_PATH}/index.html`);
});
