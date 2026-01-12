const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Eliminăm prefixul din rutele interne Express
const PUBLIC_PATH = path.join(__dirname, 'public'); 

const RAPID_API_KEY = process.env.RAPID_API_KEY;
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

app.use(cors());
app.use(express.json());

// Health check la rădăcină pentru Coolify
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API Endpoint - Traefik va trimite aici cererile care vin pe /apps/voicestudio/api/generate
app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(
            `https://${RAPID_API_HOST}/`,
            { model: 'tts-1-hd', input: text, voice: voice||'alloy', instructions: instructions||'Speak clearly.', speed: parseFloat(speed)||1.0 },
            { headers: { 'x-rapidapi-key':RAPID_API_KEY, 'x-rapidapi-host':RAPID_API_HOST }, responseType:'arraybuffer', timeout:30000 }
        );
        res.setHeader('Content-Type','audio/mpeg');
        res.send(response.data);
    } catch(err) {
        res.status(500).json({error:'Eroare la generarea vocii.'});
    }
});

// Servim fișierele direct la rădăcina containerului
app.use(express.static(PUBLIC_PATH));

// Ruta de fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VoiceStudio pregătit pe port ${PORT}`);
});