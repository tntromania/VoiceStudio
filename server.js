const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CHEIA TA RAPIDAPI ---
const RAPID_API_KEY = '7efb2ec2c9msh9064cf9c42d6232p172418jsn9da8ae5664d3';
const RAPID_API_HOST = 'open-ai-text-to-speech1.p.rapidapi.com';

// Verificăm dacă API keys sunt setate
if (!RAPID_API_HOST || !RAPID_API_KEY) {
    console.error('⚠️ ATENȚIE: RAPID_API_HOST și RAPID_API_KEY trebuie setate în Environment Variables!');
}

app.use(cors());
app.use(express.json());

// Health check - PRIORITATE MAXIMĂ
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// API endpoint pentru generare voce - ÎNAINTE de static files
app.post('/apps/VoiceStudio/api/generate', async (req, res) => {
    const { text, voice, instructions, speed } = req.body;
    
    console.log('📝 Request primit:', { text: text?.substring(0, 50), voice, speed });
    
    if (!text) {
        return res.status(400).json({ error: 'Text lipsă.' });
    }

    if (!RAPID_API_HOST || !RAPID_API_KEY) {
        return res.status(500).json({ error: 'API credentials nu sunt configurate. Verifică Environment Variables.' });
    }

    try {
        console.log('🔄 Trimit request către RapidAPI...');
        
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
                timeout: 30000 // 30 secunde timeout
            }
        );

        console.log('✅ Audio generat cu succes');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);
    } catch (err) {
        console.error('❌ Eroare la generarea vocii:', err.message);
        
        if (err.response) {
            console.error('Response error:', err.response.status, err.response.data);
            res.status(err.response.status).json({ 
                error: 'Eroare la API-ul de generare voce.',
                details: err.response.data 
            });
        } else if (err.request) {
            console.error('Request error - no response received');
            res.status(500).json({ error: 'Nu s-a primit răspuns de la API.' });
        } else {
            res.status(500).json({ 
                error: 'Eroare la generarea vocii.',
                details: err.message 
            });
        }
    }
});

// Servim fișierele statice
app.use('/apps/VoiceStudio', express.static(path.join(__dirname, 'public')));

// Route pentru homepage
app.get('/apps/VoiceStudio', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/apps/VoiceStudio/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback pentru alte rute sub /apps/VoiceStudio/
app.get('/apps/VoiceStudio/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server pornit pe portul ${PORT}`);
    console.log(`📍 Aplicație disponibilă la: /apps/VoiceStudio/`);
    console.log(`🔑 API Host: ${RAPID_API_HOST || 'NOT SET'}`);
    console.log(`🔑 API Key: ${RAPID_API_KEY ? '***' + RAPID_API_KEY.slice(-4) : 'NOT SET'}`);
});