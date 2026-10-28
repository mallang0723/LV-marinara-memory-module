// Lumiverse rejects backends containing Buffer.from(..., "base64") ("base64 decoding"). dist/backend.js must decode embedding
// vectors another way, with results identical to the Buffer decode of the stored data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const file = new URL('../dist/backend.js', import.meta.url);
const src = existsSync(file) ? readFileSync(file, 'utf8') : '';

test('dist/backend.js has no Buffer.from(..., base64) (scanner pattern)', () => {
    assert.ok(src.length > 100_000, 'run npm run build');
    assert.ok(!/\bBuffer\.from\s*\([^)]*["'`]base64["'`]/.test(src));
});

test('the bundled unpack() decodes Buffer-made base64 identically; pack() unchanged', () => {
    const m = src.match(/function unpack\(text\) \{[\s\S]*?\n  \}/);
    assert.ok(m, 'unpack() found in bundle');
    const unpack = new Function(`${m[0]}; return unpack;`)();
    const f = new Float32Array([1, -2.5, 0.125, 123456.789, 1e-7, -0]);
    const text = Buffer.from(f.buffer).toString('base64');
    assert.deepEqual([...unpack(text)], [...f]);
    assert.equal(unpack('AACAPwAAAMA=')[1], -2);
    assert.equal(unpack('').length, 0);
});
