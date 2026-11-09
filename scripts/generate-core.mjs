import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { patchScenes, patchRecall, patchNames, patchAddress, patchCards, patchReasons, patchTrackers, patchConflicts } from '../src/memory/core-patch.mjs';
import { verify } from './verify-original.mjs';

export function generateCore() {
    const bad = verify(fileURLToPath(new URL('../', import.meta.url)));
    if (bad.length) throw Error('original files differ from their pins:\n' + bad.join('\n'));
    // Validate every patch before writing any generated module.
    const modules = [['scenes', patchScenes], ['recall', patchRecall], ['names', patchNames], ['address', patchAddress], ['conflicts', patchConflicts], ['state', s => patchCards(s, 'state')], ['places', s => patchCards(s, 'places')], ['keepsakes', s => patchCards(s, 'keepsakes')], ['reasons', patchReasons], ['trackers', patchTrackers], ['backup', patchRecall]].map(([name, patch]) => [
        new URL(`../src/memory/core/${name}.generated.cjs`, import.meta.url),
        '// GENERATED from the pinned upstream original. Do not edit.\n' + patch(readFileSync(new URL(`../src/memory/core/${name}.cjs`, import.meta.url), 'utf8')),
    ]);
    for (const [url, source] of modules) writeFileSync(url, source);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) generateCore();
