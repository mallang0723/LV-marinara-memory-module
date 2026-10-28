// AGENTS 3: the phone opens the app over plain http (not a secure context): no bare crypto.randomUUID / crypto.subtle /
// navigator.clipboard / navigator.share in what ships. Reads the built dist/frontend.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const file = new URL('../dist/frontend.js', import.meta.url);
const src = existsSync(file) ? readFileSync(file, 'utf8') : '';

test('dist/frontend.js exists and carries the memory screen', () => {
    assert.ok(src.length > 150_000, `dist/frontend.js is ${src.length} bytes (run npm run build)`);
    assert.ok(src.includes('mountMemory'));
    assert.ok(!/mountAnon|acm-root|anonymousCommunity|anon\/rp-material/.test(src), 'no anon community code in the bundle');
});

test('every randomUUID use is guarded (0 bare crypto.randomUUID() calls)', () => {
    const uses = [...src.matchAll(/randomUUID/g)];
    assert.ok(uses.length >= 1);
    let bare = 0;
    for (const m of uses) {
        const ctx = src.slice(Math.max(0, m.index - 80), m.index + 60);
        const guarded = /typeof\s+[\w$.]+\.randomUUID\s*===\s*["']function["']/.test(ctx) || /\?\.randomUUID\?\.\(/.test(ctx) || /randomUUID\s*===\s*["']function["']/.test(ctx);
        const call = /crypto\.randomUUID\s*\(/.test(src.slice(m.index - 7, m.index + 20));
        if (!guarded && call) bare++;
    }
    assert.equal(bare, 0);
    // the textual check the QA guide asks for: no crypto.randomUUID() that is not the guarded form
    const unguarded = src.split('\n').filter(l => /crypto\.randomUUID\(\)/.test(l) && !/typeof|\?\.|=== ["']function["']|if \(/.test(l));
    assert.deepEqual(unguarded, []);
});

test('no crypto.subtle, navigator.clipboard, navigator.share, execCommand copy in the shipped frontend', () => {
    for (const re of [/crypto\.subtle/, /navigator\.clipboard/, /navigator\.share/, /execCommand\(/, /showSaveFilePicker/]) assert.ok(!re.test(src), String(re));
});

test('no fetch to the network from the shipped screens except through the shim (no bare /api/ URL strings)', () => {
    // the originals' strings "api/..." paths are request paths for the shim; a literal fetch(`/api/` must not remain
    assert.ok(!/\bfetch\(\s*[`"']\/api\//.test(src));
    assert.ok(!/window\.fetch\s*=/.test(src), 'the original window.fetch hook is gone');
});

test('the generated screens carry the override sheets after the originals', () => {
    assert.ok(src.includes('LV.css') || src.includes('${LV.css}') || /\+\s*LV\.css/.test(src));
    assert.ok(src.includes('max(15px,1em)'), 'override sheet is in the bundle');
});
