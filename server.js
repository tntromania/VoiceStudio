const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurare Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

// --- CONFIGURARE API KEY ---
// Se preia din Environment Variables din Coolify
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- ENDPOINT API ---
app.post('/api/generate', async (req, res) => {
    // OpenAI Audio API suportă doar: model, input, voice, speed.
    // "instructions" nu este suportat de endpoint-ul audio, așa că îl ignorăm.
    const { text, voice, speed } = req.body;

    if (!OPENAI_API_KEY) {
        console.error("LIPSA API KEY! Verifica variabilele in Coolify.");
        return res.status(500).json({ error: 'Server Error: Missing API Key' });
    }

    console.log(`[OpenAI TTS] Generare... Voce: ${voice || 'alloy'}, Viteza: ${speed}`);

    if (!text) return res.status(400).json({ error: 'Text lipsă.' });

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/audio/speech', 
            {
                model: "tts-1-hd", // Modelul High Definition
                input: text,
                voice: voice || "alloy",
                speed: parseFloat(speed) || 1.0,
                response_format: "mp3"
            }, 
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer' // Critic pentru fișiere audio
            }
        );

        // Trimitem buffer-ul audio direct la frontend
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("Eroare OpenAI:", error.message);
        if (error.response) {
            // Afișăm eroarea exactă de la OpenAI în consolă pentru debugging
            console.error("Detalii eroare:", error.response.data.toString());
        }
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// --- RUTE FRONTEND ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server pornit pe portul ${PORT}`);
});