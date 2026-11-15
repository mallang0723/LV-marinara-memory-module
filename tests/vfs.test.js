// The synchronous fs stand-in over async userStorage (the top risk of the wholesale transplant: spike-proven here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './fake.js';
import { createVfs, ROOT, NOT_LOADED } from '../src/adapter/vfs.js';

const mk = (f, o = {}) => createVfs({ storage: f.api.userStorage, userId: 'u1', debounceMs: 0, ...o });

test('read after write is immediate and sync; the file reaches storage; a new instance reads it back', async () => {
    const f = fake();
    const v = mk(f);
    await v.init();
    v.fs.mkdirSync(`${ROOT}/chats`, { recursive: true });
    v.fs.writeFileSync(`${ROOT}/chats/a.json`, '{"x":1}');
    assert.equal(v.fs.readFileSync(`${ROOT}/chats/a.json`, 'utf8'), '{"x":1}');
    assert.deepEqual(await v.flush(), { failed: [], errors: [] });
    assert.equal(f.files.get('u1:memory/chats/a.json'), '{"x":1}');
    const v2 = mk(f);
    await v2.init();
    assert.equal(v2.fs.existsSync(`${ROOT}/chats/a.json`), true, 'listed');
    assert.throws(() => v2.fs.readFileSync(`${ROOT}/chats/a.json`, 'utf8'), e => e.code === NOT_LOADED, 'stored but not loaded is never ENOENT');
    assert.deepEqual([...v2.misses], [`${ROOT}/chats/a.json`]);
    await v2.preload('chats/a.');
    assert.equal(v2.fs.readFileSync(`${ROOT}/chats/a.json`, 'utf8'), '{"x":1}');
    assert.throws(() => v2.fs.readFileSync(`${ROOT}/chats/none.json`, 'utf8'), e => e.code === 'ENOENT');
});

test('write temp + rename: only the final file is stored; temp names never are', async () => {
    const f = fake();
    const v = mk(f);
    await v.init();
    const file = `${ROOT}/chats/b.json`, tmp = `${file}.123.tmp`;
    v.fs.mkdirSync(`${ROOT}/chats`);
    v.fs.writeFileSync(tmp, 'T');
    v.fs.renameSync(tmp, file);
    await v.flush();
    assert.deepEqual([...f.files.keys()], ['u1:memory/chats/b.json']);
    assert.equal(v.fs.existsSync(tmp), false);
});

test('directory rename and recursive remove (the restore safety copy pattern)', async () => {
    const f = fake();
    const v = mk(f);
    await v.init();
    const tmp = `${ROOT}/restore-undo/c.tmp-9`, dir = `${ROOT}/restore-undo/c`;
    v.fs.mkdirSync(tmp, { recursive: true });
    v.fs.writeFileSync(`${tmp}/meta.json`, 'M'); v.fs.writeFileSync(`${tmp}/ledger.json`, 'L');
    v.fs.rmSync(dir, { recursive: true, force: true });
    v.fs.renameSync(tmp, dir);
    await v.flush();
    assert.deepEqual([...f.files.keys()].sort(), ['u1:memory/restore-undo/c/ledger.json', 'u1:memory/restore-undo/c/meta.json']);
    assert.deepEqual(v.fs.readdirSync(dir), ['ledger.json', 'meta.json']);
    v.fs.rmSync(dir, { recursive: true, force: true });
    await v.flush();
    assert.deepEqual([...f.files.keys()], [], 'removing the tree removes the stored files');
});

test('a failed save is kept and reported by flush, not hidden; the next flush retries', async () => {
    const f = fake();
    const v = mk(f);
    await v.init();
    let fail = true;
    const write = f.api.userStorage.write;
    f.api.userStorage.write = async (...a) => { if (fail) throw new Error('disk full'); return write(...a); };
    v.fs.writeFileSync(`${ROOT}/settings.json`, '{}');
    const first = await v.flush();
    assert.deepEqual(first.failed, ['settings.json']);
    assert.match(first.errors[0], /disk full/);
    fail = false;
    assert.deepEqual((await v.flush()).failed, []);
    assert.equal(f.files.get('u1:memory/settings.json'), '{}');
});

test('run(): a file the handler needed but had not loaded is loaded and the handler runs again; never after it wrote', async () => {
    const f = fake();
    f.files.set('u1:memory/chats/z.json', 'ZZ');
    const v = mk(f);
    let runs = 0;
    const out = await v.run(() => { runs++; try { return v.fs.readFileSync(`${ROOT}/chats/z.json`, 'utf8'); } catch { return 'swallowed'; } });
    assert.equal(out, 'ZZ');
    assert.equal(runs, 2);
    const logs = [];
    const v2 = mk(f, { log: m => logs.push(m) });
    const out2 = await v2.run(() => { v2.fs.writeFileSync(`${ROOT}/q.json`, 'Q'); try { return v2.fs.readFileSync(`${ROOT}/chats/z.json`, 'utf8'); } catch { return 'swallowed'; } });
    assert.equal(out2, 'swallowed', 'a run that wrote is not repeated');
    assert.equal(logs.length, 1);
});

test('stat stamps change with every write (the upstream JSON memo cannot serve a stale value)', async () => {
    const f = fake();
    const v = mk(f);
    await v.init();
    v.fs.writeFileSync(`${ROOT}/a.json`, '1');
    const a = v.fs.statSync(`${ROOT}/a.json`, { bigint: true });
    v.fs.writeFileSync(`${ROOT}/a.json`, '2');
    const b = v.fs.statSync(`${ROOT}/a.json`, { bigint: true });
    assert.notEqual(a.mtimeNs, b.mtimeNs);
    assert.equal(b.isFile(), true);
});

test('two users have separate trees', async () => {
    const f = fake();
    const a = mk(f), b = createVfs({ storage: f.api.userStorage, userId: 'u2', debounceMs: 0 });
    await a.init(); await b.init();
    a.fs.writeFileSync(`${ROOT}/s.json`, 'A'); b.fs.writeFileSync(`${ROOT}/s.json`, 'B');
    await a.flush(); await b.flush();
    assert.equal(f.files.get('u1:memory/s.json'), 'A');
    assert.equal(f.files.get('u2:memory/s.json'), 'B');
});
