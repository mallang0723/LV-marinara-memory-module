import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const V = createRequire(import.meta.url)('../src/memory/core/vectors.cjs');

test('pack -> unpack roundtrip keeps Float32 values; pack format is Buffer base64', () => {
    const v = [0.5, -1.25, 3.14159, 0, 1e-7, -2048.5];
    const f = new Float32Array(v);
    assert.equal(V.pack(v), Buffer.from(f.buffer).toString('base64'));
    assert.deepEqual([...V.unpack(V.pack(v))], [...f]);
});
