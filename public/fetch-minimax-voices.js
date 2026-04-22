// ============================================================
//  fetch-minimax-voices.js — Rulează O SINGURĂ DATĂ pe server
//  Generează public/minimax-voices.js cu toate vocile Minimax
//
//  Cum rulezi:
//    node fetch-minimax-voices.js
//
//  Necesită .env cu AI33_API_KEY setat.
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_KEY  = process.env.AI33_API_KEY;
const BASE_URL = 'https://api.ai33.pro';

if (!API_KEY) { console.error('❌ AI33_API_KEY lipsește din .env!'); process.exit(1); }

// ── Fetch toate paginile ─────────────────────────────────────
async function fetchAllVoices() {
    let all = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const res = await fetch(`${BASE_URL}/v1m/voice/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': API_KEY },
            body: JSON.stringify({ page, page_size: 30, tag_list: [] })
        });
        if (!res.ok) { console.error(`❌ Eroare pagina ${page}: ${res.status}`); break; }
        const data = await res.json();
        if (!data.success || !data.data?.voice_list) break;

        all = all.concat(data.data.voice_list);
        hasMore = data.data.has_more;
        console.log(`  📄 Pagina ${page}: +${data.data.voice_list.length} voci (total: ${all.length})`);
        page++;
        // Mică pauză să nu spamăm API-ul
        await new Promise(r => setTimeout(r, 300));
    }
    return all;
}

// ── Mapare taguri Minimax → sistemul nostru ──────────────────
const LANG_MAP = {
    'English': 'english', 'Romanian': 'romanian', 'French': 'french',
    'Spanish': 'spanish', 'German': 'german', 'Italian': 'italian',
    'Portuguese': 'portuguese', 'Japanese': 'japanese', 'Korean': 'korean',
    'Chinese': 'chinese', 'Arabic': 'arabic', 'Hindi': 'indian',
    'Russian': 'other', 'Dutch': 'other', 'Swedish': 'other',
    'EN-British': 'british', 'EN-American': 'american',
};
const STYLE_SKIP = new Set(['Male','Female','Young','Middle Age','Old','Clone','EN-British','EN-American']);
const LANG_TAGS  = new Set(Object.keys(LANG_MAP));

function getAccent(tags) {
    for (const t of tags) {
        if (t === 'EN-British') return 'british';
        if (t === 'EN-American') return 'american';
        if (LANG_MAP[t]) return LANG_MAP[t];
    }
    return 'other';
}

function getGender(tags) {
    if (tags.includes('Female')) return 'female';
    if (tags.includes('Male'))   return 'male';
    return 'special';
}

function getUse(tags) {
    const t = tags.map(x => x.toLowerCase()).join(' ');
    if (t.includes('narrat') || t.includes('news'))          return 'narration';
    if (t.includes('social') || t.includes('entertainment')) return 'social';
    if (t.includes('conversational'))                        return 'conversational';
    if (t.includes('gaming') || t.includes('game'))          return 'gaming';
    if (t.includes('podcast'))                               return 'podcast';
    if (t.includes('professional') || t.includes('business'))return 'professional';
    return 'general';
}

function buildStyle(tags) {
    const accent = getAccent(tags);
    const extras = tags
        .filter(t => !LANG_TAGS.has(t) && !STYLE_SKIP.has(t))
        .map(t => t.toLowerCase())
        .slice(0, 2);
    return [accent, ...extras].join(' · ');
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
    console.log('🎙️  Fetch voci Minimax de la AI33...\n');
    const raw = await fetchAllVoices();
    console.log(`\n✅ Total brut: ${raw.length} voci`);

    const voices = raw.map(v => ({
        id:          v.voice_id,
        name:        v.voice_name,
        style:       buildStyle(v.tag_list || []),
        gender:      getGender(v.tag_list || []),
        tags:        (v.tag_list || []).map(t => t.toLowerCase().replace(/\s+/g, '')),
        accent:      getAccent(v.tag_list || []),
        use:         getUse(v.tag_list || []),
        sampleAudio: v.sample_audio || null,
    }));

    // Sortate A→Z
    voices.sort((a, b) => a.name.localeCompare(b.name));

    const lines = voices.map(v =>
        `  {id:"${v.id}", name:${JSON.stringify(v.name)}, style:${JSON.stringify(v.style)}, gender:"${v.gender}", tags:${JSON.stringify(v.tags)}, accent:"${v.accent}", use:"${v.use}", sampleAudio:${JSON.stringify(v.sampleAudio)}}`
    ).join(',\n');

    const output = `// ============================================================
//  VIRALIO VOICE STUDIO — minimax-voices.js
//  Toate vocile Minimax disponibile prin AI33
//  Generat: ${new Date().toLocaleDateString('ro-RO')} · Total: ${voices.length} voci
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

    const outPath = path.join(__dirname, 'public', 'minimax-voices.js');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output, 'utf8');
    console.log(`\n🎉 Generat: ${outPath}`);
    console.log(`   ${voices.length} voci · ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
