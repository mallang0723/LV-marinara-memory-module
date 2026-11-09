// Lumiverse-only limits. Keep the pinned upstream core files byte-identical.
// Each context is unique, including the four separate copies of scene time.
import { replaceAnchor } from '../patch-util.mjs';

export function patchScenes(source) {
    const patches = [
        ['scene time', 'time: cleanText(item.time, 60)', 'time: cleanText(item.time, 120)'],
        ['place note fallback', 'sceneNotesOf(item.placeNotes, cleanText(item.place, 60))', 'sceneNotesOf(item.placeNotes, cleanText(item.place, 120))'],
        ['scene place', 'place: cleanText(item.place, 60)', 'place: cleanText(item.place, 120)'],
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
