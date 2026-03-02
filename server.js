require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); 
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// 🚨 TREBUIE SĂ FIE ÎNAINTE DE app.use(express.json()) !!!
app.post('/api/webhook/stripe', express.raw({type: 'application/json'}), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        console.error(`❌ Eroare Stripe Webhook: ${err.message}`);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Daca plata a avut succes!
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_details.email;
        const amountPaid = session.amount_total; // 2990 inseamna 29.90 RON

        let creditsToAdd = 0;
        
        // Stabilim cate credite dam in functie de suma incasata
        if (amountPaid === 2990) creditsToAdd = 100;
        else if (amountPaid === 6990) creditsToAdd = 300;
        else if (amountPaid === 19990) creditsToAdd = 1000;

        if (creditsToAdd > 0 && customerEmail) {
            try {
                await User.findOneAndUpdate(
                    { email: customerEmail },
                    { $inc: { credits: creditsToAdd } }
                );
                console.log(`💰 [STRIPE SUCCES] Am adăugat ${creditsToAdd} credite pentru ${customerEmail}`);
            } catch (err) {
                console.error("Eroare la adaugarea creditelor:", err);
            }
        }
    }

    response.send();
});

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// SETĂRI PENTRU VPS COOLIFY
const YTDLP_PATH = '/usr/local/bin/yt-dlp';
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// BAZA DE DATE & SCHEME (USER + CACHE)
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectat la MongoDB!'))
    .catch(err => console.error('❌ Eroare MongoDB:', err));

const UserSchema = new mongoose.Schema({
    googleId: String,
    email: String,
    name: String,
    picture: String,
    credits: { type: Number, default: 10 }, // Mărit la 10 credite moca pentru ecosistem
    voice_characters: { type: Number, default: 3000 }, // Adăugat 3000 caractere moca pentru Voice AI
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const WaitlistSchema = new mongoose.Schema({
    email: String,
    name: String,
    date: { type: Date, default: Date.now }
});
const Waitlist = mongoose.model('Waitlist', WaitlistSchema);

// Schema pentru Cache (Se sterge singura dupa 24h)
const CacheSchema = new mongoose.Schema({
    videoId: String,
    originalText: String,
    translatedText: String,
    createdAt: { type: Date, expires: 86400, default: Date.now }
});
const VideoCache = mongoose.model('VideoCache', CacheSchema);

// ==========================================
// PROXY DATAIMPULSE & BYPASS
// ==========================================
const PROXY_URL = process.env.PROXY_URL; 
const proxyArg = PROXY_URL ? `--proxy "${PROXY_URL}"` : ""; 
const bypassArgs = '--no-warnings --geo-bypass';

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
    } catch (e) {
        return res.status(401).json({ error: "Sesiune expirată. Te rog loghează-te din nou." });
    }
};

// RUTE AUTH
app.post('/api/auth/google', async (req, res) => {
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        
        let user = await User.findOne({ googleId: payload.sub });
        
        if (userCount >= 12) {
                const dejaInLista = await Waitlist.findOne({ email: payload.email });
                if (!dejaInLista) {
                    await Waitlist.create({ email: payload.email, name: payload.name });
                    console.log(`🔥 LEAD NOU PE WAITLIST: ${payload.email}`);
                }
                return res.status(403).json({ error: 'BETA_FULL', message: 'Locurile sunt epuizate!' });
            }

            // ▼▼▼ AICI E MODIFICAREA MAGICA ▼▼▼
            user = new User({ 
                googleId: payload.sub, 
                email: payload.email, 
                name: payload.name, 
                picture: payload.picture, 
                credits: 10,               // Setam direct 10 credite
                voice_characters: 3000     // FORȚĂM BAZA DE DATE SĂ SALVEZE 3000 DE CARACTERE
            });
            await user.save();
            // ▲▲▲ PÂNĂ AICI ▲▲▲
        }
        
        const sessionToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token: sessionToken, user: { name: user.name, picture: user.picture, credits: user.credits, email: user.email } });
    } catch (error) { 
        console.error(error);
        res.status(400).json({ error: "Eroare Google" }); 
    }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
    const user = await User.findById(req.userId);
    res.json({ user: { name: user.name, picture: user.picture, credits: user.credits, email: user.email } });
});

// FUNCTIE: Descarcare Video (Combinatie video + audio pt calitati inalte, fortat MP4)
const downloadVideo = (url, outputPath, resolution = "1080") => {
    return new Promise((resolve, reject) => {
        // Asigura best video (maxim rezolutia dorita, preferabil mp4) + best audio (m4a)
        const formatArg = `-f "bestvideo[height<=${resolution}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${resolution}]+bestaudio/best" --merge-output-format mp4`;
        
        const command = `"${YTDLP_PATH}" ${proxyArg} ${bypassArgs} ${formatArg} -o "${outputPath}" --no-check-certificates --no-playlist "${url}"`;
        exec(command, { maxBuffer: 1024 * 1024 * 50, timeout: 300000 }, (error, stdout, stderr) => { 
            if (error) reject(new Error("Serverul YouTube a refuzat conexiunea video."));
            else resolve();
        });
    });
};

// FUNCTIE: Transcript & GPT
const getTranscriptAndTranslation = async (url) => {
    return new Promise((resolve) => {
        const command = `"${YTDLP_PATH}" ${proxyArg} ${bypassArgs} --write-auto-sub --skip-download --sub-lang en,ro --convert-subs vtt --output "${path.join(DOWNLOAD_DIR, 'temp_%(id)s')}" "${url}"`;
        
        exec(command, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 }, async (err) => {
            const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith('temp_') && f.endsWith('.vtt'));
            let originalText = "";
            
            if (files.length === 0) {
                return resolve({ original: "Nu s-a găsit subtitrare.", translated: "Nu există text de tradus." });
            }
            
            const vttPath = path.join(DOWNLOAD_DIR, files[0]);
            let content = fs.readFileSync(vttPath, 'utf8');
            
            content = content.replace(/WEBVTT/gi, '').replace(/Kind:[^\n]+/gi, '').replace(/Language:[^\n]+/gi, '')
                .replace(/align:[^\n]+/gi, '').replace(/position:[^\n]+/gi, '')
                .replace(/(\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*)/g, '')
                .replace(/<[^>]*>/g, '').replace(/\[Music\]/gi, '').replace(/\[Muzică\]/gi, '');

            originalText = [...new Set(content.split('\n').map(l => l.trim()).filter(l => l.length > 2))].join(' ');
            fs.unlinkSync(vttPath);

            try {
                const completion = await openai.chat.completions.create({
                    messages: [
                        { role: "system", content: "Ești un traducător profesionist. Tradu textul în limba română. Returnează DOAR traducerea textului, fără absolut nicio altă explicație." },
                        { role: "user", content: originalText.substring(0, 10000) }
                    ],
                    model: "gpt-4o-mini", 
                });
                resolve({ original: originalText, translated: completion.choices[0].message.content });
            } catch (e) {
                resolve({ original: originalText, translated: "Eroare AI la traducere: " + e.message });
            }
        });
    });
};

// ENDPOINT PRINCIPAL PROCESARE
app.post('/api/process-yt', authenticate, async (req, res) => {
    let { url, resolution } = req.body;
    if (!url) return res.status(400).json({ error: 'URL lipsă' });
    if (!resolution) resolution = "1080"; 

    const user = await User.findById(req.userId);

    if (url.includes('/shorts/')) url = url.replace('/shorts/', '/watch?v=').split('&')[0].split('?feature')[0];
    
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?]+)/);
    if (!videoIdMatch) return res.status(400).json({ error: "Link-ul de YouTube nu este valid." });
    const videoId = videoIdMatch[1];
    
    const outputPath = path.join(DOWNLOAD_DIR, `${videoId}.mp4`);

    try {
        // 1. VERIFICARE CACHE (ULTRA SPEED - GRATIS!)
        const cachedData = await VideoCache.findOne({ videoId });
        if (cachedData && fs.existsSync(outputPath)) {
            console.log(`⚡ CACHE HIT (Gratuit) pentru video: ${videoId}`);
            // Returnăm datele FĂRĂ SĂ TAXĂM CREDITE!
            return res.json({
                status: 'ok',
                downloadUrl: `/download/${videoId}.mp4`,
                originalText: cachedData.originalText,
                translatedText: cachedData.translatedText,
                creditsLeft: user.credits 
            });
        }

        // Daca NU e in cache, verificam daca are 2 credite pentru procesare noua
        if (user.credits < 2) return res.status(403).json({ error: "Nu mai ai credite! Cumpără un pachet." });

        console.log(`⏳ PROCESARE NOUA pentru video: ${videoId} la max ${resolution}p`);

        // 2. PROCESARE PARALELA
        const [aiData] = await Promise.all([
            getTranscriptAndTranslation(url),
            downloadVideo(url, outputPath, resolution)
        ]);

        // 3. SALVARE IN CACHE
        await VideoCache.create({
            videoId,
            originalText: aiData.original,
            translatedText: aiData.translated
        });

        // 4. TAXARE CREDIT (Doar la procesare nouă)
        user.credits -= 2;
        await user.save();

        res.json({
            status: 'ok',
            downloadUrl: `/download/${videoId}.mp4`,
            originalText: aiData.original,
            translatedText: aiData.translated,
            creditsLeft: user.credits 
        });

    } catch (e) {
        console.error("Eroare Procesare:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// ENDPOINT DESCARCARE
app.get('/download/:filename', (req, res) => {
    const file = path.join(DOWNLOAD_DIR, req.params.filename);
    if (fs.existsSync(file)) {
        res.download(file);
    } else {
        res.status(404).send('Fișierul nu mai există sau a expirat.');
    }
});

// CRON JOB: Curăță video-urile vechi la fiecare oră
setInterval(() => {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const now = Date.now();
    files.forEach(file => {
        if (file.endsWith('.mp4') || file.endsWith('.vtt')) {
            const filePath = path.join(DOWNLOAD_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
                fs.unlinkSync(filePath);
            }
        }
    });
}, 3600000); 

app.listen(PORT, () => console.log(`🚀 VIRALIO SaaS rulează Ultra-Fast.`));