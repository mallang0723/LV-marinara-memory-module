// The `anon_memory_lv.rendered` channel: what the anonymous community gets must equal `enabled` / `rendered` of the upstream route
// GET memory-module/chats/:id (the route the original anonymous community read), scoped to the user who owns the chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story, waitUntil } from './env.js';
import { createReference, ENDPOINT, REQUIRES } from '../src/adapter/reference.js';
import { start } from '../src/backend.js';
import { fake } from './fake.js';

const ASK = { endpoint: 'anon_memory_lv.rendered', requesterExtensionId: 'anon_community_lv', effectivePermissions: REQUIRES };
const request = (f, over = {}) => f.rpcPool.peers.set('anon_community_lv.mem-req', { v: 1, nonce: 'n1', userId: 'u1', chatId: 'chat-a', ...over });
const mk = env => createReference({ api: env.f.api, manager: env.manager, host: env.manager.host });

test('same enabled and rendered as the upstream route (a room with a real ledger text), through the published handler', async () => {
    const f = fake();
    const stop = start(f.api, { afterReplyMs: 5, store: { debounceMs: 0 }, tunables: { SCENE_MIN_PENDING: 1 } });
    const rpc = (m, p, b) => f.rpc(m, p, b);
    story(f, 'chat-a', 15);
    await rpc('POST', 'ext/settings', { window: 4 });
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'memory-module/chats/chat-a')).data.sceneJob.state === 'done');
    const upstream = (await rpc('GET', 'memory-module/chats/chat-a')).data;
    request(f);
    const out = await f.rpcPool.handlers.get(ENDPOINT).fn(ASK);
    assert.equal(out.state, 'ok');
    assert.ok(out.rendered.length > 0, 'the fixture really has a ledger text');
    assert.equal(out.enabled, upstream.enabled);
    assert.equal(out.rendered, upstream.rendered);
    assert.equal(out.nonce, 'n1');
    await stop();
});

test('a room with memory off answers disabled, no text; master switch off answers absent', async () => {
    const env = makeEnv();
    story(env.f, 'chat-a', 3);
    request(env.f);
    const ref = mk(env);
    const off = await ref.answer(ASK);
    assert.deepEqual([off.state, off.enabled, off.rendered], ['disabled', false, '']);
    const upstream = await env.rpc('GET', 'chats/chat-a');
    assert.equal(upstream.enabled, false);
    env.inst.saveLvSettings({ moduleMemory: false });
    assert.equal((await ref.answer(ASK)).state, 'absent');
});

test('refuses: unknown requester, bad request, a chat that is not the user\'s, no user shape', async () => {
    const env = makeEnv();
    story(env.f, 'chat-a', 3);
    const ref = mk(env);
    request(env.f);
    await assert.rejects(ref.answer({ ...ASK, requesterExtensionId: 'someone_else' }), /not allowed/);
    request(env.f, { v: 2 });
    await assert.rejects(ref.answer(ASK), /bad request/);
    request(env.f, { chatId: 'chat-nope' });
    await assert.rejects(ref.answer(ASK), /채팅을 찾지 못했습니다/);
    env.f.rpcPool.peers.delete('anon_community_lv.mem-req');
    await assert.rejects(ref.answer(ASK));
    assert.equal(env.manager.users.size, 1, 'no per-user instance is made for a refused request');
});

test('start() publishes the endpoint with explicit permissions and the disposer removes it', async () => {
    const f = fake();
    const stop = start(f.api, { afterReplyMs: 5, store: { debounceMs: 0 } });
    const h = f.rpcPool.handlers.get(ENDPOINT);
    assert.ok(h);
    assert.deepEqual(h.policy, { requires: ['chats', 'chat_mutation'] });
    await stop();
    assert.ok(!f.rpcPool.handlers.has(ENDPOINT));
});

test('a host without rpcPool.handle keeps working (no endpoint, no error)', () => {
    const f = fake({ noRpcPool: true });
    const stop = start(f.api, { afterReplyMs: 5, store: { debounceMs: 0 } });
    assert.ok(stop);
});
