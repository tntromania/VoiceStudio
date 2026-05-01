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

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const AI33_API_KEY = process.env.AI33_API_KEY;
const AI33_BASE_URL = 'https://api.ai33.pro';

const DOWNLOAD_DIR = path.join(__dirname, 'public', 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Voice AI conectat la MongoDB!');
        cleanStaleTasks(); // Curăță task-urile blocate la startup
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
// SCHEMA VOICE TASK — persistență generări
// ==========================================
const VoiceTaskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    audioUrl: String,
    text: String,           // primele 200 chars, pentru afișare
    voice: String,
    cost: Number,
    provider: { type: String, default: 'minimax' },
    error: String,
    remaining_chars: Number,
    createdAt: { type: Date, default: Date.now, expires: 86400 } // auto-ștergere după 24h
});
const VoiceTask = mongoose.models.VoiceTask || mongoose.model('VoiceTask', VoiceTaskSchema);

// ==========================================
// CURĂȚARE TASK-URI BLOCATE LA STARTUP
// Task-urile 'pending' mai vechi de 10 min → failed + refund
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
// MIDDLEWARE AUTENTIFICARE
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
// HELPER: Generare cu Minimax
// ==========================================
async function generateWithMinimax(text, voiceId, speed, pitch, vol, language_boost) {
    const minimaxVoiceId = voiceId || '226893671006276'; // Graceful Lady (fallback default)

    const response = await fetch(`${AI33_BASE_URL}/v1m/task/text-to-speech`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': AI33_API_KEY
        },
        body: JSON.stringify({
            text: text,
            model: 'speech-2.6-hd',
            voice_setting: {
                voice_id: minimaxVoiceId,
                vol: parseFloat(vol) || 1.0,
                pitch: parseInt(pitch) || 0,
                speed: parseFloat(speed) || 1.0
            },
            language_boost: language_boost || 'Auto',
            with_transcript: false
        }),
        signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Minimax error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    if (!data.success || !data.task_id) {
        throw new Error('Minimax: eroare la inițializarea generării.');
    }

    console.log(`✅ [Minimax] Task creat: ${data.task_id}`);
    return await pollTask(data.task_id, 300000);
}

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
// HELPER: Polling task ElevenLabs
// ==========================================
async function pollTask(taskId, maxWait = 300000) {
    const interval = 3000;
    const maxAttempts = Math.floor(maxWait / interval);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, interval));

        let response;
        try {
            response = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
                headers: { 'xi-api-key': AI33_API_KEY },
                signal: AbortSignal.timeout(30000)
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
            if (!audioUrl) throw new Error("Generarea finalizată dar fișierul audio nu este disponibil.");
            return audioUrl;
        }

        if (task.status === 'error' || task.status === 'failed') {
            const errMsg = task.error || '';
            if (errMsg.includes('Terms of Service') || errMsg.includes('task-failed') || errMsg.includes('blocked') || errMsg.includes('violate')) {
                throw new Error('BLOCKED:Textul conține conținut blocat de sistemul de moderare. Modifică textul și încearcă din nou.');
            }
            throw new Error(errMsg || "Eroare la procesarea vocii. Încearcă din nou.");
        }
    }

    throw new Error("Generarea a durat prea mult (300s). Încearcă din nou.");
}

// ==========================================
// BACKGROUND GENERATION — rulează async după ce răspunsul HTTP a fost trimis
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
        let audioUrl;

        // ElevenLabs e în mentenanță — forțăm Minimax pe orice request
        // — Minimax —
        const mmUrl = await generateWithMinimax(text, minimaxVoiceId, speed, pitch, vol, language_boost);
        const mmFile = `voice_${Date.now()}.mp3`;
        await downloadAudio(mmUrl, path.join(DOWNLOAD_DIR, mmFile));
        audioUrl = `/downloads/${mmFile}`;
        console.log(`🎙️ [BG-Minimax] ${mmFile} generat pentru task ${taskId}`);

        // Obținem caractere rămase actualizate
        const freshUser = await User.findById(userId, 'voice_characters');

        await VoiceTask.findByIdAndUpdate(taskId, {
            status: 'completed',
            audioUrl,
            remaining_chars: freshUser ? freshUser.voice_characters : null
        });

        console.log(`✅ [BG] Task ${taskId} → COMPLETED`);

    } catch (error) {
        console.error(`❌ [BG] Task ${taskId} → FAILED:`, error.message);

        // Refund caractere
        await refundChars();

        const errMsg = error.message.startsWith('BLOCKED:')
            ? error.message.replace('BLOCKED:', '')
            : (error.message || 'Eroare necunoscută');

        await VoiceTask.findByIdAndUpdate(taskId, {
            status: 'failed',
            error: errMsg
        });
    }
}

// ==========================================
// RUTĂ GENERARE VOCE — returnează taskId imediat, rulează în background
// ==========================================
app.post('/api/generate', authenticate, async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) return res.status(400).json({ error: "Textul lipsește." });

        const textWithoutSpaces = text.replace(/\s+/g, '');
        const cost = textWithoutSpaces.length;

        const user = await User.findById(req.userId);
        console.log(`📝 [${new Date().toLocaleTimeString('ro-RO')}] ${user.name} | chars: ${cost} | voce: ${req.body.voice}`);

        // Deducere atomică ÎNAINTE de generare
        const updatedUser = await User.findOneAndUpdate(
            { _id: req.userId, voice_characters: { $gte: cost } },
            { $inc: { voice_characters: -cost } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(403).json({ error: `Caractere insuficiente. Ai nevoie de ${cost} caractere.` });
        }

        // Creează task în MongoDB
        const task = await VoiceTask.create({
            userId: req.userId,
            status: 'pending',
            text: text.substring(0, 200),
            voice: req.body.voice || 'unknown',
            cost,
            provider: req.body.provider || 'minimax'
        });

        // Răspunde imediat cu taskId (202 Accepted)
        res.status(202).json({ taskId: task._id.toString() });

        // Rulează generarea în background (fără await)
        runGenerationBackground(task._id, req.userId, cost, req.body).catch(e => {
            console.error(`❌ [BG] Uncaught error pentru task ${task._id}:`, e);
        });

    } catch (error) {
        console.error("ERROR /api/generate:", error.message);
        res.status(500).json({ error: error.message || "Eroare tehnică. Încearcă din nou." });
    }
});

// ==========================================
// RUTĂ STATUS TASK — clientul face polling după refresh
// ==========================================
app.get('/api/task-status/:taskId', authenticate, async (req, res) => {
    try {
        const task = await VoiceTask.findOne({
            _id: req.params.taskId,
            userId: req.userId  // securitate: numai userul propriu
        });

        if (!task) return res.status(404).json({ error: 'Task negăsit sau expirat.' });

        res.json({
            status: task.status,           // 'pending' | 'completed' | 'failed'
            audioUrl: task.audioUrl || null,
            remaining_chars: task.remaining_chars ?? null,
            error: task.error || null,
            provider: task.provider,
            voice: task.voice,
            text: task.text
        });
    } catch(e) {
        // ObjectId invalid → 404 curat
        res.status(404).json({ error: 'Task ID invalid.' });
    }
});

// ==========================================
// RUTĂ REFUND CARACTERE (fallback / compatibilitate)
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
// RUTĂ VOCI MINIMAX (200+ voci, paginate)
// ==========================================
app.get('/api/voices/minimax', async (req, res) => {
    try {
        const PAGE_SIZE = 30;
        const TARGET = 210;
        let allVoices = [];
        let page = 1;
        let hasMore = true;

        while (hasMore && allVoices.length < TARGET) {
            const response = await fetch(`${AI33_BASE_URL}/v1m/voice/list`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'xi-api-key': AI33_API_KEY
                },
                body: JSON.stringify({ page, page_size: PAGE_SIZE, tag_list: [] }),
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Minimax voice list error ${response.status}: ${err}`);
            }

            const data = await response.json();
            if (!data.success || !data.data?.voice_list) break;

            const voices = data.data.voice_list.map(v => ({
                id: v.voice_id,
                name: v.voice_name,
                tags: v.tag_list || [],
                gender: (v.tag_list || []).find(t => ['Female','Male'].includes(t))?.toLowerCase() || 'unknown',
                accent: (v.tag_list || []).find(t => ['English','Romanian','French','Spanish','German','Italian','Portuguese','Japanese','Korean','Chinese','Arabic'].includes(t)) || 'other',
                sampleAudio: v.sample_audio || null,
                coverUrl: v.cover_url || null,
                provider: 'minimax'
            }));

            allVoices = allVoices.concat(voices);
            hasMore = data.data.has_more;
            page++;

            console.log(`📋 Minimax voci page ${page-1}: +${voices.length} (total: ${allVoices.length})`);
        }

        res.json({ voices: allVoices, total: allVoices.length });
    } catch (error) {
        console.error('Eroare voci Minimax:', error.message);
        res.status(500).json({ error: 'Nu s-au putut încărca vocile Minimax.' });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Voice Studio rulează pe portul ${PORT}!`));