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

// O bucată conceptuală pentru server.js
app.post('/api/generate', async (req, res) => {
    const { text, voice } = req.body;
    
    // 1. Preluam Token-ul si verificam user-ul in baza ta de date
    const token = req.headers.authorization.split(' ')[1];
    const user = await verifyTokenAndGetUser(token); 
    
    if (!user) return res.status(401).json({ error: "Neautorizat" });

    // 2. VERIFICARE PORTOFEL VOCE
    const cost = text.length;
    if (user.voice_characters < cost) {
        return res.status(403).json({ 
            error: `Fonduri insuficiente. Ai nevoie de ${cost} caractere, dar mai ai doar ${user.voice_characters}. Fă upgrade la PRO.` 
        });
    }

    try {
        // 3. Generam vocea prin Replicate (exact cum am scris mai sus)
        const output = await replicate.run("elevenlabs/turbo-v2.5", { ... });

        // 4. SCĂDEM CARACTERELE DIN BAZA DE DATE
        await User.updateOne(
            { _id: user._id }, 
            { $inc: { voice_characters: -cost } } // $inc cu minus scade direct valoarea
        );

        // 5. Trimitem succes
        res.json({ audioUrl: output, remaining_chars: user.voice_characters - cost });

    } catch (error) {
        res.status(500).json({ error: 'Eroare la generare.' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Viralio Voice ruleaza pe portul ${PORT}`));