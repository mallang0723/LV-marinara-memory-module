// Provenance check. The five memory core modules and the three screen files must be byte-identical to the pinned upstream
// copies (SHA-256 below). UPSTREAM_MEMORY=/path/to/a/checkout/of/tlsiddl/marinara-memory-module additionally compares with that checkout
// (this fork's `main` branch is such a checkout).
// Usage: node scripts/verify-original.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const PINS = {
    'src/memory/core/ledger.cjs': 'ec3f0dff6eda390de666da7e2a1ec3a82dc373094bb857312d3981d31f4ec543',
    'src/memory/core/scenes.cjs': 'a7a35031103308e79db2b5a78cf479eae1ff0e8f5049bcb65dbc5d2a5b24be94',
    'src/memory/core/recall.cjs': '0a9403102871b888afe98b56aae16a7e4d73ac0de81658095c8c6ea525544fa2',
    'src/memory/core/vectors.cjs': '87e898a02bfe08d7cc79bab9279f0544ccb3a2de282313f66d80ddc8afd7b919',
    'src/memory/core/speakers.cjs': '8e590e9edf37f3b074cfe0f3613aa1cb3664b701976aecc84594fd017bb0cfc6',
    'src/memory/ui/runtime.orig.js': '9db79531b4005ddfc286a8bb56dc6a60524581e63452dd7932a9094425cc795a',
    'src/memory/ui/ui.orig.css': '6fe45563b99e54a140e801ae578bb9432ee059e352cd0d6d95db539f30d62124',
    'src/memory/ui/theme.orig.css': 'd430d75dbab22b7e28ea9acfdd233cfaccbd41500cad200a2068c66431f676e3',
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
    if (up) for (const n of ['ledger', 'scenes', 'recall', 'vectors', 'speakers']) {
        const u = `${up}/memory-module/lib/${n}.cjs`;
        if (existsSync(u) && sha(u) !== sha(`${root}/src/memory/core/${n}.cjs`)) bad.push(`${n}.cjs differs from upstream clone`);
    }
    return bad;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
    const bad = verify();
    console.log(JSON.stringify({ ok: !bad.length, problems: bad.length }));
    for (const b of bad) console.log(b);
    process.exit(bad.length ? 1 : 0);
}
