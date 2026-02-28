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

// Preluam cheile
const AZURE_KEY = process.env.AZURE_API_KEY ? process.env.AZURE_API_KEY.trim() : null;
const AZURE_REGION = process.env.AZURE_REGION ? process.env.AZURE_REGION.trim() : 'eastus';

// Functie secreta: Cere un Token de Acces de la Microsoft inainte de generare
async function getAccessToken() {
    try {
        const response = await axios.post(
            `https://${AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
            null,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY
                }
            }
        );
        return response.data; // Asta e Token-ul lung de care are nevoie serverul de voce
    } catch (error) {
        throw new Error("Nu s-a putut obține Token-ul Azure. Verifică API Key-ul.");
    }
}

app.post('/api/generate', async (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY) {
        return res.status(500).json({ error: 'Lipsește API Key Azure.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

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
        // PASUL 1: Obtinem Biletul de Voie (Token)
        const token = await getAccessToken();

        // PASUL 2: Generam sunetul folosind Token-ul (NU cheia directa)
        const response = await axios.post(
            `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    // Aici trimitem Tokenul obtinut, NU AZURE_KEY!
                    'Authorization': `Bearer ${token}`, 
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
                    'User-Agent': 'Viralio'
                },
                responseType: 'arraybuffer' // Extrem de important pentru fisiere audio
            }
        );

        // Trimitem melodia MP3 spre front-end
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        console.error("❌ Eroare Generare Azure:", error.response?.status);
        if (error.response && error.response.data) {
            console.error("❌ Detalii Azure:", Buffer.from(error.response.data).toString('utf8'));
        }
        res.status(500).json({ error: 'Eroare la generarea vocii. Posibil ca abonamentul Azure sa nu fie activat.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Azure Voice ruleaza pe portul ${PORT}`);
    console.log(`🔑 Key detectat: ${AZURE_KEY ? 'OK' : 'LIPSESTE'}`);
    console.log(`🌍 Regiune: ${AZURE_REGION}`);
});