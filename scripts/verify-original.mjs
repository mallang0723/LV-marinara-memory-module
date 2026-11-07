// Provenance check. The fourteen memory core modules and the three screen files must be byte-identical to the pinned upstream
// copies (SHA-256 below). UPSTREAM_MEMORY=/path/to/a/checkout/of/tlsiddl/marinara-memory-module additionally compares with that checkout
// (this fork's `main` branch is such a checkout).
// Usage: node scripts/verify-original.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const PINS = {
    'src/memory/core/ledger.cjs': '52eddd1c15365ba3fc925f8bd67f049393bc92acd53bfcab32969a822b508940',
    'src/memory/core/scenes.cjs': '6b8799d5052e69009f39c00bfe4a9dfd27b74058624c66803c059bdbf043cf7c',
    'src/memory/core/recall.cjs': 'c544134e3dae15931a153df1b1c5194771bb1735461bc4e7508fdf9ae2c6b9a6',
    'src/memory/core/vectors.cjs': 'a317a49b8d7dffb3d3efb1aa054a74d495ef5c2a3a5f2f188469a88b3d86e371',
    'src/memory/core/speakers.cjs': '74ded6367848f9f52ed372f50000175598e82c6bfbe70ed6b893bf6ecf9f3b89',
    'src/memory/core/translate.cjs': '1fb6a2232d412952e3918882234c76ccdfc7af8f39abd31beb70857e43a1e50e',
    'src/memory/core/aliases.cjs': 'afaff01e2bbdd9258fe166c56afeb10fa25cc6a0496969f0147e88fd3b5c0ec8',
    'src/memory/core/keepsakes.cjs': '919e3de8e9af816a5661e15e6eb6e091b88c7a386aad697feee161a3e481e46a',
    'src/memory/core/knowledge.cjs': '42e170be29dfa403fe37233e15a27ea50f888b8514bcfa463875dfc7ca796172',
    'src/memory/core/places.cjs': 'd72e470557d45990c80b5e3c031f6159b76d3793c71bbee8e7107e06ddadf438',
    'src/memory/core/state.cjs': '9a5a2843b9f91f57232c748d2a27eaa64890d337d32a6f4847b8ab964f2f6025',
    'src/memory/core/names.cjs': '1cc982d12c5ff7be450949da6720a11e3ea84ece8ec3e944a58bdb4f7a5054cf',
    'src/memory/core/address.cjs': '47e8dea319451bec189068cfdbf5c70cf7697aecc4dbcfa1c7a4a5af30122914',
    'src/memory/core/features.cjs': '878764c5f716f4344a01306e42c84fc2bb09bc6c4749bb723495303cee201d47',
    'src/memory/ui/runtime.orig.js': '47bfacd40f890bae4dd4f0df0abf736abe63a8cedce5a08ed68ac0a5f0f6b2b0',
    'src/memory/ui/ui.orig.css': 'debd8a8a99fbbe935186aa06165ab021708283fc2e88a5924f6920bd0d7120f6',
    'src/memory/ui/theme.orig.css': 'bb90898cb08dad340eb0c1381fd0482dc9196f127d70586500a85a7983446310',
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
