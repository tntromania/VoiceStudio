require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Replicate = require('replicate');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Preluăm variabilele de mediu
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.trim() : null;
const MONGO_URI = process.env.MONGO_URI;
// Atenție: JWT_SECRET trebuie să fie ACELAȘI pe care îl folosești și la Auth/Hub!
const JWT_SECRET = process.env.JWT_SECRET; 

const replicate = new Replicate({ auth: REPLICATE_TOKEN });

// Conectarea la Baza de Date
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectat la baza de date Viralio (MongoDB)'))
  .catch(err => console.error('❌ Eroare DB:', err));

// Schema (pentru a putea citi și scrie caracterele și creditele)
const UserSchema = new mongoose.Schema({
    credits: Number,
    voice_characters: Number
}, { strict: false }); 
const User = mongoose.model('User', UserSchema);

// RUTA DE GENERARE VOCE AI
app.post('/api/generate', async (req, res) => {
    const { text, voice, stability, similarity_boost } = req.body;

    if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Lipsește API Token Replicate.' });
    if (!text) return res.status(400).json({ error: 'Script text lipsă.' });

    // 1. Verificare Token (Utilizator logat)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Neautorizat. Te rugăm să te conectezi.' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Token invalid sau expirat.' });
    }

    try {
        // 2. Căutăm userul în BD
        const user = await User.findById(decoded.userId || decoded.id);
        if (!user) return res.status(404).json({ error: 'Utilizator inexistent.' });

        const cost = text.length; // Costul e egal cu nr. de caractere
        const currentChars = user.voice_characters || 0;

        // 3. Verificăm dacă are fonduri (caractere)
        if (currentChars < cost) {
            return res.status(403).json({ 
                error: `Fonduri insuficiente! Ai nevoie de ${cost} caractere, dar mai ai doar ${currentChars}. Fă upgrade la planul Pro.` 
            });
        }

        console.log(`[Viralio 2.5] Generam: ${voice} | Cost: ${cost} caractere. User ID: ${user._id}`);
        
        // 4. TRITEM CEREREA CĂTRE REPLICATE (Aici am reparat "{ ... }")
        const output = await replicate.run(
            "elevenlabs/turbo-v2.5", 
            {
                input: {
                    prompt: text, // Replicate cere 'prompt' obligatoriu
                    voice: voice || "Paul",
                    stability: parseFloat(stability) || 0.5,
                    similarity_boost: parseFloat(similarity_boost) || 0.75
                }
            }
        );

        // 5. Scădem caracterele din baza de date și salvăm
        user.voice_characters = currentChars - cost;
        await user.save();

        console.log(`[Viralio 2.5] Succes! Balanță nouă: ${user.voice_characters} caractere.`);
        
        // Returnăm audio-ul și noul număr de caractere către interfață
        res.json({ audioUrl: output, remaining_chars: user.voice_characters });

    } catch (error) {
        console.error("❌ Eroare la generare:", error.message || error);
        res.status(500).json({ error: 'A apărut o eroare tehnică la generarea vocii.' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Viralio Voice (Portofel Dublu) ruleaza pe portul ${PORT}`));