require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

// === Provider router cu fallback automat ===
const providerRouter = require('./providers/router');

const app = express();
const PORT = process.env.PORT || 3000;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const DOWNLOAD_DIR = path.join(__dirname, 'public', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Voice AI conectat la MongoDB!');
        cleanStaleTasks();
    })
    .catch(err => console.error('❌ Eroare MongoDB:', err));

// ==========================================
// SCHEMA USER
// ==========================================
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

// ==========================================
// SCHEMA VOICE TASK
// ==========================================
const VoiceTaskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    audioUrl: String,
    text: String,
    voice: String,
    cost: Number,
    provider: { type: String, default: 'minimax' },     // minimax | elevenlabs (engine)
    providerUsed: { type: String, default: null },      // ai33 | dubvoice (cine a generat efectiv)
    error: String,
    remaining_chars: Number,
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});
const VoiceTask = mongoose.models.VoiceTask || mongoose.model('VoiceTask', VoiceTaskSchema);

// ==========================================
// CURĂȚARE TASK-URI BLOCATE LA STARTUP
// ==========================================
async function cleanStaleTasks() {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const staleTasks = await VoiceTask.find({
            status: 'pending',
            createdAt: { $lt: tenMinutesAgo }
        });
        for (const task of staleTasks) {
            if (task.cost && task.userId) {
                await User.findByIdAndUpdate(task.userId, { $inc: { voice_characters: task.cost } });
                console.log(`↩️ [CLEANUP] Refund ${task.cost} chars pentru task stale ${task._id}`);
            }
            await VoiceTask.findByIdAndUpdate(task._id, {
                status: 'failed',
                error: 'Task expirat — server restartat în timpul generării.'
            });
        }
        if (staleTasks.length) console.log(`🧹 Cleanup: ${staleTasks.length} task-uri stale marcate failed.`);
    } catch(e) {
        console.error('Eroare cleanup stale tasks:', e.message);
    }
}

// ==========================================
// MIDDLEWARE AUTH
// ==========================================
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
// MAPARE NUME VOCE → voice_id (ElevenLabs)
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
// HELPER: Descărcare audio (urmărește redirecturi)
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
// BACKGROUND GENERATION — folosește router-ul cu fallback
// ==========================================
async function runGenerationBackground(taskId, userId, cost, body) {
    const refundChars = async () => {
        try {
            await User.findByIdAndUpdate(userId, { $inc: { voice_characters: cost } });
            console.log(`↩️ [BG-REFUND] ${cost} chars → user ${userId}`);
        } catch(e) { console.error('Eroare refund background:', e.message); }
    };

    try {
        const { text, voice, stability, similarity_boost, speed, provider, voiceId,
                minimaxVoiceId, pitch, vol, language_boost } = body;

        const engineType = (provider === 'minimax') ? 'minimax' : 'elevenlabs';

        // Pregătire parametri pentru router
        let params;
        if (engineType === 'minimax') {
            params = {
                text,
                voiceId: minimaxVoiceId,
                speed, pitch, vol, language_boost
            };
        } else {
            // ElevenLabs — rezolvăm voice_id din voice name dacă e nevoie
            const resolvedVoiceId = voiceId || VOICE_ID_MAP[voice] || VOICE_ID_MAP["Paul"];
            params = {
                text,
                voiceId: resolvedVoiceId,
                stability, similarity_boost, speed
            };
        }

        // === APEL CU FALLBACK AUTOMAT ===
        const { audioUrl: srcUrl, providerUsed } = await providerRouter.generate(engineType, params);

        // Descarcă audio local
        const fileName = `voice_${Date.now()}.mp3`;
        await downloadAudio(srcUrl, path.join(DOWNLOAD_DIR, fileName));
        const audioUrl = `/downloads/${fileName}`;
        console.log(`🎤 [BG-${engineType}/${providerUsed}] ${fileName} pentru task ${taskId}`);

        const freshUser = await User.findById(userId, 'voice_characters');

        await VoiceTask.findByIdAndUpdate(taskId, {
            status: 'completed',
            audioUrl,
            providerUsed,
            remaining_chars: freshUser ? freshUser.voice_characters : null
        });

        console.log(`✅ [BG] Task ${taskId} → COMPLETED (via ${providerUsed})`);

    } catch (error) {
        console.error(`❌ [BG] Task ${taskId} → FAILED:`, error.message);

        await refundChars();

        let errMsg;
        if (error.message?.startsWith('BLOCKED:')) {
            errMsg = error.message.replace('BLOCKED:', '');
        } else {
            errMsg = providerRouter.cleanError(error);
        }

        await VoiceTask.findByIdAndUpdate(taskId, {
            status: 'failed',
            error: errMsg
        });
    }
}

// ==========================================
// RUTĂ GENERARE VOCE — returnează taskId imediat
// ==========================================
app.post('/api/generate', authenticate, async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) return res.status(400).json({ error: "Textul lipsește." });

        const textWithoutSpaces = text.replace(/\s+/g, '');
        const cost = textWithoutSpaces.length;

        const user = await User.findById(req.userId);
        const engineUsed = (req.body.provider === 'minimax') ? 'minimax' : 'elevenlabs';
        console.log(`📝 [${new Date().toLocaleTimeString('ro-RO')}] ${user.name} | chars: ${cost} | voce: ${req.body.voice} | engine: ${engineUsed}`);

        const updatedUser = await User.findOneAndUpdate(
            { _id: req.userId, voice_characters: { $gte: cost } },
            { $inc: { voice_characters: -cost } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(403).json({ error: `Caractere insuficiente. Ai nevoie de ${cost} caractere.` });
        }

        const task = await VoiceTask.create({
            userId: req.userId,
            status: 'pending',
            text: text.substring(0, 200),
            voice: req.body.voice || 'unknown',
            cost,
            provider: req.body.provider || 'minimax'
        });

        res.status(202).json({ taskId: task._id.toString() });

        runGenerationBackground(task._id, req.userId, cost, req.body).catch(e => {
            console.error(`❌ [BG] Uncaught error pentru task ${task._id}:`, e);
        });

    } catch (error) {
        console.error("ERROR /api/generate:", error.message);
        res.status(500).json({ error: error.message || "Eroare tehnică. Încearcă din nou." });
    }
});

// ==========================================
// RUTĂ STATUS TASK
// ==========================================
app.get('/api/task-status/:taskId', authenticate, async (req, res) => {
    try {
        const task = await VoiceTask.findOne({
            _id: req.params.taskId,
            userId: req.userId
        });

        if (!task) return res.status(404).json({ error: 'Task negăsit sau expirat.' });

        res.json({
            status: task.status,
            audioUrl: task.audioUrl || null,
            remaining_chars: task.remaining_chars ?? null,
            error: task.error || null,
            provider: task.provider,
            providerUsed: task.providerUsed || null,   // util pentru debug pe client
            voice: task.voice,
            text: task.text
        });
    } catch(e) {
        res.status(404).json({ error: 'Task ID invalid.' });
    }
});

// ==========================================
// RUTĂ REFUND CARACTERE (compatibilitate)
// ==========================================
app.post('/api/refund-chars', authenticate, async (req, res) => {
    try {
        const { cost } = req.body;
        if (!cost || isNaN(cost) || cost <= 0) return res.status(400).json({ error: 'Cost invalid.' });
        const updated = await User.findByIdAndUpdate(
            req.userId,
            { $inc: { voice_characters: Math.floor(cost) } },
            { new: true }
        );
        console.log(`↩️ [REFUND] ${Math.floor(cost)} chars → user ${req.userId} | total: ${updated.voice_characters}`);
        res.json({ voice_characters: updated.voice_characters });
    } catch(e) {
        console.error('Eroare refund:', e.message);
        res.status(500).json({ error: 'Refund eșuat.' });
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

// ==========================================
// RUTĂ VOCI MINIMAX (cu fallback)
// ==========================================
app.get('/api/voices/minimax', async (req, res) => {
    try {
        const { voices, providerUsed } = await providerRouter.listMinimaxVoices();
        res.json({ voices, total: voices.length, providerUsed });
    } catch (error) {
        console.error('Eroare voci Minimax (ambii provideri):', error.message);
        res.status(500).json({ error: 'Nu s-au putut încărca vocile Minimax.' });
    }
});

// ==========================================
// RUTĂ STATUS PROVIDERI (debug / monitoring)
// ==========================================
app.get('/api/providers/status', (req, res) => {
    res.json(providerRouter.getStatus());
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`🚀 Voice Studio rulează pe portul ${PORT}!`);
    console.log(`🎯 PRIMAR: ai33.pro | SECUNDAR: dubvoice.ai`);
    console.log(`⚙️  Timeout primar: 12s | Retries: 1 | Circuit breaker: 15 min`);
});