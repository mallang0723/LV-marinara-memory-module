// Provenance check. The twenty-one upstream modules (twenty cores plus service.cjs) and the three screen files must be byte-identical to the pinned upstream
// copies (SHA-256 below). UPSTREAM_MEMORY=/path/to/a/checkout/of/tlsiddl/marinara-memory-module additionally compares with that checkout
// (this fork's `main` branch is such a checkout).
// Usage: node scripts/verify-original.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const PINS = {
    'src/memory/core/trackers.cjs': '6765612649a9dc18544f1be5200d820ff2633f7316601e2eb61c9bf8b367b5da',
    'src/memory/core/selected.cjs': '2b1892128785279e49a310c372a6635b2202f76ad591d8ffaee17ca5f3005747',
    'src/memory/core/reasons.cjs': 'a9ff699a1ab6944ef1bb58d24e761757f9c17a950937c0e2a8ddaba7e91f4c9e',
    'src/memory/core/conflicts.cjs': '3201188ff2c2204d17edeff092b4a8dba7a6e4d06adf804c39ae48651c7d8e5d',
    'src/memory/core/backup.cjs': '176157b371c76c504b8c1d406e993b94ec7c34e33dedc6acbd41513800767a29',
    'src/memory/core/ledger.cjs': '856c49875915f9207938572310378ca88d75cdbe5651f70e55f5015b0f990582',
    'src/memory/core/scenes.cjs': 'b30c93ea7b0033876a94e37f63ac906b6d71e8f217b4b2b40370a419fd75bfca',
    'src/memory/core/recall.cjs': '01570f40dc105c88de6341f9b30277b44c291b47b61794d59a25d7239a57b889',
    'src/memory/core/vectors.cjs': 'e8e8cd7cd1430c9679427e912ef6356f8ce561731e7f689d0c8903fac3d238a9',
    'src/memory/core/speakers.cjs': '74ded6367848f9f52ed372f50000175598e82c6bfbe70ed6b893bf6ecf9f3b89',
    'src/memory/core/translate.cjs': '44b1fc88bff9db05ff01704f9ebf48b8f663ed787406421c7b1e1e759c7c0936',
    'src/memory/core/aliases.cjs': '02a5781536a12a3f5dbd63400452137a7b62ab95601edcb2d7cb736bacbfc9c7',
    'src/memory/core/keepsakes.cjs': '919e3de8e9af816a5661e15e6eb6e091b88c7a386aad697feee161a3e481e46a',
    'src/memory/core/knowledge.cjs': '42e170be29dfa403fe37233e15a27ea50f888b8514bcfa463875dfc7ca796172',
    'src/memory/core/places.cjs': 'd72e470557d45990c80b5e3c031f6159b76d3793c71bbee8e7107e06ddadf438',
    'src/memory/core/state.cjs': '558ca86c39ce355b5cc8bababf440541269ad23fd56e23d31da69976cceef5db',
    'src/memory/core/names.cjs': '1cc982d12c5ff7be450949da6720a11e3ea84ece8ec3e944a58bdb4f7a5054cf',
    'src/memory/core/address.cjs': 'ba9f520f0093c9849c7af92cd1eb791da57fe03307dcda365422ee193603cc4c',
    'src/memory/core/features.cjs': '6b70016da998f21721b64003aa402b6edd6fdcd8924aef643a4b55e155519ab6',
    'src/memory/core/notebook.cjs': '91496f89506cc1756fbc6f7925324447a88aa75718772992a7fc9b53b4cd76a9',
    'src/memory/core/service.cjs': '7ba52c0027af0fea61f3348da4ec8e73b4a5a63b41536f2e232522111ccc02de',
    'src/memory/ui/runtime.orig.js': '2eaf1e63c77ad831f0c34876a2f746ddb97765da6254b3cbd361f7c19c581c0f',
    'src/memory/ui/ui.orig.css': 'd362c7bbc20673156e00637b06e884fd5270925f72e1fca5f54a5c79aecc236a',
    'src/memory/ui/theme.orig.css': 'a858619ca380b78719be8a0465bb49add07f26b79a51caf51ebf5a7b246eeb97',
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
