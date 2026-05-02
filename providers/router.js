// ==========================================
// PROVIDER ROUTER — Fallback automat + Circuit Breaker
//
// Strategie:
//   PRIMAR    = ai33.pro
//   SECUNDAR  = dubvoice.ai
//
// - 60s timeout / request + 2 retry-uri pe primar
// - dacă primarul eșuează după toate retry-urile → switch automat la secundar
// - Circuit breaker: când primarul cade, e marcat "DOWN" pentru 15 min
//   și toate request-urile merg direct pe secundar (fără să mai chinuim primarul)
// - După 15 min, primul request încearcă din nou primarul (half-open)
// - BLOCKED (moderare) NU declanșează fallback — e eroare reală
// ==========================================

const ai33 = require('./ai33');
const dubvoice = require('./dubvoice');

const PRIMARY = ai33;
const SECONDARY = dubvoice;

// ---- Configurare ----
const MAX_RETRIES_PRIMARY = 1;            // 1 retry = 2 încercări totale pe primar (foarte rapid switch)
const RETRY_DELAY_MS = 1000;              // pauză scurtă între retry-uri
const CIRCUIT_BREAKER_DURATION_MS = 15 * 60 * 1000;  // 15 min

// ---- State circuit breaker (in-memory, se resetează la restart server) ----
const circuitState = {
    primaryDownUntil: 0,        // timestamp până când primarul rămâne marcat down
    primaryFailureCount: 0,     // câte fail-uri consecutive
    secondaryDownUntil: 0,      // dacă și secundarul cade, marcăm și pe el
    lastPrimarySuccess: Date.now()
};

function isPrimaryDown() {
    return Date.now() < circuitState.primaryDownUntil;
}
function isSecondaryDown() {
    return Date.now() < circuitState.secondaryDownUntil;
}
function markPrimaryDown(reason) {
    circuitState.primaryDownUntil = Date.now() + CIRCUIT_BREAKER_DURATION_MS;
    circuitState.primaryFailureCount++;
    console.warn(`🔴 [CIRCUIT] PRIMAR (${PRIMARY.NAME}) marcat DOWN pentru 15 min. Motiv: ${reason}`);
}
function markPrimaryUp() {
    if (circuitState.primaryDownUntil > 0) {
        console.log(`🟢 [CIRCUIT] PRIMAR (${PRIMARY.NAME}) revenit UP după ${circuitState.primaryFailureCount} eșecuri.`);
    }
    circuitState.primaryDownUntil = 0;
    circuitState.primaryFailureCount = 0;
    circuitState.lastPrimarySuccess = Date.now();
}
function markSecondaryDown(reason) {
    circuitState.secondaryDownUntil = Date.now() + CIRCUIT_BREAKER_DURATION_MS;
    console.warn(`🔴 [CIRCUIT] SECUNDAR (${SECONDARY.NAME}) marcat DOWN pentru 15 min. Motiv: ${reason}`);
}
function markSecondaryUp() {
    if (circuitState.secondaryDownUntil > 0) {
        console.log(`🟢 [CIRCUIT] SECUNDAR (${SECONDARY.NAME}) revenit UP.`);
    }
    circuitState.secondaryDownUntil = 0;
}

function getStatus() {
    const now = Date.now();
    return {
        primary: {
            name: PRIMARY.NAME,
            status: isPrimaryDown() ? 'down' : 'up',
            downForMinutes: isPrimaryDown() ? Math.ceil((circuitState.primaryDownUntil - now) / 60000) : 0,
            failureCount: circuitState.primaryFailureCount
        },
        secondary: {
            name: SECONDARY.NAME,
            status: isSecondaryDown() ? 'down' : 'up',
            downForMinutes: isSecondaryDown() ? Math.ceil((circuitState.secondaryDownUntil - now) / 60000) : 0
        }
    };
}

// ------------------------------------------
// Helper: Determină dacă o eroare e "switchable" (declanșează fallback)
// BLOCKED (moderare) → NU face fallback, e eroare reală
// ------------------------------------------
function isFallbackEligible(errorMessage) {
    if (!errorMessage) return false;
    if (errorMessage.startsWith('BLOCKED:')) return false;
    // Tot ce începe cu PROVIDER_ERROR sau timeout/network/HTTP errors → fallback
    return errorMessage.startsWith('PROVIDER_ERROR:') ||
           errorMessage.toLowerCase().includes('timeout') ||
           errorMessage.toLowerCase().includes('network') ||
           errorMessage.toLowerCase().includes('econnrefused') ||
           errorMessage.toLowerCase().includes('fetch') ||
           errorMessage.toLowerCase().includes('aborted');
}

// ------------------------------------------
// Curăță prefix PROVIDER_ERROR pentru afișare la client
// ------------------------------------------
function cleanError(err) {
    if (!err || !err.message) return 'Eroare necunoscută';
    if (err.message.startsWith('BLOCKED:')) return err.message;
    if (err.message.startsWith('PROVIDER_ERROR:')) {
        return 'Serverul vocal este suprasolicitat sau temporar indisponibil. Încearcă din nou în câteva secunde.';
    }
    return err.message;
}

// ------------------------------------------
// Try with retries pe un provider
// ------------------------------------------
async function tryWithRetries(provider, methodName, args, retries) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await provider[methodName](args);
            return result;
        } catch (err) {
            lastError = err;

            // BLOCKED nu se reîncearcă — e moderare
            if (err.message?.startsWith('BLOCKED:')) {
                throw err;
            }

            // Dacă mai avem retry-uri, așteaptă și reîncearcă
            if (attempt < retries) {
                console.warn(`⚠️ [${provider.NAME}] încercarea ${attempt + 1}/${retries + 1} eșuată: ${err.message}. Reîncerc...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
        }
    }
    throw lastError;
}

// ==========================================
// API PUBLIC — generate (fallback automat)
// ==========================================
async function generate(engineType, params) {
    // engineType: 'minimax' | 'elevenlabs'
    const methodName = engineType === 'minimax' ? 'generateMinimax' : 'generateElevenLabs';

    // ---- Pasul 1: Decide care provider e primar pentru acest request ----
    const primaryAvailable = !isPrimaryDown();
    const secondaryAvailable = !isSecondaryDown();

    // ---- Cazul 1: Primarul e UP — încearcă acolo cu retry, fallback la secundar ----
    if (primaryAvailable) {
        try {
            console.log(`🎯 [ROUTER] → PRIMAR (${PRIMARY.NAME}/${engineType})`);
            const url = await tryWithRetries(PRIMARY, methodName, params, MAX_RETRIES_PRIMARY);
            markPrimaryUp(); // succes — resetează contorul
            return { audioUrl: url, providerUsed: PRIMARY.NAME };
        } catch (err) {
            // BLOCKED → propagă imediat, nu fallback
            if (err.message?.startsWith('BLOCKED:')) {
                throw err;
            }

            // Eroare eligibilă pentru fallback?
            if (isFallbackEligible(err.message)) {
                markPrimaryDown(err.message.substring(0, 120));
                console.warn(`🟡 [ROUTER] PRIMAR eșuat → SWITCH la SECUNDAR (${SECONDARY.NAME})`);

                if (!secondaryAvailable) {
                    throw new Error('PROVIDER_ERROR:Ambii provideri sunt indisponibili momentan. Încearcă din nou peste câteva minute.');
                }

                try {
                    const url = await tryWithRetries(SECONDARY, methodName, params, 1);
                    markSecondaryUp();
                    console.log(`✅ [ROUTER] SECUNDAR OK (${SECONDARY.NAME})`);
                    return { audioUrl: url, providerUsed: SECONDARY.NAME };
                } catch (err2) {
                    if (err2.message?.startsWith('BLOCKED:')) throw err2;
                    if (isFallbackEligible(err2.message)) {
                        markSecondaryDown(err2.message.substring(0, 120));
                    }
                    throw err2;
                }
            }
            // Eroare neașteptată — propagă
            throw err;
        }
    }

    // ---- Cazul 2: Primarul e DOWN (circuit deschis) — direct la secundar ----
    console.log(`🟡 [ROUTER] PRIMAR DOWN (circuit) → direct SECUNDAR (${SECONDARY.NAME}/${engineType})`);

    if (!secondaryAvailable) {
        throw new Error('PROVIDER_ERROR:Ambii provideri sunt indisponibili momentan. Încearcă din nou peste câteva minute.');
    }

    try {
        const url = await tryWithRetries(SECONDARY, methodName, params, 1);
        markSecondaryUp();
        return { audioUrl: url, providerUsed: SECONDARY.NAME };
    } catch (err) {
        if (err.message?.startsWith('BLOCKED:')) throw err;
        if (isFallbackEligible(err.message)) {
            markSecondaryDown(err.message.substring(0, 120));
            // Ultimă șansă: dacă a trecut destul timp pe primar, reîncercăm o dată
            if (Date.now() - circuitState.lastPrimarySuccess > 60000) {
                console.warn(`🔄 [ROUTER] Și SECUNDAR a căzut — last resort: încerc PRIMAR (half-open)`);
                try {
                    const url = await tryWithRetries(PRIMARY, methodName, params, 0);
                    markPrimaryUp();
                    return { audioUrl: url, providerUsed: PRIMARY.NAME };
                } catch {
                    // Ignorăm — propagăm eroarea originală
                }
            }
        }
        throw err;
    }
}

// ==========================================
// API PUBLIC — listVoices (Minimax)
// Tot cu fallback, dar mai simplu (fără circuit breaker)
// ==========================================
async function listMinimaxVoices() {
    if (!isPrimaryDown()) {
        try {
            return { voices: await PRIMARY.listMinimaxVoices(), providerUsed: PRIMARY.NAME };
        } catch (err) {
            console.warn(`⚠️ [ROUTER/voices] PRIMAR eșuat: ${err.message} → încerc SECUNDAR`);
        }
    }
    if (!isSecondaryDown()) {
        try {
            return { voices: await SECONDARY.listMinimaxVoices(), providerUsed: SECONDARY.NAME };
        } catch (err) {
            console.warn(`⚠️ [ROUTER/voices] SECUNDAR eșuat: ${err.message}`);
            throw err;
        }
    }
    throw new Error('Niciun provider disponibil pentru lista vocilor.');
}

module.exports = {
    generate,
    listMinimaxVoices,
    getStatus,
    cleanError,
    // expose pentru testing/debug
    _markPrimaryDown: markPrimaryDown,
    _markPrimaryUp: markPrimaryUp
};