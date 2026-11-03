// Lumiverse-only limits. Keep the pinned upstream core files byte-identical.
// Each context is unique, including the four separate copies of scene time.
import { replaceAnchor } from '../patch-util.mjs';

export function patchScenes(source) {
    const patches = [
        ['scene time', 'time: cleanText(item.time, 60)', 'time: cleanText(item.time, 120)'],
        ['scene place', 'place: cleanText(item.place, 60)', 'place: cleanText(item.place, 120)'],
        ['scene weather', 'weather: cleanText(item.weather, 30)', 'weather: cleanText(item.weather, 60)'],
        ['event time', 'time: cleanText(e?.time, 40)', 'time: cleanText(e?.time, 80)'],
        ['fact time', 'sceneId: id, when: cleanText(item.time, 60)', 'sceneId: id, when: cleanText(item.time, 120)'],
        ['learned time', 'fact: factRef, in: id, when: cleanText(item.time, 60)', 'fact: factRef, in: id, when: cleanText(item.time, 120)'],
        ['inferred learned time', 'fact: old.id, in: id, when: cleanText(item.time, 60)', 'fact: old.id, in: id, when: cleanText(item.time, 120)'],
        ['later time', 'by: cleanText(x?.by, 40), in: id, when: cleanText(item.time, 60)', 'by: cleanText(x?.by, 40), in: id, when: cleanText(item.time, 120)'],
    ];
    for (const [name, anchor, replacement] of patches) source = replaceAnchor(source, anchor, replacement, { name });
    return source;
}

// Recall must resolve the same patched scene module as the service and routes.
export function patchRecall(source) {
    return replaceAnchor(source, "require('./scenes.cjs')", "require('./scenes.generated.cjs')", { name: 'recall scenes import' });
}
