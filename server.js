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

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.trim() : null;
const replicate = new Replicate({ auth: REPLICATE_TOKEN });

app.post('/api/generate', async (req, res) => {
    const { text, voice } = req.body;

    if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Lipsește API Token Replicate in Coolify.' });
    if (!text) return res.status(400).json({ error: 'Introdu textul pentru generare.' });

    try {
        console.log(`[Viralio 2.5 HD] Procesam vocea: ${voice || 'Paul'}`);
        
        // REZOLVAREA ERORII 422: Replicate cere "prompt" si un nume exact din lista lor
        const output = await replicate.run(
            "elevenlabs/turbo-v2.5", 
            {
                input: {
                    prompt: text, // Aici era buba! Replicate foloseste 'prompt', nu 'text'
                    voice: voice || "Paul" // Vocea default (daca pui Adam aici da eroare 422)
                }
            }
        );

        console.log("[Viralio] Audio generat cu succes!");
        res.json({ audioUrl: output });

    } catch (error) {
        console.error("❌ Eroare Replicate:", error);
        res.status(500).json({ error: 'A aparut o eroare la generarea vocii.' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Viralio Voice ruleaza pe portul ${PORT}`));