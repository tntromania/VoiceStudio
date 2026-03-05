require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Replicate = require('replicate');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const https = require('https'); // Avem nevoie pt a descarca fisierul

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Asiguram crearea folderului downloads in caz ca nu exista
const DOWNLOAD_DIR = path.join(__dirname, 'public', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Preluăm variabilele de mediu
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ? process.env.REPLICATE_API_TOKEN.trim() : null;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET; 

const replicate = new Replicate({ auth: REPLICATE_TOKEN });

// Conectarea la Baza de Date
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectat la baza de date Viralio (MongoDB)'))
  .catch(err => console.error('❌ Eroare DB:', err));

const UserSchema = new mongoose.Schema({
    credits: Number,
    voice_characters: Number
}, { strict: false }); 
const User = mongoose.model('User', UserSchema);

// Functie helper pentru a descarca fisierul MP3 pe serverul nostru (Rezolva problema expirarii)
function downloadAudio(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // Daca da eroare, sterge fărâma descarcată
            reject(err);
        });
    });
}

// RUTA DE GENERARE VOCE AI
app.post('/api/generate', async (req, res) => {
    // Acum preluam si "speed"
    const { text, voice, stability, similarity_boost, speed } = req.body;

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

        const cost = text.length; 
        const currentChars = user.voice_characters || 0;

        // 3. Verificăm dacă are fonduri
        if (currentChars < cost) {
            return res.status(403).json({ 
                // EROARE REPARATĂ! Acum specifică "caractere" clar.
                error: `Fonduri insuficiente! Ai nevoie de ${cost} caractere, dar mai ai doar ${currentChars}. Fă upgrade la un pachet superior din Ecosistem.` 
            });
        }

        console.log(`[Viralio 2.5] Generam: ${voice} | Cost: ${cost} caractere. User ID: ${user._id}`);
        
        // 4. TRITEM CEREREA CĂTRE REPLICATE 
        const outputUrl = await replicate.run(
            "elevenlabs/turbo-v2.5", 
            {
                input: {
                    prompt: text,
                    voice: voice || "Paul",
                    stability: parseFloat(stability) || 0.5,
                    similarity_boost: parseFloat(similarity_boost) || 0.75,
                    // Replicate acceptă adesea speech_speed sau asemănător, verifică docurile lor, eu pun parametrii comuni
                    // unii folosesc parametrul "speed" direct
                    speed: parseFloat(speed) || 1.0 
                }
            }
        );

        // 5. Descărcăm MP3-ul local pe serverul tău pentru a nu mai expira după 30 de minute!
        const fileName = `voice_${Date.now()}_${Math.floor(Math.random()*100)}.mp3`;
        const filePath = path.join(DOWNLOAD_DIR, fileName);
        
        await downloadAudio(outputUrl, filePath);
        
        // Creăm link-ul final ce va fi trimis către client
        const localUrl = `/downloads/${fileName}`;

        // 6. Scădem caracterele din baza de date și salvăm
        user.voice_characters = currentChars - cost;
        await user.save();

        console.log(`[Viralio 2.5] Succes! Balanță nouă: ${user.voice_characters} caractere. Fisier salvat: ${fileName}`);
        
        // Returnăm audio-ul PERMANENT și noul număr de caractere către interfață
        res.json({ audioUrl: localUrl, remaining_chars: user.voice_characters });

    } catch (error) {
        console.error("❌ Eroare la generare:", error.message || error);
        res.status(500).json({ error: 'A apărut o eroare tehnică la generarea vocii.' });
    }
});

// Autocurațare fișiere mai vechi de 24 ore (Ca să nu se umple serverul tău Coolify)
setInterval(() => {
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                // Dacă fișierul e mai vechi de 24 de ore (86400000 ms), îl ștergem
                if (now - stats.mtimeMs > 86400000) {
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
}, 3600000); // Ruleaza verificarea o data pe ora

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Viralio Voice ruleaza pe portul ${PORT}`));