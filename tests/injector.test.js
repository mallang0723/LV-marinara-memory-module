import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story, U } from './env.js';
import { promptFor } from './fake.js';
import { createInjector } from '../src/common/injector.js';
import { MEMORY_MARKER } from '../src/memory/service.js';

/** a chat with an up-to-date ledger + scenes, memory on, interceptor ready */
async function ready({ n = 15, tunables = {}, window = 4 } = {}) {
    const env = makeEnv({ tunables: { SCENE_MIN_PENDING: 1, ...tunables } });
    const { f, um, svc } = env;
    await um.ready();
    story(f, 'chat-a', n);
    um.saveSettings({ ...um.settings(), connection: 'conn-a', window });
    um.setChatEnabled('chat-a', true);
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(um.jobStatus('chat-a').state, 'done', um.jobStatus('chat-a').error);
    const injector = createInjector({ service: svc });
    f.api.registerInterceptor(injector.handler, 100);
    const turns = f.messages.get('chat-a').map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.content, id: m.id }));
    return { ...env, injector, turns, prompt: () => promptFor(turns) };
}
const markerCount = list => list.filter(m => String(m.content).includes(MEMORY_MARKER)).length;

test('normal generation: one system message right before the chat history, named in the breakdown', async () => {
    const e = await ready();
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal' });
    const firstHistory = out.messages.findIndex(m => m.__isChatHistory);
    assert.equal(out.messages[firstHistory - 1].role, 'system');
    assert.ok(out.messages[firstHistory - 1].content.startsWith('[Memory:'));
    assert.equal(markerCount(out.messages), 1);
    assert.equal(out.messages.length, e.prompt().length + 1);
    assert.deepEqual(out.breakdown, [{ messageIndex: firstHistory - 1, name: '기억' }]);
    // chat turns untouched and in order
    assert.deepEqual(out.messages.filter(m => m.__isChatHistory).map(m => m.sourceMessageId), e.turns.map(t => t.id));
});

test('quiet and impersonate: the prompt is returned as it was', async () => {
    const e = await ready();
    for (const generationType of ['quiet', 'impersonate']) {
        const out = await e.f.intercept(e.prompt(), { generationType });
        assert.deepEqual(out.messages, e.prompt(), generationType);
    }
});

test('a block that {{memory_ledger}} already put in the preset is replaced, not doubled', async () => {
    const e = await ready();
    const stale = '[Memory: what the characters remember from earlier in this story, old.\nold stuff\n[End of memory. Write the next reply from inside the moment.]';
    const prompt = promptFor(e.turns, { system: ['시스템 규칙', `앞 ${stale} 뒤`] });
    const out = await e.f.intercept(prompt, { generationType: 'normal' });
    assert.equal(markerCount(out.messages), 1);
    assert.ok(!out.messages.some(m => String(m.content).includes('old stuff')));
    assert.equal(out.messages.length, prompt.length, 'no extra message');
    assert.ok(out.messages[1].content.startsWith('앞 [Memory:') && out.messages[1].content.endsWith(' 뒤'));
    assert.equal(out.breakdown[0].name, '기억');
});

test('memory off in this chat: nothing is injected', async () => {
    const e = await ready();
    e.um.setChatEnabled('chat-a', false);
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal' });
    assert.deepEqual(out.messages, e.prompt());
});

test('module switched off in settings: nothing is injected', async () => {
    const e = await ready();
    e.um.saveSettings({ ...e.um.settings(), moduleMemory: false });
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal' });
    assert.deepEqual(out.messages, e.prompt());
});

test('auto-inject off: no new block (a preset macro block would still be refreshed)', async () => {
    const e = await ready();
    e.um.saveSettings({ ...e.um.settings(), autoInject: false });
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal' });
    assert.equal(markerCount(out.messages), 0);
});

test('slow memory model (hangs): the dispatcher is back inside the budget with the fast recall', async () => {
    const e = await ready({ tunables: { RECALL_MIN_MODEL_MS: 30, RECALL_MIN_ABORT_MS: 10 } });
    e.um.saveSettings({ ...e.um.settings(), interceptorBudgetMs: 400, recall: 'model' });
    e.f.state.modelHang = true;                      // what a model slower than the budget looks like
    // a different last turn so the cached recall of the setup is not reused
    e.f.addMessages('chat-a', [{ role: 'user', content: '그때 달빛호수 약속 기억나?' }]);
    const turns = [...e.turns, { role: 'user', content: '그때 달빛호수 약속 기억나?', id: 'new' }];
    const t0 = Date.now();
    const out = await e.f.intercept(promptFor(turns), { generationType: 'normal' });
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, `took ${ms} ms`);
    assert.equal(markerCount(out.messages), 1, 'the memory still went in');
    const entry = e.um.recalls.get('chat-a');
    assert.equal(entry.used, 'fast');
    assert.match(entry.error, /빠른 방식/);
    assert.ok(entry.budgetMs <= 500, `recall budget ${entry.budgetMs}`);
    assert.ok(entry.ms <= 700, `recall took ${entry.ms} ms of a 400 ms budget`);
});

test('the 6 s default budget and its settings override', async () => {
    const e = await ready();
    assert.equal(e.injector.budgetOf(e.um, {}), 6000);
    e.um.saveSettings({ ...e.um.settings(), interceptorBudgetMs: 9000 });
    assert.equal(e.injector.budgetOf(e.um, {}), 9000);
    // the host's own deadline wins when it is shorter (field declared in the types)
    assert.ok(e.injector.budgetOf(e.um, { interceptorDeadlineAt: Date.now() + 3000 }) <= 1600);
});

test('a throwing host (permission revoked) never makes the interceptor throw', async () => {
    const e = await ready();
    e.f.state.denied.push('chat_mutation');
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal' });
    assert.ok(Array.isArray(out.messages));
    assert.ok(out.messages.filter(m => m.__isChatHistory).length === e.turns.length);
    // and a context without a chat id
    const out2 = await e.f.intercept(e.prompt(), { generationType: 'normal', chatId: '' });
    assert.deepEqual(out2.messages, e.prompt());
});

test('regenerate of the newest reply: the ledger needs nothing undone', async () => {
    const e = await ready({ n: 10 });
    const before = structuredClone(e.um.loadLedger('chat-a'));
    const last = e.f.messages.get('chat-a').at(-1);
    await e.f.intercept(e.prompt(), { generationType: 'regenerate', excludeMessageId: last.id });
    const after = e.um.loadLedger('chat-a');
    assert.equal(after.processed.length, before.processed.length);
    assert.ok(!after.needsRebuild);
});

test('swipe on an OLD message: that message and everything after it count as absent', async () => {
    const e = await ready({ n: 9 });
    const before = e.um.loadLedger('chat-a').processed.length;
    const old = e.f.messages.get('chat-a')[3];
    await e.f.intercept(e.prompt(), { generationType: 'swipe', excludeMessageId: old.id });
    const after = e.um.loadLedger('chat-a');
    assert.ok(after.processed.length < before || after.needsRebuild, 'rolled back to before the excluded message');
});

test('dry run (prompt preview): no model call, no write', async () => {
    const e = await ready();
    await e.um.rendered('chat-a');
    const calls = e.f.state.modelCalls.length, files = [...e.f.files.entries()].join('|');
    const out = await e.f.intercept(e.prompt(), { generationType: 'normal', isDryRun: true });
    assert.equal(markerCount(out.messages), 1);
    assert.equal(e.f.state.modelCalls.length, calls);
    assert.equal([...e.f.files.entries()].join('|'), files);
});

test('a second registerInterceptor replaces the first (host rule), the fake host enforces it', async () => {
    const e = await ready({ n: 9 });
    const before = e.f.interceptors.length;
    e.f.api.registerInterceptor(async m => m, 1);
    assert.equal(before, 1);
    assert.equal(e.f.interceptors.length, 1);
});
