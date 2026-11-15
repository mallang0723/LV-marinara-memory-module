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
