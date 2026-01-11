const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const APP_PATH = '/apps/VoiceStudio';

app.use(cors());
app.use(express.json());

// Fișiere statice sub calea corectă
app.use(APP_PATH, express.static(path.join(__dirname, 'public')));

app.get(APP_PATH, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post(`${APP_PATH}/api/generate`, async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    try {
        const response = await axios.post(`https://${process.env.RAPID_API_HOST}/`, 
            { model: "tts-1-hd", input: text, voice, instructions, speed },
            { headers: { 'x-rapidapi-key': process.env.RAPID_API_KEY }, responseType: 'arraybuffer' }
        );
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);
    } catch (err) {
        res.status(500).json({ error: 'Eroare.' });
    }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0');