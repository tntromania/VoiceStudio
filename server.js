const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';

app.use(cors());
app.use(express.json());

// Servim fișierele statice (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API pentru generare voce
app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text lipsă.' });
    }

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
                responseType: 'arraybuffer'
            }
        );

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// 🔥 HEALTH CHECK – TREBUIE ÎNAINTE DE *
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Fallback pentru SPA (React / HTML)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server pornit pe portul ${PORT}`);
});
