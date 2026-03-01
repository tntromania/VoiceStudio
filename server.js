require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Token-ul Replicate din Coolify (sectiunea Environment Variables)
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.trim() : null;

const replicate = new Replicate({
    auth: REPLICATE_TOKEN,
});

app.post('/api/generate', async (req, res) => {
    // Preluam ABSOLUT toate setarile avansate trimise de tine din frontend
    const { 
        text, 
        voiceId, 
        stability, 
        similarity_boost, 
        style, 
        use_speaker_boost 
    } = req.body;

    if (!REPLICATE_TOKEN) {
        return res.status(500).json({ error: 'Lipsește REPLICATE_API_TOKEN din variabilele Coolify.' });
    }
    if (!text) return res.status(400).json({ error: 'Introdu textul.' });

    try {
        console.log(`[ElevenLabs Turbo v2.5] Procesam vocea: ${voiceId}`);
        
        // Apelam modelul oficial ElevenLabs Turbo v2.5 gazduit pe Replicate
        const output = await replicate.run(
            "elevenlabs/turbo-v2.5", 
            {
                input: {
                    text: text,
                    voice: voiceId || "Adam", // Default Adam daca nu alege nimic
                    stability: parseFloat(stability) || 0.5,
                    similarity_boost: parseFloat(similarity_boost) || 0.75,
                    style: parseFloat(style) || 0.0,
                    use_speaker_boost: use_speaker_boost === true
                }
            }
        );

        // Replicate ne ofera direct un URL cloud securizat catre fisierul MP3!
        console.log("[ElevenLabs] Succes! Link audio generat.");
        res.json({ audioUrl: output });

    } catch (error) {
        console.error("❌ Eroare ElevenLabs/Replicate:", error);
        res.status(500).json({ error: 'Eroare la generarea vocii premium. Verifica Token-ul Replicate in Coolify.' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Voice Engine (ElevenLabs Turbo v2.5) ruleaza pe portul ${PORT}`);
    console.log(`🔑 Replicate Token: ${REPLICATE_TOKEN ? 'Conectat' : 'LIPSESTE'}`);
});