import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story } from './env.js';
import { promptFor } from './fake.js';
import { createInjector } from '../src/common/injector.js';
import { createMeter, costOf } from '../src/common/meter.js';
import { fake } from './fake.js';

async function ready(fakeOpts = {}) {
    const env = makeEnv({ fakeOpts });
    const { f, um } = env;
    await um.ready();
    story(f, 'chat-a', 15);
    um.saveSettings({ ...um.settings(), connection: 'conn-a', window: 4 });
    um.setChatEnabled('chat-a', true);
    const injector = createInjector({ manager: env.svc });
    f.api.registerInterceptor(injector.handler, 100);
    const turns = f.messages.get('chat-a').map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.content, id: m.id }));
    return { ...env, injector, turns };
}
const words = t => t.split(/\s+/).filter(Boolean).length;

test('injection: the meter counts exactly the injected block (host tokenizer, main model), prompt unchanged', async () => {
    const e = await ready();
    await e.um.processChat('chat-a', { rebuild: true });
    const prompt = promptFor(e.turns);
    const out = await e.f.intercept(prompt, { generationType: 'normal' });
    const block = out.messages.find(m => String(m.content).startsWith('[Memory:')).content;
    await e.um.meter.idle();
    const m = await e.um.meter.get('chat-a');
    assert.equal(m.last.chars, block.length);
    assert.equal(m.last.tokens, words(block));
    assert.equal(m.last.approximate, false);
    assert.equal(m.last.tokenizer, 'fake-tok');
    const call = e.f.state.tokenCalls.find(c => c.len === block.length);
    assert.ok(call && call.o.modelSource === 'main');
    // the prompt is exactly what it was before the meter: the block is its own message right before the history, nothing else changed
    assert.equal(out.messages.length, prompt.length + 1);
    assert.deepEqual(out.messages.filter(x => x.content !== block), prompt);
    assert.equal(JSON.stringify(m).includes(block.slice(0, 30)), false, 'no text in the numbers');
});

test('injection: a host that falls back is shown as approximate; no tokens API at all is approximate too', async () => {
    const e = await ready();
    await e.um.processChat('chat-a', { rebuild: true });
    e.f.state.tokensApprox = true;
    await e.f.intercept(promptFor(e.turns), { generationType: 'normal' });
    await e.um.meter.idle();
    assert.equal((await e.um.meter.get('chat-a')).last.approximate, true);
    const e2 = await ready({ noTokens: true });
    await e2.um.processChat('chat-a', { rebuild: true });
    const out = await e2.f.intercept(promptFor(e2.turns), { generationType: 'normal' });
    await e2.um.meter.idle();
    const last = (await e2.um.meter.get('chat-a')).last;
    assert.equal(last.approximate, true);
    assert.equal(last.tokens, Math.ceil(last.chars / 4));
    assert.ok(out.messages.some(m => String(m.content).startsWith('[Memory:')));
});

test('model calls: the host usage is recorded as it came (estimated 0); cost from provider_raw', async () => {
    const e = await ready();
    e.f.usage = () => ({ prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, provider_raw: { cost: 0.01 } });
    await e.um.processChat('chat-a', { rebuild: true });
    await e.um.meter.idle();
    const m = await e.um.meter.get('chat-a');
    const calls = e.f.state.modelCalls.length;
    assert.ok(calls > 0);
    assert.equal(m.total.n, m.calls.organize.n + m.calls.recall.n + m.calls.check.n + m.calls.embed.n);
    assert.equal(m.calls.organize.n + m.calls.check.n, calls, 'every quiet call is counted (organize or check)');
    assert.equal(m.calls.organize.input + m.calls.check.input, 1000 * calls);
    assert.equal(m.calls.organize.output + m.calls.check.output, 200 * calls);
    assert.equal(m.total.estimated - m.calls.embed.estimated, 0);
    assert.ok(Math.abs(m.calls.organize.cost + m.calls.check.cost - 0.01 * calls) < 1e-9);
});

test('model calls: without usage the prompt and answer are counted with the host helper and marked estimated', async () => {
    const e = await ready();
    await e.um.processChat('chat-a', { rebuild: true });
    await e.um.meter.idle();
    const m = await e.um.meter.get('chat-a');
    const first = e.f.state.modelCalls[0];
    assert.ok(m.calls.organize.n > 0);
    assert.equal(m.calls.organize.estimated, m.calls.organize.n);
    assert.ok(m.calls.organize.input > 0 && m.calls.organize.output > 0);
    const prompt = first.messages.map(x => x.content).join('\n');
    assert.ok(e.f.state.tokenCalls.some(c => c.len === prompt.length && c.o.modelSource === 'main'));
    assert.equal(JSON.stringify(await e.um.meter.get('chat-a')).includes('달빛호수'), false);
});

test('embeddings are counted as estimates (the host returns no usage)', async () => {
    const e = await ready();
    const { inRoom } = await import('../src/common/meter.js');
    const provider = e.um.u.eng.engine.createLLMProvider('fake', '', '', 0, false, 0, 0, 0, {}, 'conn-a');
    await inRoom.run({ chatId: 'chat-a' }, () => provider.embed(['안녕 하세요', '둘째 글'], 'fake-embed'));
    await e.um.meter.idle();
    const c = (await e.um.meter.get('chat-a')).calls.embed;
    assert.equal(c.n, 1); assert.equal(c.estimated, 1); assert.equal(c.input, 4); assert.equal(c.output, 0);
    // outside a room nothing is recorded
    await provider.embed(['x'], 'fake-embed'); await e.um.meter.idle();
    assert.equal((await e.um.meter.get('chat-a')).calls.embed.n, 1);
});

test('recall and check calls are told apart from 정리', async () => {
    const f = fake(); const meter = createMeter({ api: f.api, userId: 'u1', debounceMs: 0 });
    await meter.recordCall('r', 'recall', { usage: { prompt_tokens: 5, completion_tokens: 1 } });
    await meter.recordCall('r', 'check', { usage: { prompt_tokens: 7, completion_tokens: 2 } });
    const m = await meter.get('r');
    assert.deepEqual([m.calls.recall.n, m.calls.check.n, m.calls.organize.n], [1, 1, 0]);
    assert.equal(m.total.input, 12);
    assert.equal(costOf({ provider_raw: { usage: { cost: 0.5 } } }), 0.5);
    assert.equal(costOf({}), null);
});

test('totals persist across restarts (extension storage, numbers only) and reset clears the room only', async () => {
    const f = fake();
    const a = createMeter({ api: f.api, userId: 'u1', debounceMs: 0 });
    await a.recordCall('room1', 'organize', { usage: { prompt_tokens: 10, completion_tokens: 3 } });
    await a.recordCall('room2', 'organize', { usage: { prompt_tokens: 1, completion_tokens: 1 } });
    await a.recordInjection('room1', 'hello world memory', {});
    await a.flush();
    const raw = [...f.files.entries()].find(([k]) => k.startsWith('u1:meter/'));
    assert.ok(raw && !/hello world/.test(raw[1]), 'no text in storage');
    const b = createMeter({ api: f.api, userId: 'u1', debounceMs: 0 });
    const m = await b.get('room1');
    assert.equal(m.calls.organize.input, 10);
    assert.equal(m.last.chars, 'hello world memory'.length);
    const other = createMeter({ api: f.api, userId: 'u2', debounceMs: 0 });
    assert.equal((await other.get('room1')).total.n, 0, 'per user');
    const r = await b.reset('room1');
    assert.equal(r.total.n, 0);
    assert.equal((await b.get('room2')).total.n, 1);
    assert.equal((await createMeter({ api: f.api, userId: 'u1' }).get('room1')).total.n, 0, 'reset is persisted');
});

test('routes: the screen reads the room meter after a real room run and resets it', async () => {
    const { start } = await import('../src/backend.js');
    const { waitUntil } = await import('./env.js');
    const f = fake();
    const stop = start({ ...f.api, log: { info: () => {} } }, { afterReplyMs: 5, store: { debounceMs: 0 }, tunables: { SCENE_MIN_PENDING: 1 } });
    story(f, 'chat-a', 15);
    f.usage = () => ({ prompt_tokens: 4, completion_tokens: 1 });
    await f.rpc('POST', 'ext/settings', { window: 4 });
    await f.rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await f.rpc('POST', 'memory-module/chats/chat-a/start', {});
    await waitUntil(async () => (await f.rpc('GET', 'memory-module/chats/chat-a')).data.sceneJob.state === 'done');
    const got = (await f.rpc('GET', 'ext/meter/chat-a')).data;
    assert.ok(got.total.n > 0 && got.calls.organize.input >= 4);
    const cleared = (await f.rpc('POST', 'ext/meter/chat-a/reset', {})).data;
    assert.equal(cleared.total.n, 0);
    assert.equal((await f.rpc('GET', 'ext/meter/chat-a')).data.total.n, 0);
    await stop();
});
