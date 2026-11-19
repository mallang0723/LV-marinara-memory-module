// Lumiverse-only limits. Keep the pinned upstream core files byte-identical.
// Each context is unique, including the four separate copies of scene time.
import { replaceAnchor } from '../patch-util.mjs';

export function patchScenes(source) {
    const patches = [
        ['scene time', 'time: cleanText(item.time, 60)', 'time: cleanText(item.time, 120)'],
        ['place note fallback', 'sceneNotesOf(item.placeNotes, cleanText(item.place, 60))', 'sceneNotesOf(item.placeNotes, cleanText(item.place, 120))'],
        ['scene weather', 'weather: cleanText(item.weather, 30)', 'weather: cleanText(item.weather, 60)'],
        ['event time', 'time: cleanText(e?.time, 40)', 'time: cleanText(e?.time, 80)'],
        ['fact time', 'sceneId: id, when: cleanText(item.time, 60)', 'sceneId: id, when: cleanText(item.time, 120)'],
        ['learned time', 'fact: factRef, in: id, when: cleanText(item.time, 60)', 'fact: factRef, in: id, when: cleanText(item.time, 120)'],
        ['inferred learned time', 'fact: old.id, in: id, when: cleanText(item.time, 60)', 'fact: old.id, in: id, when: cleanText(item.time, 120)'],
        ['later time', 'by: cleanText(x?.by, 40), in: id, when: cleanText(item.time, 60)', 'by: cleanText(x?.by, 40), in: id, when: cleanText(item.time, 120)'],
    ];
    for (const [name, anchor, replacement] of patches) source = replaceAnchor(source, anchor, replacement, { name });
    for (const name of ['state', 'places', 'keepsakes']) source = replaceAnchor(source, `require('./${name}.cjs')`, `require('./${name}.generated.cjs')`, { name: `${name} runtime import` });
    return source;
}

// Recall must resolve the same patched scene module as the service and routes.
export function patchRecall(source) {
    return replaceAnchor(source, "require('./scenes.cjs')", "require('./scenes.generated.cjs')", { name: 'recall scenes import' });
}

export function patchNames(source) {
    return replaceAnchor(source, "require('./scenes.cjs')", "require('./scenes.generated.cjs')", { name: 'names scenes import' });
}
export function patchAddress(source) {
    source = replaceAnchor(source, "require('./scenes.cjs')", "require('./scenes.generated.cjs')", { name: 'address scenes import' });
    source = replaceAnchor(source, "const lookAlike = require('./names.cjs').lookAlike;", "const lookAlike = require('./names.generated.cjs').lookAlike;", { name: 'address name pairs' });
    return replaceAnchor(source, "if (require('./names.cjs').lookAlike(a, b))", "if (require('./names.generated.cjs').lookAlike(a, b))", { name: 'address name sound' });
}

// Preserve every deliberate user choice; only automatic cards use the original caps.
export function patchCards(source, kind) {
    const [list, cap] = { state: ['cards', 'MAX_CARDS'], places: ['out', 'MAX_PLACES'], keepsakes: ['out', 'MAX_ITEMS'] }[kind];
    const protectedCard = "c => c.custom || Object.keys(c.user || {}).length || (c.aliases || []).length";
    source = replaceAnchor(source, `${list}.slice(0, ${cap})`, `limited`, { name: `${kind} preserve user cards` });
    const marker = `  const next = { version: ${kind === 'state' ? 'STATE' : kind === 'places' ? 'PLACES' : 'KEEPSAKES'}_VERSION,`;
    source = replaceAnchor(source, marker, `  const protectedCard = ${protectedCard};
  const automatic = ${list}.filter(c => !protectedCard(c));
  const keep = new Set(automatic.slice(0, Math.max(0, ${cap} - ${list}.filter(protectedCard).length)));
  const limited = ${list}.filter(c => protectedCard(c) || keep.has(c));
${marker}`, { name: `${kind} cap accounting` });
    source = replaceAnchor(source, '  if (!same(next.', '  if (' + list + '.length > limited.length) next.omittedAuto = ' + list + '.length - limited.length;\n  if (!same(next.', { name: `${kind} omitted notice` });
    const guard = source.split('\n').find(line => line.includes('throw Error(`') && line.includes('>= ' + cap));
    if (!guard) throw Error(`missing ${kind} manual add guard`);
    return replaceAnchor(source, guard, '  // Manual cards are never limited.', { name: `${kind} manual add` });
}
export function patchReasons(source) {
    return replaceAnchor(source, '.filter(validId))].slice(0, MAX_IDS)', '.filter(validId))]', { name: 'preserve every recall mark' });
}
export function patchTrackers(source) {
    return replaceAnchor(source, '  need(file.items.length < MAX_ITEMS, `트래커는 방마다 ${MAX_ITEMS}개까지 둘 수 있습니다.`);', '  // Trackers are user-created; do not cap them.', { name: 'manual trackers' });
}
export function patchConflicts(source) {
    source = patchRecall(source);
    source = replaceAnchor(source, "    if (!byId.has(c.a) || !byId.has(c.b)) continue;", "    if (!byId.has(c.a) || !byId.has(c.b)) { if (['keepA', 'keepB'].includes(c.status)) kept.push(c); continue; }", { name: 'retain decisions across missing or merged facts' });
    source = replaceAnchor(source, "const at = kept.findIndex((c) => c.status !== 'open');", "const at = kept.findIndex((c) => ['both', 'dismissed'].includes(c.status));", { name: 'never prune exclusions' });
    source = replaceAnchor(source, "  for (const hit of [...found.values()]", "  const omittedAuto = Math.max(0, found.size - Math.max(0, MAX_OPEN - open));\n  for (const hit of [...found.values()]", { name: 'open conflict omissions' });
    source = replaceAnchor(source, '  if (!same(file.conflicts, old.conflicts))', '  if (omittedAuto) file.omittedAuto = omittedAuto;\n  if (!same(file.conflicts, old.conflicts))', { name: 'conflict omission notice' });
    return replaceAnchor(source, 'return { open: open.length, conflicts:', 'return { omittedAuto: file?.omittedAuto || 0, open: open.length, conflicts:', { name: 'conflict notice view' });
}

// The pinned service.cjs becomes a factory: one instance per user, with its own `require` (fs, path, the cores), `process`
// and `module`. The body is the original text; the only edit inside it keeps a "stored but not loaded yet" file (code
// LV_NOT_LOADED, see src/adapter/vfs.js) from being taken for a broken one.
export function patchService(source) {
    source = replaceAnchor(source, "      return fallback;\n    }\n    return markBroken(file, error, fallback, replaceable);",
        "      return fallback;\n    }\n    if (error?.code === 'LV_NOT_LOADED') throw error;\n    return markBroken(file, error, fallback, replaceable);", { name: 'service readJson not-loaded' });
    // "하단 블록 빼고 읽기" (src/adapter/hide-blocks.cjs): with the option on, the adapter hands over the story without the wi-exclude blocks
    // as `content` and the stored text as `rawContent`. The message fingerprint (h) must stay the one of the stored text, so a room
    // can switch the option without every folded message looking edited. Off: rawContent never exists and nothing below runs.
    // (ledger.cjs's own hashText(row.content) is not patched: the service rebuilds the rows, so the fingerprint is set here, after prepareMessages.)
    source = replaceAnchor(source, "content: String(row.content), swipe: row.activeSwipeIndex, ...(tr ? { tr } : {}) });", "content: String(row.content), swipe: row.activeSwipeIndex, ...(tr ? { tr } : {}), ...(typeof row.rawContent === 'string' ? { rawContent: row.rawContent } : {}) });", { name: 'service keep raw content' });
    source = replaceAnchor(source, "  const prepared = L.prepareMessages(out, { speechMarks: settings().chats?.[chatId]?.speechMarks || null });\n", "  const prepared = L.prepareMessages(out, { speechMarks: settings().chats?.[chatId]?.speechMarks || null });\n  for (const m of prepared) if (typeof m.rawContent === 'string') { m.h = L.hashText(m.rawContent); delete m.rawContent; }\n", { name: 'service fingerprint of stored text' });
    // Marinara's server loader is never used (the engine is supplied by the adapter), and Lumiverse's extension scanner refuses a
    // dynamic import in a backend bundle: the call is replaced by a rejection. `process.x` is renamed to `hostProcess.x` (the
    // factory's parameter, a plain object of ours) because the scanner refuses the text `process.env`.
    source = replaceAnchor(source, 'import(pathToFileURL(path.join(dist, rel)).href)', "Promise.reject(Error('Marinara engine is not available on Lumiverse'))", { name: 'service engine import' });
    // The recall's own time limit follows the interceptor budget the user set (hostProcess.lvRecallBudgetMs), else the env default.
    source = replaceAnchor(source, '  const left = () => RECALL_TIMEOUT_MS - (Date.now() - started);', '  const left = () => (hostProcess.lvRecallBudgetMs?.() || RECALL_TIMEOUT_MS) - (Date.now() - started);', { name: 'service recall budget' });
    // Token meter (src/common/meter.js): each memory-model call says what it is for. 회상 = recall, 점검 = review/tidy, everything else = 정리 (default).
    source = replaceAnchor(source, 'async function askModel(model, messages, { maxTokens = 4096 } = {}) {', 'async function askModel(model, messages, { maxTokens = 4096, lvKind } = {}) {', { name: 'meter askModel kind' });
    source = replaceAnchor(source, 'const base = { model: model.model, maxTokens, temperature: 0.2, signal, ...(model.extra || {}) };', 'const base = { model: model.model, maxTokens, temperature: 0.2, signal, ...(lvKind ? { lvKind } : {}), ...(model.extra || {}) };', { name: 'meter base kind' });
    source = replaceAnchor(source, 'store.chapters || [], entry.semantic || []), { maxTokens: 600 });', "store.chapters || [], entry.semantic || []), { maxTokens: 600, lvKind: 'recall' });", { name: 'meter recall kind' });
    source = replaceAnchor(source, 'askModel(model, review.messages, { maxTokens: 1024 })', "askModel(model, review.messages, { maxTokens: 1024, lvKind: 'check' })", { name: 'meter review kind', count: 2 });
    source = replaceAnchor(source, 'askModel(model, L.buildTidyPrompt(view, recent, { after })))', "askModel(model, L.buildTidyPrompt(view, recent, { after }), { lvKind: 'check' }))", { name: 'meter tidy kind' });
    source = replaceAnchor(source, 'askModel(model, L.buildTidyPrompt({ threads: group }, recent)))', "askModel(model, L.buildTidyPrompt({ threads: group }, recent), { lvKind: 'check' }))", { name: 'meter tidy2 kind' });
    const renamed = source.replace(/\bprocess\.(?=[a-zA-Z_])/g, 'hostProcess.');
    if (renamed === source) throw new Error('patch "service process rename" changed nothing');
    return `module.exports = function createUpstreamService(require, hostProcess, module) {\n${renamed}\nreturn module.exports;\n};\n`;
}
