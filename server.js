const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path'); // Adăugat
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// SERVIRE FIȘIERE STATICE (Aici e magia)
app.use(express.static(path.join(__dirname, 'public')));

const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    console.log(`[TTS HD] Generare pentru: ${voice}`);

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

// Ruta de bază care încarcă index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎙️ Voice Studio HD pornit pe portul ${PORT}`);
});