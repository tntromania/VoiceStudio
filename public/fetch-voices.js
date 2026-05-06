#!/usr/bin/env node
// ============================================================
//  fetch-voices.js
//  Descarcă TOATE vocile ElevenLabs + Minimax via DubVoice API
//  și generează voices.js + minimax-voices.js actualizate
//
//  Rulare: VOICE_API_KEY=sk_xxx node fetch-voices.js
// ============================================================

require('dotenv').config();

const API_KEY  = process.env.VOICE_API_KEY;
const BASE_URL = process.env.VOICE_API_BASE || 'https://www.dubvoice.ai';
const fs       = require('fs');
const path     = require('path');

if (!API_KEY) {
  console.error('❌  Lipsește VOICE_API_KEY în .env sau ca variabilă de mediu.');
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`
};

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (res.status === 429) {
    const retryIn = parseInt(res.headers.get('x-ratelimit-reset') || '3', 10);
    console.warn(`  ⚠️  Rate limit — aștept ${retryIn}s...`);
    await sleep(retryIn * 1000 + 500);
    return apiFetch(url, options);          // retry
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} la ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Normalizare accent ────────────────────────────────────────

const ACCENT_KEYWORDS = {
  american: ['american','us ','en-us','united states'],
  british:  ['british','uk','en-gb','england'],
  australian:['australian','en-au'],
  french:   ['french','fr-'],
  spanish:  ['spanish','es-'],
  portuguese:['portuguese','pt-','brazil'],
  indian:   ['indian','hi-'],
  korean:   ['korean','ko-'],
  japanese: ['japanese','ja-'],
  german:   ['german','de-'],
  italian:  ['italian','it-'],
  arabic:   ['arabic','ar-'],
  chinese:  ['chinese','mandarin','zh-'],
  irish:    ['irish','en-ie'],
};

function guessAccent(tags = [], name = '', style = '') {
  const haystack = [...tags, name, style].join(' ').toLowerCase();
  for (const [accent, kws] of Object.entries(ACCENT_KEYWORDS))
    if (kws.some(k => haystack.includes(k))) return accent;
  return 'other';
}

function guessGender(tags = []) {
  const t = tags.map(s => s.toLowerCase());
  if (t.includes('female')) return 'female';
  if (t.includes('male'))   return 'male';
  return 'special';
}

function guessUse(tags = [], style = '') {
  const h = [...tags, style].join(' ').toLowerCase();
  if (h.includes('narrat') || h.includes('audiobook'))       return 'narration';
  if (h.includes('social') || h.includes('tiktok'))          return 'social';
  if (h.includes('gaming') || h.includes('game'))            return 'gaming';
  if (h.includes('news') || h.includes('anchor'))            return 'news';
  if (h.includes('podcast'))                                  return 'podcast';
  if (h.includes('professional') || h.includes('corporate')) return 'professional';
  if (h.includes('entertainment') || h.includes('character'))return 'entertainment';
  if (h.includes('wellnes') || h.includes('meditation'))     return 'wellness';
  if (h.includes('convers'))                                  return 'conversational';
  return 'general';
}

// ── 1. ElevenLabs — paginate prin toate vocile ────────────────

async function fetchAllElevenLabsVoices() {
  console.log('\n📥  Descărcare voci ElevenLabs...');
  const voices = [];
  let page = 1;
  const PAGE_SIZE = 100;           // maximul permis de API

  while (true) {
    const url = `${BASE_URL}/api/v1/voices?provider=elevenlabs&page=${page}&page_size=${PAGE_SIZE}`;
    console.log(`  Pagina ${page}...`);
    let data;
    try {
      data = await apiFetch(url, { headers: HEADERS });
    } catch (e) {
      console.error(`  ❌ Eroare la pagina ${page}:`, e.message);
      break;
    }

    const batch = data.voices || data.data || [];
    if (!batch.length) break;

    for (const v of batch) {
      const tags    = v.tag_list || v.labels ? Object.values(v.labels || {}) : [];
      const accent  = guessAccent(tags, v.name || '', v.description || '');
      const gender  = v.gender || guessGender(tags);
      const use     = guessUse(tags, v.description || '');

      voices.push({
        id:          v.voice_id || v.id,
        name:        v.name,
        style:       v.description || v.labels?.accent
                       ? `${accent} · ${v.labels?.age || 'adult'} · ${v.description || ''}`.trim()
                       : `${accent} · voice`,
        gender:      gender.toLowerCase(),
        tags:        [gender.toLowerCase(), ...(tags.map(t => t.toLowerCase()).filter(Boolean))],
        accent,
        use,
        // ElevenLabs sample audio — preview URL direct de la API (dacă există)
        sampleAudio: v.preview_url || v.sample_url || null,
      });
    }

    console.log(`  ✅ ${batch.length} voci (total pâna acum: ${voices.length})`);

    // Verifică dacă mai sunt pagini
    const total   = data.total || data.total_count || null;
    const hasMore = data.has_more ?? (total ? voices.length < total : batch.length === PAGE_SIZE);
    if (!hasMore) break;

    page++;
    await sleep(400);   // evită rate-limit
  }

  console.log(`  🎤 Total ElevenLabs: ${voices.length} voci`);
  return voices;
}

// ── 2. Minimax — fetch pe grupuri de limbi ────────────────────

const MINIMAX_TAG_GROUPS = [
  [],                           // fără filtru → primele 100
  ['English'],
  ['Turkish'],
  ['Spanish'],
  ['Portuguese'],
  ['French'],
  ['German'],
  ['Italian'],
  ['Korean'],
  ['Japanese'],
  ['Chinese'],
  ['Arabic'],
  ['Russian'],
  ['Dutch'],
  ['Polish'],
  ['Czech'],
  ['Romanian'],
  ['Hindi'],
  ['Vietnamese'],
  ['Swedish'],
  ['Danish'],
  ['Norwegian'],
  ['Finnish'],
  ['Hebrew'],
  ['Thai'],
  ['Greek'],
  ['Hungarian'],
  ['Indonesian'],
  ['Malay'],
  ['Filipino'],
  ['Male'],
  ['Female'],
  ['Clone'],
  ['Young'],
  ['Mature'],
];

async function fetchAllMinimaxVoices() {
  console.log('\n📥  Descărcare voci Minimax...');
  const seen = new Set();
  const voices = [];

  for (const tagList of MINIMAX_TAG_GROUPS) {
    const label = tagList.length ? tagList.join('+') : '(toate)';
    console.log(`  Tag-uri: [${label}]`);

    let data;
    try {
      data = await apiFetch(`${BASE_URL}/api/minimax-tts/voices`, {
        method:  'POST',
        headers: HEADERS,
        body:    JSON.stringify(tagList.length ? { tag_list: tagList } : {}),
      });
    } catch (e) {
      console.error(`  ❌ Eroare pentru [${label}]:`, e.message);
      await sleep(1000);
      continue;
    }

    const batch = data.voices || [];
    let added = 0;

    for (const v of batch) {
      const vid = String(v.voice_id || v.id);
      if (seen.has(vid)) continue;
      seen.add(vid);
      added++;

      const tags   = v.tag_list || [];
      const accent = guessAccent(tags, v.voice_name || v.name || '');
      const gender = guessGender(tags);
      const use    = guessUse(tags, v.description || '');

      voices.push({
        id:          vid,
        name:        v.voice_name || v.name,
        style:       [
                       tags.find(t => !['Male','Female','Clone','Young','Adult','Mature'].includes(t)) || accent,
                       tags.find(t => ['Young','Adult','Mature'].includes(t))?.toLowerCase() || 'adult',
                       v.description || 'standard'
                     ].filter(Boolean).join(' · '),
        gender:      gender,
        tags:        tags.map(t => t.toLowerCase()).filter(Boolean),
        accent,
        use,
        sampleAudio: v.demo_audio || v.sample_url || null,
      });
    }

    console.log(`  ✅ +${added} noi (total: ${voices.length})`);
    await sleep(300);
  }

  console.log(`  🎤 Total Minimax: ${voices.length} voci unice`);
  return voices;
}

// ── 3. Generare fișiere JS ────────────────────────────────────

function voiceToJS(v) {
  const escape = s => (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const sampleLine = v.sampleAudio ? `, sampleAudio:"${v.sampleAudio}"` : '';
  return `  {id:"${v.id}", name:"${escape(v.name)}", style:"${escape(v.style)}", gender:"${v.gender}", tags:${JSON.stringify(v.tags)}, accent:"${v.accent}", use:"${v.use}"${sampleLine}}`;
}

function buildElevenLabsFile(voices) {
  const lines = voices.map(voiceToJS).join(',\n');
  return `// ============================================================
//  VIRALIO VOICE STUDIO — voices.js
//  Toate vocile ElevenLabs disponibile prin DubVoice
//  Generat: ${new Date().toLocaleString('ro-RO')} · Total: ${voices.length} voci
// ============================================================

const ALL_VOICES = [
${lines}
];

// ─── Color palette per accent ────────────────────────────────
const ACCENT_COLORS = {
  american:   '#6366f1',
  british:    '#0ea5e9',
  australian: '#10b981',
  french:     '#f59e0b',
  spanish:    '#ef4444',
  portuguese: '#8b5cf6',
  indian:     '#f97316',
  korean:     '#ec4899',
  japanese:   '#14b8a6',
  german:     '#64748b',
  italian:    '#84cc16',
  arabic:     '#a78bfa',
  chinese:    '#fb923c',
  irish:      '#22c55e',
  other:      '#94a3b8',
};

function vColor(v){
  return ACCENT_COLORS[v.accent] || ACCENT_COLORS.other;
}

const USE_LABELS = {
  conversational: '💬 Conversațional',
  narration:      '📖 Narațiune',
  social:         '📱 Social Media',
  entertainment:  '🎭 Entertainment',
  characters:     '🎮 Personaje',
  news:           '📺 Știri',
  professional:   '💼 Profesional',
  gaming:         '🎮 Gaming',
  podcast:        '🎙 Podcast',
  wellness:       '🧘 Wellness',
  general:        '⚡ General',
};
`;
}

function buildMinimaxFile(voices) {
  const lines = voices.map(voiceToJS).join(',\n');
  return `// ============================================================
//  VIRALIO VOICE STUDIO — minimax-voices.js
//  Toate vocile Minimax disponibile prin DubVoice
//  Generat: ${new Date().toLocaleString('ro-RO')} · Total: ${voices.length} voci
// ============================================================

const ALL_MINIMAX_VOICES = [
${lines}
];

// ── Culori per accent ────────────────────────────────────────
const MINIMAX_ACCENT_COLORS = {
  american:   '#6366f1',
  british:    '#0ea5e9',
  english:    '#6366f1',
  romanian:   '#ec4899',
  french:     '#f59e0b',
  spanish:    '#ef4444',
  portuguese: '#8b5cf6',
  german:     '#64748b',
  italian:    '#84cc16',
  arabic:     '#a78bfa',
  japanese:   '#14b8a6',
  korean:     '#fb923c',
  chinese:    '#f97316',
  indian:     '#f97316',
  other:      '#94a3b8',
};

function mmColor(v) {
  return MINIMAX_ACCENT_COLORS[v.accent] || MINIMAX_ACCENT_COLORS.other;
}

const MINIMAX_USE_LABELS = {
  conversational: '💬 Conversațional',
  narration:      '📖 Narațiune',
  social:         '📱 Social Media',
  entertainment:  '🎭 Entertainment',
  gaming:         '🎮 Gaming',
  podcast:        '🎙 Podcast',
  professional:   '💼 Profesional',
  general:        '⚡ General',
};
`;
}

// ── 4. Main ───────────────────────────────────────────────────

(async () => {
  console.log('🚀 Fetch Voices — DubVoice API');
  console.log('================================');

  const [elVoices, mmVoices] = await Promise.allSettled([
    fetchAllElevenLabsVoices(),
    fetchAllMinimaxVoices(),
  ]);

  // ElevenLabs
  if (elVoices.status === 'fulfilled') {
    const content = buildElevenLabsFile(elVoices.value);
    fs.writeFileSync(path.join(__dirname, 'voices.js'), content, 'utf8');
    console.log(`\n✅  voices.js salvat (${elVoices.value.length} voci)`);
  } else {
    console.error('\n❌  ElevenLabs fetch eșuat:', elVoices.reason?.message);
  }

  // Minimax
  if (mmVoices.status === 'fulfilled') {
    const content = buildMinimaxFile(mmVoices.value);
    fs.writeFileSync(path.join(__dirname, 'minimax-voices.js'), content, 'utf8');
    console.log(`✅  minimax-voices.js salvat (${mmVoices.value.length} voci)`);
  } else {
    console.error('❌  Minimax fetch eșuat:', mmVoices.reason?.message);
  }

  console.log('\n🎉  Gata! Copiază fișierele generate în proiectul tău.');
  console.log('   Notă: sampleAudio URL-urile sunt incluse direct din API,');
  console.log('   nu mai trebuie să descarci nimic manual.\n');
})();
