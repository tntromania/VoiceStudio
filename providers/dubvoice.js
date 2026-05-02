// ==========================================
// PROVIDER 2: dubvoice.ai (SECUNDAR / FALLBACK)
// Suportă: Minimax + ElevenLabs
// ==========================================

const VOICE_API_KEY = process.env.VOICE_API_KEY;
const VOICE_API_BASE = process.env.VOICE_API_BASE || 'https://www.dubvoice.ai';

const NAME = 'dubvoice';
const TIMEOUT_REQUEST = 90000;   // dubvoice e mai lent uneori
const POLL_INTERVAL = 3000;
const POLL_MAX_WAIT = 300000;

// ------------------------------------------
// Polling task (pattern dubvoice — status 'completed', result = url direct)
// ------------------------------------------
async function pollTask(taskId, maxWait = POLL_MAX_WAIT) {
    const maxAttempts = Math.floor(maxWait / POLL_INTERVAL);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        let response;
        try {
            response = await fetch(`${VOICE_API_BASE}/api/v1/tts/${taskId}`, {
                headers: { 'Authorization': `Bearer ${VOICE_API_KEY}` },
                signal: AbortSignal.timeout(15000)
            });
        } catch (fetchErr) {
            console.warn(`⚠️ [${NAME}] Polling eroare attempt ${i+1}: ${fetchErr.message}`);
            continue;
        }

        if (response.status === 503 || response.status === 502 || response.status === 504) {
            console.warn(`⚠️ [${NAME}] Poll ${response.status}, attempt ${i+1}, reîncercăm...`);
            continue;
        }
        if (!response.ok) {
            throw new Error(`PROVIDER_ERROR:[${NAME}] poll status ${response.status}`);
        }

        const task = await response.json();

        if (task.status === 'completed') {
            const audioUrl = task.result;
            if (!audioUrl) throw new Error(`PROVIDER_ERROR:[${NAME}] generare ok dar lipsește URL audio`);
            return audioUrl;
        }

        if (task.status === 'failed' || task.status === 'error') {
            const errMsg = task.error || '';
            if (errMsg.includes('Terms of Service') || errMsg.includes('task-failed') ||
                errMsg.includes('blocked') || errMsg.includes('violate')) {
                throw new Error('BLOCKED:Textul conține conținut blocat de sistemul de moderare. Modifică textul și încearcă din nou.');
            }
            throw new Error(`PROVIDER_ERROR:[${NAME}] ${errMsg || 'eroare procesare'}`);
        }
    }

    throw new Error(`PROVIDER_ERROR:[${NAME}] timeout polling (${maxWait}ms)`);
}

// ------------------------------------------
// MINIMAX — sincron (returnează direct audio_url)
// ------------------------------------------
async function generateMinimax({ text, voiceId, speed, pitch, vol, language_boost }) {
    const minimaxVoiceId = voiceId || 'Wise_Woman';

    let response;
    try {
        response = await fetch(`${VOICE_API_BASE}/api/minimax-tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${VOICE_API_KEY}`
            },
            body: JSON.stringify({
                text,
                voice_id: minimaxVoiceId,
                model: 'speech-2.6-hd',
                language_boost: language_boost || 'Auto',
                speed: parseFloat(speed) || 1.0,
                pitch: parseFloat(pitch) || 0,
                vol: parseFloat(vol) || 1
            }),
            signal: AbortSignal.timeout(TIMEOUT_REQUEST)
        });
    } catch (fetchErr) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] Minimax fetch eșuat: ${fetchErr.message}`);
    }

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`PROVIDER_ERROR:[${NAME}] Minimax HTTP ${response.status}: ${errBody.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success || !data.audio_url) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] Minimax: răspuns invalid (lipsește audio_url)`);
    }

    console.log(`✅ [${NAME}/Minimax] Audio generat, chars: ${data.characters_used || '?'}`);
    return data.audio_url;
}

// ------------------------------------------
// ELEVENLABS — async cu polling
// ------------------------------------------
async function generateElevenLabs({ text, voiceId, stability, similarity_boost, speed }) {
    const resolvedVoiceId = voiceId;
    if (!resolvedVoiceId) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs: voice_id lipsă`);
    }

    let voiceResponse;
    try {
        voiceResponse = await fetch(`${VOICE_API_BASE}/api/v1/tts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${VOICE_API_KEY}`
            },
            body: JSON.stringify({
                text,
                voice_id: resolvedVoiceId,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: parseFloat(stability) || 0.5,
                    similarity_boost: parseFloat(similarity_boost) || 0.75,
                    speed: parseFloat(speed) || 1.0,
                    style: 0,
                    use_speaker_boost: true
                }
            }),
            signal: AbortSignal.timeout(TIMEOUT_REQUEST)
        });
    } catch (fetchErr) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs fetch eșuat: ${fetchErr.message}`);
    }

    if (!voiceResponse.ok) {
        const errBody = await voiceResponse.text().catch(() => '');
        if (voiceResponse.status === 429) {
            throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs rate limit (429)`);
        }
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs HTTP ${voiceResponse.status}: ${errBody.substring(0, 200)}`);
    }

    const data = await voiceResponse.json();
    if (!data.task_id) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs: răspuns invalid (lipsește task_id)`);
    }

    console.log(`✅ [${NAME}/ElevenLabs] Task creat: ${data.task_id}`);
    return await pollTask(data.task_id);
}

// ------------------------------------------
// Lista voci Minimax
// ------------------------------------------
async function listMinimaxVoices() {
    const response = await fetch(`${VOICE_API_BASE}/api/minimax-tts/voices`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${VOICE_API_KEY}`
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
        const err = await response.text().catch(() => '');
        throw new Error(`[${NAME}] voice list HTTP ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.voices) throw new Error(`[${NAME}] format răspuns invalid`);

    const allVoices = data.voices.map(v => ({
        id: v.voice_id,
        name: v.voice_name,
        tags: v.tag_list || [],
        gender: (v.tag_list || []).find(t => ['Female','Male'].includes(t))?.toLowerCase() || 'unknown',
        accent: (v.tag_list || []).find(t => ['English','Romanian','French','Spanish','German','Italian','Portuguese','Japanese','Korean','Chinese','Arabic'].includes(t)) || 'other',
        sampleAudio: v.demo_audio || null,
        description: v.description || null,
        provider: 'minimax'
    }));

    console.log(`📋 [${NAME}] Minimax: ${allVoices.length} voci încărcate`);
    return allVoices;
}

// ------------------------------------------
// Health check
// ------------------------------------------
async function healthCheck() {
    try {
        const response = await fetch(`${VOICE_API_BASE}/api/minimax-tts/voices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${VOICE_API_KEY}`
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

module.exports = {
    NAME,
    generateMinimax,
    generateElevenLabs,
    listMinimaxVoices,
    healthCheck
};
