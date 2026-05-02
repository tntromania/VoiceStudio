// ==========================================
// PROVIDER 1: ai33.pro (PRIMAR)
// Suportă: Minimax + ElevenLabs
// ==========================================
const fs = require('fs');
const path = require('path');
const https = require('https');

const AI33_API_KEY = process.env.AI33_API_KEY;
const AI33_BASE_URL = 'https://api.ai33.pro';

const NAME = 'ai33';
const TIMEOUT_REQUEST = 12000;       // 12s pentru request-urile inițiale
const POLL_INTERVAL = 3000;
const POLL_MAX_WAIT = 100000;        // 100s — dacă task-ul e încă pending/processing → switch la secundar
const POLL_MAX_GATEWAY_ERRORS = 3;   // max 3 erori 502/503/504 CONSECUTIVE → switch la secundar
const POLL_LOG_EVERY = 5;            // loghează progresul la fiecare N attempts ca să vezi că e activ

// ------------------------------------------
// Polling task — funcționează pentru ambele (Minimax + ElevenLabs pe ai33)
// ------------------------------------------
async function pollTask(taskId, maxWait = POLL_MAX_WAIT) {
    const maxAttempts = Math.floor(maxWait / POLL_INTERVAL);
    let consecutiveGatewayErrors = 0;
    let consecutiveNetworkErrors = 0;
    let lastStatus = null;

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        let response;
        try {
            response = await fetch(`${AI33_BASE_URL}/v1/task/${taskId}`, {
                headers: { 'xi-api-key': AI33_API_KEY },
                signal: AbortSignal.timeout(15000)
            });
            consecutiveNetworkErrors = 0;
        } catch (fetchErr) {
            consecutiveNetworkErrors++;
            console.warn(`⚠️ [${NAME}] Polling network err ${i+1} (consec: ${consecutiveNetworkErrors}): ${fetchErr.message}`);
            if (consecutiveNetworkErrors >= 3) {
                throw new Error(`PROVIDER_ERROR:[${NAME}] polling network: ${consecutiveNetworkErrors} erori consecutive`);
            }
            continue;
        }

        // Erori gateway (provider-ul returnează 502/503/504)
        if (response.status === 503 || response.status === 502 || response.status === 504) {
            consecutiveGatewayErrors++;
            console.warn(`⚠️ [${NAME}] Poll ${response.status} attempt ${i+1} (consec: ${consecutiveGatewayErrors}/${POLL_MAX_GATEWAY_ERRORS})`);
            if (consecutiveGatewayErrors >= POLL_MAX_GATEWAY_ERRORS) {
                throw new Error(`PROVIDER_ERROR:[${NAME}] gateway down: ${consecutiveGatewayErrors} erori ${response.status} consecutive`);
            }
            continue;
        }
        consecutiveGatewayErrors = 0;

        if (!response.ok) {
            throw new Error(`PROVIDER_ERROR:[${NAME}] poll status ${response.status}`);
        }

        const task = await response.json();

        if (task.status === 'done') {
            const audioUrl = task.metadata?.audio_url || task.output_uri || task.metadata?.output_uri;
            if (!audioUrl) throw new Error(`PROVIDER_ERROR:[${NAME}] generare ok dar lipsește URL audio`);
            const elapsed = ((i + 1) * POLL_INTERVAL / 1000).toFixed(1);
            console.log(`✅ [${NAME}] Task ${taskId.substring(0,8)}... DONE după ${elapsed}s`);
            return audioUrl;
        }

        if (task.status === 'error' || task.status === 'failed') {
            const errMsg = task.error_message || task.error || '';
            if (errMsg.includes('Terms of Service') || errMsg.includes('task-failed') ||
                errMsg.includes('blocked') || errMsg.includes('violate')) {
                throw new Error('BLOCKED:Textul conține conținut blocat de sistemul de moderare. Modifică textul și încearcă din nou.');
            }
            throw new Error(`PROVIDER_ERROR:[${NAME}] ${errMsg || 'eroare procesare'}`);
        }

        // Task încă în lucru (pending / processing / queued / etc.)
        // Loghează periodic ca să vedem că polling-ul e activ și pe ce status stă
        lastStatus = task.status || 'unknown';
        if ((i + 1) % POLL_LOG_EVERY === 0) {
            const elapsed = ((i + 1) * POLL_INTERVAL / 1000).toFixed(0);
            console.log(`⏳ [${NAME}] Task ${taskId.substring(0,8)}... status='${lastStatus}' după ${elapsed}s/${(maxWait/1000).toFixed(0)}s`);
        }
    }

    // Max wait depășit — task încă pending → switch la secundar
    throw new Error(`PROVIDER_ERROR:[${NAME}] task stuck în status='${lastStatus}' după ${(maxWait/1000).toFixed(0)}s — switch la secundar`);
}

// ------------------------------------------
// MINIMAX — generare
// ------------------------------------------
async function generateMinimax({ text, voiceId, speed, pitch, vol, language_boost }) {
    const minimaxVoiceId = voiceId || '226893671006276'; // Graceful Lady fallback

    let response;
    try {
        response = await fetch(`${AI33_BASE_URL}/v1m/task/text-to-speech`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': AI33_API_KEY
            },
            body: JSON.stringify({
                text,
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
    if (!data.success || !data.task_id) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] Minimax: răspuns invalid la inițializare`);
    }

    console.log(`✅ [${NAME}/Minimax] Task creat: ${data.task_id}`);
    return await pollTask(data.task_id);
}

// ------------------------------------------
// ELEVENLABS — generare
// Endpoint oficial ai33: POST /v1/text-to-speech/{voice_id}?output_format=...
// Notă: setările stability/similarity_boost/speed NU sunt suportate la
// acest endpoint pe ai33.pro (doar pe API-ul original ElevenLabs direct).
// Le acceptăm ca parametri pentru compatibilitate cu UI-ul, dar nu le trimitem.
// ------------------------------------------
async function generateElevenLabs({ text, voiceId, stability, similarity_boost, speed }) {
    const resolvedVoiceId = voiceId;
    if (!resolvedVoiceId) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs: voice_id lipsă`);
    }

    const url = `${AI33_BASE_URL}/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}?output_format=mp3_44100_128`;

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': AI33_API_KEY
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                with_transcript: false
            }),
            signal: AbortSignal.timeout(TIMEOUT_REQUEST)
        });
    } catch (fetchErr) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs fetch eșuat: ${fetchErr.message}`);
    }

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        if (response.status === 429) {
            throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs rate limit (429)`);
        }
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs HTTP ${response.status}: ${errBody.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success || !data.task_id) {
        throw new Error(`PROVIDER_ERROR:[${NAME}] ElevenLabs: răspuns invalid la inițializare`);
    }

    console.log(`✅ [${NAME}/ElevenLabs] Task creat: ${data.task_id} (credits: ${data.ec_remain_credits ?? '?'})`);
    return await pollTask(data.task_id);
}

// ------------------------------------------
// Lista voci Minimax (paginat)
// ------------------------------------------
async function listMinimaxVoices() {
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
            const err = await response.text().catch(() => '');
            throw new Error(`[${NAME}] voice list HTTP ${response.status}: ${err.substring(0, 200)}`);
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

        console.log(`📋 [${NAME}] Minimax page ${page-1}: +${voices.length} (total: ${allVoices.length})`);
    }

    return allVoices;
}

// ------------------------------------------
// Health check rapid (pentru circuit breaker — opțional, nu obligatoriu)
// ------------------------------------------
async function healthCheck() {
    try {
        const response = await fetch(`${AI33_BASE_URL}/v1m/voice/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': AI33_API_KEY
            },
            body: JSON.stringify({ page: 1, page_size: 1, tag_list: [] }),
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