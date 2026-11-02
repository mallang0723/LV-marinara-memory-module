// Provenance check. The six memory core modules and the three screen files must be byte-identical to the pinned upstream
// copies (SHA-256 below). UPSTREAM_MEMORY=/path/to/a/checkout/of/tlsiddl/marinara-memory-module additionally compares with that checkout
// (this fork's `main` branch is such a checkout).
// Usage: node scripts/verify-original.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const PINS = {
    'src/memory/core/translate.cjs': '019582f8e48f69401e749fc11207e2d330c86ee04dfe38bd15bf570731549df5',
    'src/memory/core/ledger.cjs': 'a5eefedc8a67aadfb04a116e9c30efe842d44890c92902812611c79d71f694b2',
    'src/memory/core/scenes.cjs': '209cda809ed8ec9c2032dfcdf6d4bdf0087be834a4e45659dc58219c6fffee29',
    'src/memory/core/recall.cjs': '0a9403102871b888afe98b56aae16a7e4d73ac0de81658095c8c6ea525544fa2',
    'src/memory/core/vectors.cjs': '87e898a02bfe08d7cc79bab9279f0544ccb3a2de282313f66d80ddc8afd7b919',
    'src/memory/core/speakers.cjs': 'e005c5a0801890314b4cb0db70bc84e827433e7cc0f16f3cc8fd32893c7d5ca0',
    'src/memory/ui/runtime.orig.js': 'b056fc057f258b4d7ccc892340724ffbd62dd095dd14fb13a5dab80fb3d5700d',
    'src/memory/ui/ui.orig.css': '7ec55c4359c1487da99240fc5b53e016280a9f8b903fda14a247ca1e97a58259',
    'src/memory/ui/theme.orig.css': 'de5bced8c35480baf962e2f7b6baf24b6fafe217d5d201d30aa498205621f2db',
};
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
export function verify(root = '.') {
    const bad = [];
    for (const [file, pin] of Object.entries(PINS)) {
        const p = `${root}/${file}`;
        if (!existsSync(p)) { bad.push(`${file}: missing`); continue; }
        if (sha(p) !== pin) bad.push(`${file}: sha256 ${sha(p)} != pinned ${pin}`);
    }
    const up = process.env.UPSTREAM_MEMORY;
    if (up) for (const file of Object.keys(PINS)) {
        const relative = file.startsWith('src/memory/core/')
            ? file.replace('src/memory/core/', 'memory-module/lib/')
            : file.replace('src/memory/ui/', 'extension/').replace('.orig.', '.');
        const upstream = `${up}/${relative}`;
        if (!existsSync(upstream)) bad.push(`${relative}: missing in upstream checkout`);
        else if (sha(upstream) !== sha(`${root}/${file}`)) bad.push(`${file} differs from upstream checkout`);
    }
    return bad;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const bad = verify();
    console.log(JSON.stringify({ ok: !bad.length, problems: bad.length }));
    for (const b of bad) console.log(b);
    process.exit(bad.length ? 1 : 0);
}
