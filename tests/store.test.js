import test from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './fake.js';
import { createStore, wrapHostError } from '../src/common/store.js';

const U = 'u1';
const mk = (opts = {}) => { const f = fake(); const s = createStore(f.api, { debounceMs: 0, ...opts }); return { f, s }; };

test('every store call requires a userId', async () => {
    const { s } = mk();
    await assert.rejects(() => s.getJson('', 'a.json'), /userId required/);
    await assert.rejects(async () => s.setJson(undefined, 'a.json', {}), /userId required/);
    await assert.rejects(() => s.remove(null, 'a.json'), /userId required/);
});

test('round trip and fallback; a missing file is not "broken"', async () => {
    const { f, s } = mk();
    assert.deepEqual(await s.getJson(U, 'memory/settings.json', { x: 1 }), { x: 1 });
    assert.equal(s.brokenList(U).length, 0);
    await s.setJson(U, 'memory/settings.json', { connection: 'c1' });
    assert.deepEqual(await s.getJson(U, 'memory/settings.json', null), { connection: 'c1' });
    assert.ok(f.files.has(`${U}:memory/settings.json`));
    assert.ok(!f.files.get(`${U}:memory/settings.json`).includes('\n'), 'compact JSON, not the 2-space default of setJson');
});

test('users are isolated', async () => {
    const { s } = mk();
    await s.setJson('a', 'k.json', { v: 1 });
    assert.equal(await s.getJson('b', 'k.json', null), null);
});

test('broken JSON: copy kept aside once, file never overwritten, fixing it lifts the block', async () => {
    const { f, s } = mk({ now: () => new Date('2026-10-26T01:02:03.456Z') });
    f.files.set(`${U}:memory/chats/c1.json`, '{"version":1,');
    assert.equal(await s.getJson(U, 'memory/chats/c1.json', null), null);
    const copy = 'memory/chats/c1.json.broken-2026-10-26T01-02-03-456Z';
    assert.equal(f.files.get(`${U}:${copy}`), '{"version":1,');
    assert.equal(s.brokenList(U).length, 1);
    await assert.rejects(async () => s.setJson(U, 'memory/chats/c1.json', { version: 1 }), e => e.code === 'broken' && /덮어쓰지 않도록/.test(e.message) && e.message.includes(copy));
    assert.equal(f.files.get(`${U}:memory/chats/c1.json`), '{"version":1,', 'original untouched');
    await s.getJson(U, 'memory/chats/c1.json', null);       // second read does not make a second copy
    assert.equal([...f.files.keys()].filter(k => k.includes('.broken-')).length, 1);
    f.files.set(`${U}:memory/chats/c1.json`, '{"version":1}');
    assert.deepEqual(await s.getJson(U, 'memory/chats/c1.json', null), { version: 1 });
    await s.setJson(U, 'memory/chats/c1.json', { version: 1, ok: true });   // block lifted
});

test('unknown data version is kept and not overwritten', async () => {
    const { f, s } = mk();
    f.files.set(`${U}:memory/chats/c2.json`, JSON.stringify({ version: 99, threads: [] }));
    const stored = await s.getJson(U, 'memory/chats/c2.json', null);
    assert.equal(await s.supported(U, 'memory/chats/c2.json', stored, 1), null);
    assert.equal(s.brokenList(U)[0].reason, 'version');
    await assert.rejects(async () => s.setJson(U, 'memory/chats/c2.json', {}), e => e.code === 'broken' && /모르는 형식/.test(e.message));
});

test('replaceable broken files (vector index) may be rebuilt', async () => {
    const { f, s } = mk();
    f.files.set(`${U}:memory/chats/c3.vectors.json`, 'nope');
    assert.equal(await s.getJson(U, 'memory/chats/c3.vectors.json', null, { replaceable: true }), null);
    await s.setJson(U, 'memory/chats/c3.vectors.json', { items: {} });
    assert.deepEqual(JSON.parse(f.files.get(`${U}:memory/chats/c3.vectors.json`)), { items: {} });
});

test('debounce: several writes of one key within the window become one write of the last value', async () => {
    const timers = [];
    const { f, s } = mk({ debounceMs: 500, setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: id => { timers[id - 1] = null; } });
    let writes = 0;
    const orig = f.api.userStorage.write; f.api.userStorage.write = async (...a) => { writes++; return orig(...a); };
    const p = [s.setJson(U, 'k.json', { n: 1 }), s.setJson(U, 'k.json', { n: 2 }), s.setJson(U, 'k.json', { n: 3 })];
    assert.equal(writes, 0);
    assert.deepEqual(await s.getJson(U, 'k.json', null), { n: 3 }, 'pending value is visible to reads');
    timers.filter(Boolean).forEach(fn => fn());
    await Promise.all(p);
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(f.files.get(`${U}:k.json`)), { n: 3 });
});

test('flush writes everything pending at once', async () => {
    const { f, s } = mk({ debounceMs: 60000 });
    const p = s.setJson(U, 'k.json', { n: 1 });
    await s.flush(U);
    await p;
    assert.deepEqual(JSON.parse(f.files.get(`${U}:k.json`)), { n: 1 });
    assert.equal(s.hasPending(), false);
});

test('permission errors get code permission and a Korean hint', () => {
    const e = wrapHostError(new Error('PERMISSION_DENIED: chat_mutation — Chat mutation permission not granted'));
    assert.equal(e.code, 'permission');
    assert.match(e.message, /chat_mutation/);
    assert.match(e.message, /허용/);
});
