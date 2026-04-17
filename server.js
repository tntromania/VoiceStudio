require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurare Google & Replicate
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Foldere Stocare
const DOWNLOAD_DIR = path.join(__dirname, 'public', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Voice AI conectat la MongoDB!'))
    .catch(err => console.error('❌ Eroare MongoDB:', err));

// Schema User (Fix ca la Captions + voice_characters)
// 1. Schema unică, completă și identică pe toate aplicațiile
const UserSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    picture: String,
    credits: { type: Number, default: 10 }, // Universal: 10 credite
    voice_characters: { type: Number, default: 3000 }, // Universal: 3000 caractere
    createdAt: { type: Date, default: Date.now }
});

// 2. Crearea modelului (Atenție la o eroare comună în Mongoose unde re-definirea aruncă eroare)
const User = mongoose.models.User || mongoose.model('User', UserSchema);

// Middleware Autentificare
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Trebuie să fii logat!" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (e) { return res.status(401).json({ error: "Sesiune expirată." }); }
};

// ==========================================
// RUTE AUTH (FIX CA LA CAPTION)
// ==========================================
app.post('/api/auth/google', async (req, res) => {
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        let user = await User.findOne({ googleId: payload.sub });
        
if (!user) {
            user = new User({ 
                googleId: payload.sub, 
                email: payload.email, 
                name: payload.name, 
                picture: payload.picture, 
                credits: 10,             // Sincronizat cu HUB
                voice_characters: 3000   // Sincronizat cu HUB
            });
            await user.save();
        }
        
        const sessionToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            token: sessionToken, 
            user: { name: user.name, picture: user.picture, credits: user.credits, voice_characters: user.voice_characters } 
        });
    } catch (error) { res.status(400).json({ error: "Eroare Google" }); }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ user: { name: user.name, picture: user.picture, credits: user.credits, voice_characters: user.voice_characters } });
});

// ==========================================
// LOGICA GENERARE VOCE (REPARATA)
// ==========================================
function downloadAudio(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
}

app.post('/api/generate', authenticate, async (req, res) => {
    try {
        const { text, voice, stability, similarity_boost, speed } = req.body;
        const user = await User.findById(req.userId);

if (!text) return res.status(400).json({ error: "Script text lipsă." });
        
        // 🚨 NUMĂRĂTOARE CORECTĂ: Scoatem toate spațiile și enter-urile înainte să calculăm costul
        const textWithoutSpaces = text.replace(/\s+/g, '');
        const cost = textWithoutSpaces.length;

        if (user.voice_characters < cost) {
            return res.status(403).json({ error: `Fonduri insuficiente. Ai nevoie de ${cost} caractere.` });
        }

        console.log(`🎙️ Generare voce: ${voice} pentru ${user.name}`);

        const outputUrl = await replicate.run(
            "elevenlabs/turbo-v2.5",
            {
                input: {
                    prompt: text,
                    voice: voice || "Paul",
                    stability: parseFloat(stability) || 0.5,
                    similarity_boost: parseFloat(similarity_boost) || 0.75,
                    speed: parseFloat(speed) || 1.0
                }
            }
        );

        const fileName = `voice_${Date.now()}.mp3`;
        const filePath = path.join(DOWNLOAD_DIR, fileName);
        
        await downloadAudio(outputUrl, filePath);
        
        user.voice_characters -= cost;
        await user.save();

        res.json({ audioUrl: `/downloads/${fileName}`, remaining_chars: user.voice_characters });

} catch (error) {
        console.error("ERROR VOICE GEN:", error.message || error);
        
        // Dacă eroarea vine de la limita impusă de Replicate (429 Too Many Requests)
        if (error.response && error.response.status === 429 || error.status === 429 || (error.message && error.message.includes('429'))) {
            return res.status(429).json({ error: "Sistemul este suprasolicitat. Te rugăm să aștepți 5 secunde între generări!" });
        }

        // Pentru orice altă eroare
        res.status(500).json({ error: "Eroare tehnică la generarea vocii. Încearcă din nou." });
    }
});

// Curatare fisiere vechi (24h)
setInterval(() => {
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && (Date.now() - stats.mtimeMs > 86400000)) fs.unlink(filePath, () => {});
            });
        });
    });
}, 3600000);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Voice Studio ruleaza pe ${PORT}!`));
