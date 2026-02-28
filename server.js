require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
// Importam magicul SDK oficial gasit de tine
const sdk = require("microsoft-cognitiveservices-speech-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Curatam cheile la fel ca inainte
const AZURE_KEY = process.env.AZURE_API_KEY ? process.env.AZURE_API_KEY.trim() : null;
const AZURE_REGION = process.env.AZURE_REGION ? process.env.AZURE_REGION.trim() : 'eastus';

app.post('/api/generate', (req, res) => {
    const { text, voiceId } = req.body;

    if (!AZURE_KEY) {
        return res.status(500).json({ error: 'Lipsește API Key Azure.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    const selectedVoice = voiceId || 'ro-RO-EmilNeural';

    // SSML-ul pentru pronuntie perfecta in limba romana
    const ssml = `
        <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ro-RO'>
            <voice name='${selectedVoice}'>
                ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
        </speak>
    `.trim();

    console.log(`[SDK] Incepem generarea pentru: ${selectedVoice}...`);

    try {
        // Configurarea SDK-ului cu cheia ta buclucasa de 84 de caractere
        const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_KEY, AZURE_REGION);
        
        // Vrem format MP3 de inalta claritate
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3;

        // Punem "null" la audioConfig ca sa prindem fisierul in memorie, nu sa-l cantam pe server
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

        // Functia asincrona din SDK
        synthesizer.speakSsmlAsync(
            ssml,
            result => {
                // E FOARTE IMPORTANT sa inchidem sintetizatorul, altfel consuma toata memoria serverului
                synthesizer.close();

                if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                    console.log("[SDK] Magic! Fisier generat cu succes. Trimit catre browser.");
                    
                    // Transformam rezultatul din SDK intr-un fisier trimis pe HTTP
                    const audioBuffer = Buffer.from(result.audioData);
                    res.setHeader('Content-Type', 'audio/mpeg');
                    res.send(audioBuffer);
                    
                } else {
                    console.error("[SDK] Eroare la sintetizare: " + result.errorDetails);
                    res.status(500).json({ error: 'Eroare la generare din Azure SDK.', details: result.errorDetails });
                }
            },
            error => {
                console.error("[SDK] Eroare interna fatala:", error);
                synthesizer.close();
                res.status(500).json({ error: 'A crapat conexiunea cu Azure.' });
            }
        );

    } catch (err) {
        console.error("Eroare Catch bloc:", err);
        res.status(500).json({ error: 'Eroare la initializarea SDK-ului.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Azure Voice SDK Edition ruleaza pe portul ${PORT}`);
    console.log(`🔑 Key detectat: ${AZURE_KEY ? AZURE_KEY.length + ' caractere (Gata de treaba)' : 'LIPSESTE'}`);
    console.log(`🌍 Regiune: ${AZURE_REGION}`);
});