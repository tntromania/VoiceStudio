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

// Preluam datele si stergem mecanic absolut orice spatiu invizibil
const AZURE_KEY = process.env.AZURE_API_KEY ? process.env.AZURE_API_KEY.trim() : null;
const AZURE_REGION = process.env.AZURE_REGION ? process.env.AZURE_REGION.trim() : 'eastus';

app.post('/api/generate', async (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY || !AZURE_REGION) {
        return res.status(500).json({ error: 'Lipsește API Key sau Regiunea Azure din variabile.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    // Setam vocea. Default punem vocea virala Emil
    const selectedVoice = voiceId || 'ro-RO-EmilNeural';

    // Formatul SSML acceptat de Azure
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
                    // SOLUTIA MAGICA PENTRU CHEILE FOUNDRY:
                    'Ocp-Apim-Subscription-Region': AZURE_REGION, 
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
                    'User-Agent': 'Viralio'
                },
                responseType: 'arraybuffer'
            }
        );

        // Trimitem melodia MP3 spre front-end
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("❌ Eroare Azure HTTP Code:", error.response?.status);
        if (error.response && error.response.data) {
            const errText = Buffer.from(error.response.data).toString('utf8');
            console.error("❌ Detalii refuz Azure:", errText);
        }
        
        if (error.response?.status === 401) {
             return res.status(401).json({ error: 'Eroare 401: Acces Respins. Verifică log-urile din Coolify.' });
        }
        
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Azure Voice ruleaza pe portul ${PORT}`);
    console.log(`🔑 Key detectat: ${AZURE_KEY ? (AZURE_KEY.length + ' caractere (OK)') : 'LIPSESTE'}`);
    console.log(`🌍 Regiune setata: ${AZURE_REGION}`);
});