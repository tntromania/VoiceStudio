require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Preluam din Coolify
const AZURE_KEY = process.env.AZURE_API_KEY; 
const AZURE_REGION = process.env.AZURE_REGION || 'westeurope'; // ex: northeurope, westeurope, eastus

app.post('/api/generate', async (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY || !AZURE_REGION) {
        return res.status(500).json({ error: 'Lipsește API Key sau Regiunea Azure.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    // Setam vocea. Default punem vocea virala de baiat din Romania
    const selectedVoice = voiceId || 'ro-RO-EmilNeural';

    // Microsoft foloseste SSML (Speech Synthesis Markup Language) pentru a controla vocea
    const ssml = `
        <speak version='1.0' xml:lang='ro-RO'>
            <voice xml:lang='ro-RO' name='${selectedVoice}'>
                ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
        </speak>
    `;

    try {
        const response = await axios.post(
            `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3', // Calitate inalta
                    'User-Agent': 'Viralio'
                },
                responseType: 'arraybuffer'
            }
        );

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("Eroare Azure:", error.message);
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Azure Voice ruleaza pe portul ${PORT}`));