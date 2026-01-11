const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
const path = require('path');
// Servim fișierele statice din folderul public
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principală care trimite la index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CHEIA TA RAPIDAPI ---
const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;

    // Aici e schimbarea magică: "tts-1-hd"
    console.log(`[TTS HD] Generare... Voce: ${voice} | Speed: ${speed}`);

    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(`https://${RAPID_API_HOST}/`, {
            // SCHIMBARE MAJORĂ AICI:
            model: "tts-1-hd", // Folosim modelul HIGH DEFINITION
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

app.listen(PORT, () => {
    console.log(`🎙️ Voice Studio (HD MODE) pornit pe portul ${PORT}`);
});