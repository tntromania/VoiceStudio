const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURARE ---
// Deoarece Traefik/Coolify face "stripprefix", codul Node vede doar folderul radacina
const PUBLIC_PATH = path.join(__dirname, 'public');

// --- CHEIA TA RAPIDAPI ---
const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

app.use(cors());
app.use(express.json());

// 1. Servim fișierele statice (index.html, css, js)
// Aceasta trebuie să fie prima pentru a permite browserului să încarce resursele
app.use(express.static(PUBLIC_PATH));

// 2. API endpoint pentru generare voce
// Browserul va apela: https://creatorsmart.ro/apps/voicestudio/api/generate
// Traefik va trimite catre container doar: /api/generate
app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text lipsă.' });
    }

    try {
        console.log(`[TTS] Generare pentru: ${text.substring(0, 20)}...`);
        
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
        console.error('❌ Eroare API:', err.message);
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// 3. Health Check pentru Coolify
app.get('/health', (req, res) => res.status(200).send('ok'));

// 4. Fallback pentru Single Page Application
// Orice cerere care nu e fișier sau API, trimite index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VoiceStudio este online pe portul ${PORT}`);
});