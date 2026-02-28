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

// CURĂȚARE EXTREMĂ: Ștergem orice spațiu și orice ghilimea pusă accidental în Coolify
let AZURE_KEY = process.env.AZURE_API_KEY || '';
AZURE_KEY = AZURE_KEY.replace(/['"]/g, '').trim(); 

let AZURE_REGION = process.env.AZURE_REGION || 'eastus';
AZURE_REGION = AZURE_REGION.replace(/['"]/g, '').trim();

app.post('/api/generate', async (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY) {
        return res.status(500).json({ error: 'Lipsește API Key Azure din variabile.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    // Setam vocea
    const selectedVoice = voiceId || 'ro-RO-EmilNeural';

    // SSML CORECTAT 100% cu xmlns cerut de Microsoft (aici era buba tacuta)
    const ssml = `
        <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ro-RO'>
            <voice name='${selectedVoice}'>
                ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
        </speak>
    `.trim();

    try {
        console.log(`[Azure] Trimitere request spre: ${selectedVoice} in regiunea ${AZURE_REGION}`);

        const response = await axios.post(
            `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': AZURE_KEY,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
                    'User-Agent': 'Viralio'
                },
                responseType: 'arraybuffer' // Magic word pentru a primi mp3
            }
        );

        console.log(`[Azure] Succes! Fisier generat.`);
        
        // Trimitem melodia MP3 spre front-end
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(response.data);

    } catch (error) {
        // SISTEMUL NOU DE EROARE (ne spune fix ce-l doare pe Microsoft)
        console.error("❌ Eroare in Catch:", error.message);
        
        if (error.response) {
            console.error("❌ Status Microsoft:", error.response.status);
            
            // Transformam buffer-ul primit de la ei in text citibil ca sa aflam cauza
            let errText = "Eroare necunoscuta.";
            if (Buffer.isBuffer(error.response.data)) {
                errText = error.response.data.toString('utf8');
            } else if (typeof error.response.data === 'string') {
                errText = error.response.data;
            } else {
                errText = JSON.stringify(error.response.data);
            }
            console.error("❌ Mesaj direct de la Azure:", errText);
            
            if (error.response.status === 401) {
                return res.status(401).json({ error: 'Eroare 401: Cheie respinsă. Asigură-te că valoarea din Coolify e pusă corect, fără spații.' });
            }
        }
        
        res.status(500).json({ error: 'Eroare la generarea vocii.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Azure Voice ruleaza pe portul ${PORT}`);
    console.log(`🔑 Key detectat: ${AZURE_KEY.length} caractere`);
    console.log(`🌍 Regiune setata: ${AZURE_REGION}`);
});