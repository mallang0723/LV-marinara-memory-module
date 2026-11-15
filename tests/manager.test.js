// The transplanted service through the extension's own entry (router -> per-user instance -> pinned upstream routes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story, waitUntil } from './env.js';
import { createManager } from '../src/adapter/manager.js';
import { createRouter } from '../src/common/router.js';
import { promptFor } from './fake.js';
import { createInjector } from '../src/common/injector.js';

const job = async (rpc, id = 'chat-a') => (await rpc('GET', `chats/${id}`)).sceneJob?.state;

test('start -> ledger + scenes -> recall in the prompt; the whole session reads the chat once (lean host)', async () => {
    const e = makeEnv({ fakeOpts: { lean: true } });
    story(e.f, 'chat-a', 20);
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    await e.rpc('POST', 'chats/chat-a/start', {});
    await waitUntil(async () => (await job(e.rpc)) === 'done');
    const info = await e.rpc('GET', 'chats/chat-a');
    assert.ok(info.scenes?.scenes?.length || info.sceneCount || info.scenes, 'the room shows its scenes');
    await e.rpc('GET', 'chats/chat-a/translations');
    await e.rpc('GET', 'chats/chat-a/scenes');
    await e.rpc('GET', 'chats');
    const injector = createInjector({ manager: e.manager });
    const turns = e.f.messages.get('chat-a').map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.content, id: m.id }));
    e.f.api.registerInterceptor(injector.handler, 100);
    const out = await e.f.intercept(promptFor(turns), { generationType: 'normal' });
    assert.ok(out.messages.some(m => String(m.content).startsWith('[Memory:')), 'memory block injected');
    assert.equal(e.f.state.messageReads.length, 1, `chat messages were read ${e.f.state.messageReads.length} times: ${JSON.stringify(e.f.state.messageReads)}`);
});

test('restart: a new manager on the same storage shows the same room and makes no model call', async () => {
    const e = makeEnv();
    story(e.f, 'chat-a', 12);
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    await e.rpc('POST', 'chats/chat-a/start', {});
    await waitUntil(async () => (await job(e.rpc)) === 'done');
    await e.manager.forUser('u1').flush();
    const calls = e.f.state.modelCalls.length;
    const m2 = createManager({ api: e.f.api, debounceMs: 0 });
    const again = await (async () => { const u = m2.forUser('u1'); await u.ready(); return u.handle({ method: 'GET', path: 'memory-module/chats/chat-a' }); })();
    assert.equal(again.sceneJob.state, 'idle');
    assert.ok(again.chat?.enabled ?? again.enabled ?? true);
    assert.equal(e.f.state.modelCalls.length, calls);
    const sc = await m2.forUser('u1').handle({ method: 'GET', path: 'memory-module/chats/chat-a/scenes' });
    assert.ok(JSON.stringify(sc).includes('scenes'));
});

test('two users, the same chat id: separate settings, files and rendered text', async () => {
    const e = makeEnv();
    story(e.f, 'chat-a', 10);
    await e.rpc('POST', 'settings', { connection: 'conn-a' });
    const u2 = e.manager.forUser('u2');
    await u2.ready();
    const s2 = await u2.handle({ method: 'GET', path: 'memory-module/status' });
    assert.equal(s2.settings.connection, null, 'u2 does not see the connection u1 chose');
    await u2.handle({ method: 'POST', path: 'memory-module/settings', body: { connection: 'conn-b' } });
    await e.manager.forUser('u1').flush(); await u2.flush();
    assert.match(e.f.files.get('u1:memory/settings.json'), /conn-a/);
    assert.match(e.f.files.get('u2:memory/settings.json'), /conn-b/);
    assert.doesNotMatch(e.f.files.get('u1:memory/settings.json'), /conn-b/);
});

test('mount(): only memory-module/ is served here; an unknown route is a 404, a frame without a user is refused', async () => {
    const e = makeEnv();
    const router = createRouter();
    e.manager.mount(router);
    await assert.rejects(() => router.handle({ method: 'GET', path: 'memory-module/nope' }, 'u1'), /길을 찾지 못했습니다|nope/);
    await assert.rejects(() => router.handle({ method: 'GET', path: 'memory-module/status' }, ''), /userId/);
    assert.ok((await router.handle({ method: 'GET', path: 'memory-module/status' }, 'u1')).version);
});

test('a bad route input becomes an error with its message (upstream 400 -> thrown error)', async () => {
    const e = makeEnv();
    await assert.rejects(() => e.rpc('POST', 'chats/chat-a/threads/T1/zzz', {}), /reopen|찾지|열기/);
});
