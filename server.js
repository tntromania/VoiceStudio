const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurare Path
const APP_PATH = '/apps/VoiceStudio';

// --- CHEIA TA RAPIDAPI ---
const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

app.use(cors());
app.use(express.json());

// 1. Health check - Esențial pentru Coolify să știe că serverul e "viu"
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// 2. API endpoint - Prefixat corect
app.post(`${APP_PATH}/api/generate`, async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    
    console.log('📝 Request primit pentru voce:', { voice, speed });
    
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
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// 3. Servirea fișierelor statice (CSS, JS, Imagini)
// Spunem serverului că tot ce e în folderul 'public' aparține rutei /apps/VoiceStudio
app.use(APP_PATH, express.static(path.join(__dirname, 'public')));

// 4. Rutarea pentru HTML (index.html)
// Această rută prinde: /apps/VoiceStudio, /apps/VoiceStudio/, și /apps/VoiceStudio/index.html
app.get([APP_PATH, `${APP_PATH}/`, `${APP_PATH}/index.html`], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 5. Fallback - Dacă se accesează o rută greșită sub acest path, trimitem tot la index.html
app.get(`${APP_PATH}/*`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err.stack);
    res.status(500).send('Ceva nu a mers bine pe server!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VoiceStudio activ pe portul ${PORT}`);
    console.log(`🔗 URL: https://creatorsmart.ro${APP_PATH}/index.html`);
});