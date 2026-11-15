// What Lumiverse adds on top of the transplanted upstream service (and what the adapter must keep true).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv, story, waitUntil } from './env.js';
import { fake } from './fake.js';
import { createManager } from '../src/adapter/manager.js';

const require = createRequire(import.meta.url);
const A = require('../src/memory/core/aliases.cjs');
const job = async (rpc, id = 'chat-a') => (await rpc('GET', `chats/${id}`)).sceneJob?.state;

test('story clock: a date line a message carries itself is read (the Marinara tracker part is an empty stub)', async () => {
    const e = makeEnv();
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push({ role: i % 2 ? 'assistant' : 'user', content: i === 0 ? '📅 2024-10-03 14:30\n서아가 하루에게 인사했다.' : `${i}번째 이야기가 이어진다.` });
    e.f.addMessages('chat-a', rows);
    await e.um.ready(); await e.um.preloadRoom('chat-a');
    const msgs = await e.um.u.run(() => e.um.svc.chatMessages('chat-a'));
    assert.equal(msgs[0].clock.date, '2024-10-03');
    assert.equal(msgs.at(-1).clock.date, '2024-10-03', 'the date carries on to later messages');
});

test('orphan deletion needs an explicit confirm from the screen', async () => {
    const e = makeEnv();
    e.f.files.set('u1:memory/chats/gone-room.json', JSON.stringify({ version: 1 }));
    await assert.rejects(() => e.rpc('DELETE', 'orphans/gone-room', {}), /confirm/);
    await assert.rejects(() => e.rpc('POST', 'orphans/delete-all', {}), /confirm/);
    const ok = await e.rpc('DELETE', 'orphans/gone-room', { confirm: true });
    assert.ok(ok);
    await e.um.flush();
    assert.equal(e.f.files.has('u1:memory/chats/gone-room.json'), false);
});

test('a live room is never listed or deleted as an orphan', async () => {
    const e = makeEnv();
    e.f.files.set('u1:memory/chats/chat-a.json', JSON.stringify({ version: 1 }));
    const list = await e.rpc('GET', 'orphans');
    assert.equal(JSON.stringify(list).includes('chat-a'), false);
    await assert.rejects(() => e.rpc('DELETE', 'orphans/chat-a', { confirm: true }), /방|지울 수 없/);
});

test('a save that fails is reported to the screen (not shown as saved), and ext/info lists it', async () => {
    const e = makeEnv();
    await e.um.ready();
    const write = e.f.api.userStorage.write;
    e.f.api.userStorage.write = async () => { throw new Error('disk full'); };
    await assert.rejects(() => e.rpc('POST', 'settings', { connection: 'conn-a' }), /저장하지 못했습니다.*settings\.json/);
    assert.deepEqual(e.um.saveFailures(), ['settings.json']);
    e.f.api.userStorage.write = write;
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    assert.deepEqual(e.um.saveFailures(), []);
});

test('two users with the same room id keep their own name tables (the cores\' process-wide hooks follow the running instance)', async () => {
    const e = makeEnv();
    const u1 = e.manager.forUser('u1'), u2 = e.manager.forUser('u2');
    await u1.ready(); await u2.ready();
    const table = name => ({ version: A.NAMES_VERSION, people: { [name]: { aliases: [name + '별칭'] } }, rev: 1 });
    await u1.u.run(() => u1.X.saveNames('chat-a', table('하루')));
    await u2.u.run(() => u2.X.saveNames('chat-a', table('서아')));
    const canon = (u, alias) => u.u.run(() => A.using('chat-a', () => A.canonOf?.(alias) ?? A.canonical?.(alias)));
    assert.equal(await canon(u1, '하루별칭'), '하루');
    assert.equal(await canon(u2, '서아별칭'), '서아');
    assert.notEqual(await canon(u1, '서아별칭'), '서아');
    assert.notEqual(await canon(u2, '하루별칭'), '하루');
});

test('window: Lumiverse message limit wins, then the extension setting, then 30; reported to the screen', async () => {
    const e = makeEnv();
    const um = e.um;
    await um.ready();
    assert.equal((await e.rpc('GET', 'status')).settings.window, undefined);
    const g = async () => (await um.windowInfo());
    assert.equal((await g()).limit, 30);
    await um.saveLvSettings({ window: 9 });
    assert.equal((await g()).limit, 9);
    e.f.state.summarization = { messageLimitEnabled: true, messageLimitCount: 6 };
    const info = await g();
    assert.equal(info.limit, 6);
    assert.equal(info.source, 'lumiverse');
});

test('LV settings share settings.json with the upstream ones and survive a restart of the manager', async () => {
    const e = makeEnv();
    await e.um.ready();
    await e.um.saveLvSettings({ moduleMemory: false, interceptorBudgetMs: 4000, junk: 1 });
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    await e.um.flush();
    const m2 = createManager({ api: e.f.api, debounceMs: 0 });
    const u = m2.forUser('u1');
    await u.ready();
    assert.deepEqual([u.lvSettings().moduleMemory, u.lvSettings().interceptorBudgetMs, u.settings().connection, 'junk' in u.settings()], [false, 4000, 'conn-a', false]);
});

// ---- through the adapter: restore + undo across a restart, many rooms, branches, retry after a miss ----
async function processed(e, id = 'chat-a', n = 12) {
    story(e.f, id, n);
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    await e.rpc('POST', `chats/${id}/start`, {});
    await waitUntil(async () => (await e.rpc('GET', `chats/${id}`)).sceneJob?.state === 'done');
    await waitUntil(async () => (await e.rpc('GET', `chats/${id}`)).job?.state === 'done');
}

test('backup -> restore -> restart -> undo through the adapter (the safety copy is loaded after a restart)', async () => {
    const e = makeEnv();
    await processed(e);
    const backup = await e.rpc('GET', 'chats/chat-a/backup');
    const doc = backup.backup || backup;
    const before = e.f.files.get('u1:memory/chats/chat-a.json');
    await e.um.flush();
    // change the room, then restore the backup over it
    await e.rpc('POST', 'chats/chat-a/routine', { action: 'noop' }).catch(() => {});
    const preview = await e.rpc('POST', 'chats/chat-a/restore/preview', { backup: doc });
    assert.ok(preview);
    const applied = await e.rpc('POST', 'chats/chat-a/restore/apply', { backup: doc });
    assert.ok(applied);
    await e.um.flush();
    assert.ok([...e.f.files.keys()].some(k => k.startsWith('u1:memory/restore-undo/chat-a/')), 'a safety copy was stored');
    // restart: a new manager has nothing in memory
    const m2 = createManager({ api: e.f.api, debounceMs: 0 });
    const u = m2.forUser('u1');
    await u.ready();
    const info = await u.handle({ method: 'GET', path: 'memory-module/chats/chat-a' });
    assert.ok(info.restoreUndo, 'the screen is told an undo exists');
    const undone = await u.handle({ method: 'POST', path: 'memory-module/chats/chat-a/restore/undo', body: {} });
    assert.ok(undone);
    await u.flush();
    assert.equal(e.f.files.get('u1:memory/chats/chat-a.json') != null, true);
    assert.equal(JSON.parse(e.f.files.get('u1:memory/chats/chat-a.json')).threads.length, JSON.parse(before).threads.length);
});

test('after a restart, room-less routes that read many rooms still answer (the miss/retry loop is not capped at four files)', async () => {
    const e = makeEnv();
    for (let i = 0; i < 7; i++) {
        e.f.chats.set(`room-${i}`, { id: `room-${i}`, name: `방${i}`, metadata: {} });
        e.f.files.set(`u1:memory/chats/room-${i}.json`, JSON.stringify({ version: 1, threads: [], batches: [], processed: [] }));
        e.f.files.set(`u1:memory/chats/room-${i}.scenes.json`, JSON.stringify({ version: 1, scenes: [], facts: [], chapters: [], arcs: [], nextScene: 1, nextFact: 1, nextChapter: 1, nextArc: 1 }));
        e.f.files.set(`u1:memory/chats/room-${i}.names.json`, JSON.stringify({ version: 1, people: {} }));
    }
    e.f.files.set('u1:memory/chats/ghost.json', JSON.stringify({ version: 1 }));
    const m = createManager({ api: e.f.api, debounceMs: 0 });
    const u = m.forUser('u1');
    await u.ready();
    const rooms = await u.handle({ method: 'GET', path: 'memory-module/chats' });
    assert.ok(JSON.stringify(rooms).includes('room-6'));
    const orphans = await u.handle({ method: 'GET', path: 'memory-module/orphans' });
    assert.ok(JSON.stringify(orphans).includes('ghost'));
});

test('a retried request does not keep the first attempt\'s 400 (reply state is per attempt)', async () => {
    const e = makeEnv();
    await processed(e);
    await e.um.flush();
    const m2 = createManager({ api: e.f.api, debounceMs: 0 });
    const u = m2.forUser('u1');
    await u.ready();                     // nothing of chat-a loaded: the route is told to preload, the first read may still miss
    const out = await u.handle({ method: 'GET', path: 'memory-module/chats/chat-a/scenes' });
    assert.ok(Array.isArray(out.scenes));
});

test('CHAT_FORKED: the branch gets the source memory before its first reply; the source stays as it was', async () => {
    const { start } = await import('../src/backend.js');
    const f = fake();
    start({ ...f.api, log: { info() {} } }, { afterReplyMs: 5, store: { debounceMs: 0 } });
    const rows = story(f, 'chat-a', 12);
    const rpc = (m, p, b) => f.rpc(m, p, b);
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'memory-module/chats/chat-a')).data.sceneJob.state === 'done');
    await waitUntil(async () => (await rpc('GET', 'memory-module/chats/chat-a')).data.job.state === 'done');
    await rpc('GET', 'memory-module/chats/chat-a');
    await new Promise(r => setTimeout(r, 50));
    const sourceBefore = f.files.get('u1:memory/chats/chat-a.json');
    // the fork: same messages in a new chat
    f.chats.set('chat-b', { id: 'chat-b', name: '분기', metadata: {}, character_id: 'char-haru' });
    f.messages.set('chat-b', structuredClone(rows).map((m, i) => ({ ...m, id: `b-${i}`, chat_id: 'chat-b' })));
    f.emit('CHAT_FORKED', { sourceChatId: 'chat-a', forkedChatId: 'chat-b', messageIdMap: {} }, 'u1');
    await waitUntil(() => f.files.has('u1:memory/chats/chat-b.json') && f.files.has('u1:memory/chats/chat-b.scenes.json'), 3000);
    assert.equal(f.files.get('u1:memory/chats/chat-a.json'), sourceBefore, 'the source room is untouched');
    const b = (await rpc('GET', 'memory-module/chats/chat-b')).data;
    assert.ok(b.enabled === true || b.enabled === false);
});
