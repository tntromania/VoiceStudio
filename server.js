const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurare Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Servește fișierele din folderul public

// --- CONFIGURARE API KEY ---
// Asta o ia direct din Coolify
const RAPID_API_KEY = process.env.RAPID_API_KEY; 
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// --- ENDPOINT API ---
app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;

    if (!RAPID_API_KEY) {
        console.error("LIPSA API KEY!");
        return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
    }

    console.log(`[TTS HD] Generare... Voce: ${voice}`);

    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(`https://${RAPID_API_HOST}/`, {
            model: "tts-1-hd",
            input: text,
            voice: voice || "alloy",
            instructions: instructions || "Speak clearly.",
            speed: parseFloat(speed) || 1.0
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': RAPID_API_HOST,
                'x-rapidapi-key': RAPID_API_KEY
            },
            responseType: 'arraybuffer'
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("Eroare API:", error.message);
        // Dacă eroarea vine de la RapidAPI, o afișăm
        if (error.response) {
             console.error(error.response.data.toString());
        }
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// --- RUTE FRONTEND ---
// Orice alt request duce la index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server pornit pe portul ${PORT}`);
});