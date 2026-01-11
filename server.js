const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();

// Portul pentru Coolify (3000)
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. Servim fișierele statice din folderul "public"
// Asigură-te că index.html este în folderul /public
app.use(express.static(path.join(__dirname, 'public')));

const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// 2. Endpoint-ul pentru generare voce
app.post('/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    
    console.log(`[TTS] Cerere nouă pentru vocea: ${voice || 'alloy'}`);
    
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
        console.error("Eroare API:", error.response ? error.response.data.toString() : error.message);
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

// 3. REPARARE EXPRESS 5: Metoda "Catch-all" fără caractere speciale
// Trimitem index.html pentru orice rută care nu a fost găsită mai sus
app.use((req, res, next) => {
    // Dacă cererea este pentru API dar a ajuns aici, înseamnă că ruta e greșită
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // Pentru orice altceva (navigare directă), trimitem interfața
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎙️ Voice Studio HD pornit pe portul ${PORT}`);
});