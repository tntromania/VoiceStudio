require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurare Google
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Voice AI Config
const AI33_API_KEY = process.env.AI33_API_KEY;
const AI33_BASE_URL = 'https://api.ai33.pro';

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

// Schema User
const UserSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    picture: String,
    credits: { type: Number, default: 10 },
    voice_characters: { type: Number, default: 3000 },
    createdAt: { type: Date, default: Date.now }
});

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
// RUTE AUTH
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
                credits: 10,
                voice_characters: 3000
            });
            await user.save();
        }

        const sessionToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token: sessionToken,
            user: { name: user.name, picture: user.picture, credits: user.credits, voice_characters: user.voice_characters }
        });
    } catch (error) { res.status(400).json({ error: "Eroare la autentificare. Încearcă din nou." }); }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ user: { name: user.name, picture: user.picture, credits: user.credits, voice_characters: user.voice_characters } });
});

// ==========================================
// HELPER: Mapare Nume Voce → voice_id
// ==========================================
const VOICE_ID_MAP = {
    "Paul":       "nPczCjzI2devNBz1zQrb",
    "Drew":       "29vD33N1CtxCmqQRPOHJ",
    "Clyde":      "2EiwWnXFnvU5JabPnv8n",
    "Dave":       "CYw3kZ02Hs0563khs1Fj",
    "Roger":      "CwhRBWXzGAHq8TQ4Fs17",
    "Fin":        "D38z5RcWu1voky8WS1ja",
    "James":      "ZQe5CZNOzWyzPSCn5a3c",
    "Bradford":   "EXAVITQu4vr4xnSDxMaL",
    "Reginald":   "onwK4e9ZLuTAKqWW03F9",
    "Austin":     "g5CIjZEefAph4nQFvHAz",
    "Mark":       "UgBBYS2sOqTuMpoF3BR0",
    "Grimblewood":"N2lVS1w4EtoT3dr4eOWO",
    "Rachel":     "21m00Tcm4TlvDq8ikWAM",
    "Aria":       "9BWtsMINqrJLrRacOk9x",
    "Domi":       "AZnzlk1XvdvUeBnXmlld",
    "Sarah":      "EXAVITQu4vr4xnSDxMaL",
    "Jane":       "Xb7hH8MSUJpSbSDYk0k2",
    "Juniper":    "zcAOhNBS3c14rBihAFp1",
    "Arabella":   "jBpfuIE2acCO8z3wKNLl",
    "Hope":       "ODq5zmih8GrVes37Dx9b",
    "Blondie":    "XrExE9yKIg1WjnnlVkGX",
    "Priyanka":   "c1Yh0AkPmCiEa4bBMJJU",
    "Alexandra":  "ThT5KcBeYPX3keUQqHPh",
    "Monika":     "TX3LPaxmHKxFdv7VOQHJ",
    "Gaming":     "IKne3meq5aSn9XLyUdCD",
    "Kuon":       "pMsXgVXv3BLzUgSXRplE"
};

// ==========================================
// HELPER: Descărcare fișier audio
// ==========================================
function downloadAudio(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                return downloadAudio(response.headers.location, dest).then(resolve).catch(reject);
            }
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
}

// ==========================================
// HELPER: Polling task până la finalizare
// ==========================================
async function pollTask(taskId, maxWait = 60000) {
    const interval = 3000;
    const maxAttempts = Math.floor(maxWait / interval);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, interval));

        let response;
        try {
            response = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
                headers: { 'xi-api-key': AI33_API_KEY },
                signal: AbortSignal.timeout(10000)
            });
        } catch (fetchErr) {
            console.warn(`⚠️ Polling eroare attempt ${i+1}: ${fetchErr.message}`);
            continue;
        }

        if (response.status === 503 || response.status === 502) {
            console.warn(`⚠️ Server vocal ${response.status}, attempt ${i+1}, reîncercăm...`);
            continue;
        }
        if (!response.ok) throw new Error(`Eroare internă server: ${response.status}`);

        const task = await response.json();

        if (task.status === 'done') {
            const audioUrl = task.metadata?.audio_url || task.output_uri || task.metadata?.output_uri;
            if (!audioUrl) throw new Error("Generarea a fost finalizată dar fișierul audio nu este disponibil.");
            return audioUrl;
        }

        if (task.status === 'error' || task.status === 'failed') {
            throw new Error("Eroare la procesarea vocii. Încearcă din nou.");
        }
    }

    throw new Error("Generarea a durat prea mult. Încearcă din nou în câteva secunde.");
}

// ==========================================
// RUTĂ GENERARE VOCE
// ==========================================
app.post('/api/generate', authenticate, async (req, res) => {
    try {
        const { text, voice, stability, similarity_boost, speed } = req.body;
        const user = await User.findById(req.userId);

        console.log(`📝 [${new Date().toLocaleTimeString('ro-RO')}] ${user.name} (${user.email}) | chars: ${text?.length || 0} (fără spații: ${(text || '').replace(/\s+/g, '').length}) | voce: ${voice}`);

        if (!text) return res.status(400).json({ error: "Textul lipsește." });

        const textWithoutSpaces = text.replace(/\s+/g, '');
        const cost = textWithoutSpaces.length;

        if (user.voice_characters < cost) {
            return res.status(403).json({ error: `Caractere insuficiente. Ai nevoie de ${cost} caractere.` });
        }

        const voiceId = req.body.voiceId || VOICE_ID_MAP[voice] || VOICE_ID_MAP["Paul"];
        const modelId = "eleven_multilingual_v2";

        console.log(`🎙️ Generare voce: ${voice} (${voiceId}) pentru ${user.name}`);

        let voiceResponse;
        try {
            voiceResponse = await fetch(
                `${AI33_BASE_URL}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': AI33_API_KEY
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: modelId,
                        voice_settings: {
                            stability: parseFloat(stability) || 0.5,
                            similarity_boost: parseFloat(similarity_boost) || 0.75,
                            speed: parseFloat(speed) || 1.0
                        },
                        with_transcript: false
                    }),
                    signal: AbortSignal.timeout(15000)
                }
            );
        } catch (fetchErr) {
            if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError')
                return res.status(503).json({ error: "Serverul nu răspunde momentan. Încearcă din nou în câteva secunde." });
            throw fetchErr;
        }

        if (!voiceResponse.ok) {
            const errBody = await voiceResponse.text();
            console.error("Eroare server vocal:", voiceResponse.status, errBody);

            if (voiceResponse.status === 429) {
                return res.status(429).json({ error: "Serverul este suprasolicitat momentan. Așteaptă 5-10 secunde și încearcă din nou!" });
            }
            if (voiceResponse.status === 401) {
                return res.status(500).json({ error: "Eroare internă de configurare. Contactează suportul." });
            }
            if (voiceResponse.status === 503 || voiceResponse.status === 502) {
                return res.status(503).json({ error: "Serverul vocal este în mentenanță. Revino în câteva minute!" });
            }
            throw new Error(`Eroare internă la procesarea vocii (${voiceResponse.status})`);
        }

        const responseData = await voiceResponse.json();

        if (!responseData.success || !responseData.task_id) {
            throw new Error("Eroare internă la inițializarea generării.");
        }

        console.log(`✅ Task creat: ${responseData.task_id}`);

        const outputUrl = await pollTask(responseData.task_id);

        const fileName = `voice_${Date.now()}.mp3`;
        const filePath = path.join(DOWNLOAD_DIR, fileName);
        await downloadAudio(outputUrl, filePath);

        user.voice_characters -= cost;
        await user.save();

        res.json({ audioUrl: `/downloads/${fileName}`, remaining_chars: user.voice_characters });

    } catch (error) {
        console.error("ERROR VOICE GEN:", error.message || error);

        if (error.message && error.message.includes('429')) {
            return res.status(429).json({ error: "Serverul este suprasolicitat momentan. Așteaptă 5-10 secunde și încearcă din nou!" });
        }

        res.status(500).json({ error: error.message || "Eroare tehnică la generarea vocii. Încearcă din nou." });
    }
});

// ==========================================
// CURĂȚARE FIȘIERE VECHI (24h)
// ==========================================
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

app.listen(PORT, () => console.log(`🚀 Voice Studio rulează pe portul ${PORT}!`));
