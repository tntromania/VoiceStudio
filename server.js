const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config SPA ---
const APP_PATH = '/apps/voicestudio'; // ruta pe care vrei să fie accesibilă
const PUBLIC_PATH = path.join(__dirname, 'public'); // acum root/public

// --- RAPIDAPI ---
const RAPID_API_KEY = process.env.RAPID_API_KEY;
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API Endpoint TTS
app.post(`${APP_PATH}/api/generate`, async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(
            `https://${RAPID_API_HOST}/`,
            { model: 'tts-1-hd', input: text, voice: voice||'alloy', instructions: instructions||'Speak clearly.', speed: parseFloat(speed)||1.0 },
            { headers: { 'Content-Type':'application/json','x-rapidapi-host':RAPID_API_HOST,'x-rapidapi-key':RAPID_API_KEY }, responseType:'arraybuffer', timeout:30000 }
        );
        res.setHeader('Content-Type','audio/mpeg');
        res.send(response.data);
    } catch(err) {
        console.error('❌ RapidAPI error:', err.message);
        if(err.response) res.status(err.response.status).json({error:'API RapidAPI', details:err.response.data});
        else res.status(500).json({error:'Eroare la generarea vocii.'});
    }
});

// Serve static files
app.use(APP_PATH, express.static(PUBLIC_PATH));

// SPA routes
app.get([APP_PATH, `${APP_PATH}/`, `${APP_PATH}/index.html`], (req,res) => {
    res.sendFile(path.join(PUBLIC_PATH,'index.html'));
});

app.get(`${APP_PATH}/*`, (req,res) => {
    res.sendFile(path.join(PUBLIC_PATH,'index.html'));
});

// Error handler
app.use((err,req,res,next)=>{
    console.error('🔥 Server Error:', err.stack);
    res.status(500).send('Ceva nu a mers bine pe server!');
});

app.listen(PORT,'0.0.0.0',()=>{
    console.log(`🚀 VoiceStudio activ pe port ${PORT}`);
    console.log(`🔗 URL: https://creatorsmart.ro${APP_PATH}/index.html`);
});
