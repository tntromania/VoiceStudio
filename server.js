const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';

app.use(cors());
app.use(express.json());

// Identic AudioCut: servim folderul public
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// Servim index.html - Stil AudioCut
app.get(BASE_PATH + '/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API - Identic structura AudioCut
app.post(BASE_PATH + '/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    
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
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎙️ Voice Studio pornit pe portul ${PORT}`);
});