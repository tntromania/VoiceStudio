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

// Preluam datele si stergem spatiile goale invizibile (daca exista de la copy-paste)
const AZURE_KEY = process.env.AZURE_API_KEY ? process.env.AZURE_API_KEY.trim() : null;
const AZURE_REGION = process.env.AZURE_REGION ? process.env.AZURE_REGION.trim() : 'westeurope';

app.post('/api/generate', async (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY || !AZURE_REGION) {
        return res.status(500).json({ error: 'Lipsește API Key sau Regiunea Azure din Coolify.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    // Setam vocea. Default punem vocea virala Emil
    const selectedVoice = voiceId || 'ro-RO-EmilNeural';

    const ssml = `
        <speak version='1.0' xml:lang='ro-RO'>
            <voice xml:lang='ro-RO' name='${selectedVoice}'>
                ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
        </speak>
    `;

    try {
        // PASUL 1: Cerem Token-ul de autorizare pentru cheile noi tip Foundry
        const tokenResponse = await axios.post(
            `https://${AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
            null,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY
                }
            }
        );
        const accessToken = tokenResponse.data;

        // PASUL 2: Generam audio-ul folosind Token-ul
        const response = await axios.post(
            `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`, // Folosim Bearer Token in loc de cheie directa
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
                    'User-Agent': 'Viralio'
                },
                responseType: 'arraybuffer'
            }
        );

        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("Eroare Azure:", error.message);
        if (error.response && error.response.status === 401) {
            return res.status(401).json({ error: 'Eroare Azure 401: Cheie respinsă. Așteaptă 10 minute pentru propagare.' });
        }
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Azure Voice ruleaza pe portul ${PORT}`);
    console.log(`🔑 Status Cheie: ${AZURE_KEY ? 'Încarcată' : 'LIPSEȘTE'}`);
    console.log(`🌍 Regiune: ${AZURE_REGION}`);
});