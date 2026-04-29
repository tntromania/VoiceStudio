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

// ── Hub Auth (autentificare centralizată + subscription) ──
const { authenticate: hubAuthenticate, hubAPI } = require('./hub-auth');

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

// Middleware Autentificare — delegat către Hub (include subscriptionStatus în req.user)
const authenticate = hubAuthenticate;

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
// HELPER: Generare cu Minimax (fallback)
// ==========================================
async function generateWithMinimax(text, voiceId, speed) {
    // Dacă nu avem un voice_id Minimax explicit, folosim o voce default neutră
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
                vol: 1,
                pitch: 0,
                speed: parseFloat(speed) || 1.0
            },
            language_boost: 'Auto',
            with_transcript: false
        }),
        signal: AbortSignal.timeout(25000)
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
    return await pollTask(data.task_id, 75000);
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
// HELPER: Polling task până la finalizare
// ==========================================
async function pollTask(taskId, maxWait = 75000) {
    const interval = 3000;
    const maxAttempts = Math.floor(maxWait / interval);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, interval));

        let response;
        try {
            response = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
                headers: { 'xi-api-key': AI33_API_KEY },
                signal: AbortSignal.timeout(15000)
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

    throw new Error("Generarea a durat prea mult (75s). Încearcă din nou.");
}

// ==========================================
// QUEUE PER USER — un singur task activ/user
// ==========================================
const userQueues = {};  // { userId: Promise }

function queueForUser(userId, task) {
    // Înlănțuim task-ul după cel curent (dacă există), altfel îl rulăm direct
    const prev = userQueues[userId] || Promise.resolve();
    const next = prev.then(() => task()).finally(() => {
        // Curățăm intrarea dacă nu mai e nimic în coadă
        if (userQueues[userId] === next) delete userQueues[userId];
    });
    userQueues[userId] = next;
    return next;
}

// ==========================================
// RUTĂ GENERARE VOCE
// ==========================================
app.post('/api/generate', authenticate, (req, res) => {
    const userId = req.userId.toString();
    // Respingem imediat dacă userul are deja un task activ
    if (userQueues[userId]) {
        console.warn(`🚫 [Queue] ${userId} — task respins, unul deja activ`);
        return res.status(429).json({ error: 'Ai deja un task în curs. Așteaptă să se termine!' });
    }
    queueForUser(userId, async () => { try {
        const { text, voice, stability, similarity_boost, speed } = req.body;
        const user = await User.findById(req.userId);

        // ── Billing: abonament = gratis, fără abonament = scade caractere ──
        const subStatus = req.user?.subscriptionStatus;
        const hasActiveSub = subStatus === 'active' || subStatus === 'canceling';

        if (!text) return res.status(400).json({ error: "Textul lipsește." });

        const textWithoutSpaces = text.replace(/\s+/g, '');
        const cost = textWithoutSpaces.length;

        if (!hasActiveSub && user.voice_characters < cost) {
            return res.status(403).json({ error: `Caractere insuficiente. Ai nevoie de ${cost} caractere.` });
        }

        console.log(`📝 [${new Date().toLocaleTimeString('ro-RO')}] ${user.name} (${user.email}) | sub=${hasActiveSub?'✅':'❌'} | chars: ${text?.length || 0} | voce: ${voice}`);

        // ── Cale directă Minimax (userul a ales explicit o voce Minimax) ──────
        if (req.body.provider === 'minimax') {
            try {
                const mmUrl = await generateWithMinimax(text, req.body.minimaxVoiceId, speed);
                const mmFile = `voice_${Date.now()}.mp3`;
                await downloadAudio(mmUrl, path.join(DOWNLOAD_DIR, mmFile));
                if (!hasActiveSub) { user.voice_characters -= cost; await user.save(); }
                console.log(`🎙️ [Minimax Direct] ${mmFile} | sub=${hasActiveSub} | Chars rămase: ${user.voice_characters}`);
                return res.json({ audioUrl: `/downloads/${mmFile}`, remaining_chars: user.voice_characters, provider: 'minimax' });
            } catch(mmDirectErr) {
                console.error('❌ Minimax direct error:', mmDirectErr.message);
                return res.status(500).json({ error: mmDirectErr.message || 'Eroare Minimax. Încearcă din nou.' });
            }
        }

        // ── Default forțat pe Minimax dacă nu s-a specificat provider ──
        if (!req.body.provider) {
            try {
                const mmVoiceId = req.body.minimaxVoiceId || req.body.voiceId || null;
                const mmUrl = await generateWithMinimax(text, mmVoiceId, speed);
                const mmFile = `voice_${Date.now()}.mp3`;
                await downloadAudio(mmUrl, path.join(DOWNLOAD_DIR, mmFile));
                if (!hasActiveSub) { user.voice_characters -= cost; await user.save(); }
                console.log(`🎙️ [Minimax Default] ${mmFile} | sub=${hasActiveSub} | Chars rămase: ${user.voice_characters}`);
                return res.json({ audioUrl: `/downloads/${mmFile}`, remaining_chars: user.voice_characters, provider: 'minimax' });
            } catch(mmDefaultErr) {
                console.error('❌ Minimax default error:', mmDefaultErr.message);
                return res.status(500).json({ error: mmDefaultErr.message || 'Eroare Minimax. Încearcă din nou.' });
            }
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
                    signal: AbortSignal.timeout(25000)
                }
            );
        } catch (fetchErr) {
            if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError')
                return res.status(503).json({ error: "Serverul nu răspunde momentan. Încearcă din nou în câteva secunde." });
            throw fetchErr;
        }

        // ── Fallback Minimax dacă ElevenLabs e jos ───────────────
        const shouldFallback = !voiceResponse.ok &&
            [429, 502, 503].includes(voiceResponse.status);

        let outputUrl;
        let usedProvider = 'elevenlabs';

        if (shouldFallback) {
            const errBody = await voiceResponse.text();
            console.warn(`⚠️ ElevenLabs ${voiceResponse.status} — fallback la Minimax. Body: ${errBody}`);

            try {
                const minimaxVoiceId = req.body.minimaxVoiceId || null;
                outputUrl = await generateWithMinimax(text, minimaxVoiceId, speed);
                usedProvider = 'minimax';
                console.log(`✅ [Minimax fallback] Audio generat cu succes`);
            } catch (minimaxErr) {
                console.error('❌ Minimax fallback a eșuat:', minimaxErr.message);
                if (voiceResponse.status === 429) {
                    return res.status(429).json({ error: "Ambele servere vocale sunt suprasolicitate. Așteaptă 10-30 secunde și încearcă din nou!" });
                }
                return res.status(503).json({ error: "Serviciile vocale sunt temporar indisponibile. Revino în câteva minute!" });
            }
        } else if (!voiceResponse.ok) {
            const errBody = await voiceResponse.text();
            console.error("Eroare server vocal:", voiceResponse.status, errBody);
            if (voiceResponse.status === 401) {
                return res.status(500).json({ error: "Eroare internă de configurare. Contactează suportul." });
            }
            throw new Error(`Eroare internă la procesarea vocii (${voiceResponse.status})`);
        } else {
            const responseData = await voiceResponse.json();
            if (!responseData.success || !responseData.task_id) {
                throw new Error("Eroare internă la inițializarea generării.");
            }
            console.log(`✅ Task creat: ${responseData.task_id}`);
            try {
                outputUrl = await pollTask(responseData.task_id);
            } catch (pollErr) {
                // Timeout sau eroare polling ElevenLabs → marchează ca eroare în status
                providerLog['elevenlabs'].push(false);
                if (providerLog['elevenlabs'].length > 10) providerLog['elevenlabs'].shift();
                console.error(`❌ [ElevenLabs] Timeout/eroare polling (${pollErr.message}) → status: ${getProviderStatus('elevenlabs')} — fallback automat la Minimax`);
                try {
                    const minimaxVoiceId = req.body.minimaxVoiceId || null;
                    outputUrl = await generateWithMinimax(text, minimaxVoiceId, speed, req.body.pitch, req.body.vol, req.body.language_boost);
                    usedProvider = 'minimax';
                    console.log(`✅ [Minimax fallback după timeout EL] Audio generat cu succes`);
                } catch (mmFallbackErr) {
                    console.error(`❌ [Minimax fallback] A eșuat și el:`, mmFallbackErr.message);
                    return res.status(503).json({ error: "Ambele servere vocale au timeout. Încearcă din nou în câteva secunde." });
                }
            }
        }

        const fileName = `voice_${Date.now()}.mp3`;
        const filePath = path.join(DOWNLOAD_DIR, fileName);
        await downloadAudio(outputUrl, filePath);

        if (!hasActiveSub) { user.voice_characters -= cost; await user.save(); }

        console.log(`🎤 [${usedProvider.toUpperCase()}] Audio salvat: ${fileName} | sub=${hasActiveSub} | Chars rămase: ${user.voice_characters}`);
        res.json({ audioUrl: `/downloads/${fileName}`, remaining_chars: user.voice_characters, provider: usedProvider });

    } catch (error) {
        console.error("ERROR VOICE GEN:", error.message || error);

        if (error.message && error.message.includes('429')) {
            return res.status(429).json({ error: "Serverul este suprasolicitat momentan. Așteaptă 5-10 secunde și încearcă din nou!" });
        }

        res.status(500).json({ error: error.message || "Eroare tehnică la generarea vocii. Încearcă din nou." });
    } }); // end queueForUser
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
        const TARGET = 210; // Vrem cel puțin 200 voci
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
                signal: AbortSignal.timeout(15000)
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


// ══════════════════════════════════════════════════════════════
// STATUS PROVIDER — partajat între toți userii
// ══════════════════════════════════════════════════════════════
const providerLog = {
    elevenlabs: [], // true=ok, false=err
    minimax: []
};

function getProviderStatus(p) {
    const log = providerLog[p];
    if (!log.length) return 'ok';

    // Numără erorile CONSECUTIVE de la finalul log-ului
    let consecErrors = 0;
    for (let i = log.length - 1; i >= 0; i--) {
        if (!log[i]) consecErrors++;
        else break; // s-a oprit la primul succes
    }

    if (consecErrors >= 5) return 'down';       // 5+ erori consecutive → roșu
    if (consecErrors >= 2) return 'unstable';   // 2-4 erori consecutive → galben
    return 'ok';                                // 0-1 erori → verde
}

// GET /api/provider-status — returnează statusul curent
app.get('/api/provider-status', (req, res) => {
    res.json({
        elevenlabs: getProviderStatus('elevenlabs'),
        minimax: getProviderStatus('minimax'),
        updatedAt: new Date().toISOString()
    });
});

// POST /api/provider-status/report — raportat de client după generare
app.post('/api/provider-status/report', (req, res) => {
    const { provider, success } = req.body;
    if (!['elevenlabs','minimax'].includes(provider)) return res.status(400).json({ error: 'Provider invalid' });
    const log = providerLog[provider];
    log.push(!!success);
    if (log.length > 10) log.shift();
    console.log(`[STATUS] ${provider}: ${success ? 'OK' : 'ERR'} → ${getProviderStatus(provider)}`);
    res.json({ status: getProviderStatus(provider) });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Voice Studio rulează pe portul ${PORT}!`));