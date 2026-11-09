import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fake, promptFor } from './fake.js';
import { start, MACRO_NAME, COMMANDS } from '../src/backend.js';
import { story, waitUntil } from './env.js';

const boot = (opts = {}, fakeOpts) => {
    const f = fake(fakeOpts);
    const logs = [];
    const stop = start({ ...f.api, log: { info: m => logs.push(m) } }, { afterReplyMs: 5, store: { debounceMs: 0 }, tunables: { SCENE_MIN_PENDING: 1 }, ...opts });
    return { f, stop, logs, rpc: (m, p, b) => f.rpc(m, p, b) };
};

test('start registers one interceptor, the macro, the commands and the frontend channel', async () => {
    const { f } = boot();
    assert.equal(f.interceptors.length, 1);
    assert.ok(f.macros.has(MACRO_NAME));
    assert.equal(f.macros.get(MACRO_NAME).name, 'memory_ledger');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(MACRO_NAME), 'macro lexer only knows [a-zA-Z0-9_-] (src/macros/MacroLexer.ts:136)');
    assert.deepEqual(f.commands.list.map(c => c.id), ['open-memory', 'memory-continue', 'memory-toggle']);
    assert.ok(f.commands.list.length <= 20);
    for (const c of COMMANDS) { assert.ok(c.label.length <= 80 && c.description.length <= 200 && (c.keywords || []).length <= 10); }
    assert.ok(f.frontendHandler);
});

test('the macro answers from the cache only (empty for an unknown chat, text after a job)', async () => {
    const { f, rpc } = boot();
    story(f, 'chat-a', 15);
    await f.rpc('POST', 'ext/settings', { window: 4 });
    const macro = f.macros.get(MACRO_NAME).handler;
    assert.equal(macro({ userId: 'u1', chatId: 'chat-a' }), '');
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'memory-module/chats/chat-a')).data.sceneJob.state === 'done');
    await waitUntil(() => macro({ userId: 'u1', chatId: 'chat-a' }) !== '');
    assert.ok(macro({ userId: 'u1', chatId: 'chat-a' }).startsWith('[Memory:'));
    assert.ok(macro({ userId: 'u1', env: { chat: { id: 'chat-a' } } }).startsWith('[Memory:'), 'ctx.env.chat.id form');
    assert.ok(!macro({ userId: 'u1', chatId: 'chat-a' }).includes('{{'));
    assert.equal(macro({ userId: 'u1', chatId: 'other' }), '');
});

test('GENERATION_ENDED without error updates the ledger of an enabled chat; with error, impersonate and disabled chats it does not', async () => {
    const { f, rpc } = boot();
    story(f, 'chat-a', 9);
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/enable');
    const calls = () => f.state.modelCalls.length;
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-a', error: 'boom' }, 'u1');
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-a', generationType: 'impersonate' }, 'u1');
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-b' }, 'u1');
    await new Promise(r => setTimeout(r, 60));
    assert.equal(calls(), 0);
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-a', generationType: 'normal' }, 'u1');
    await waitUntil(() => calls() > 0);
    await waitUntil(() => f.files.has('u1:memory/chats/chat-a.json'));
    // an event without a user id (cannot be routed) is ignored
    const before = calls();
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-a' }, undefined);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(calls(), before);
});

test('the memory module switched off in settings: GENERATION_ENDED does nothing', async () => {
    const { f, rpc } = boot();
    story(f, 'chat-a', 9);
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/enable');
    await f.rpc('POST', 'ext/settings', { moduleMemory: false });
    f.emit('GENERATION_ENDED', { generationId: 'g', chatId: 'chat-a' }, 'u1');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(f.state.modelCalls.length, 0);
});

test('permission granted later: the interceptor and the generation event are wired then', async () => {
    const f = fake({ denied: ['interceptor', 'generation'] });
    start({ ...f.api, log: { info() {} } }, { afterReplyMs: 5, store: { debounceMs: 0 } });
    assert.equal(f.interceptors.length, 0);
    f.state.denied.splice(0, 2);
    f.api._onPerm({ permission: 'interceptor', granted: true, allGranted: [] });
    assert.equal(f.interceptors.length, 1);
    assert.ok((f.handlers.get('GENERATION_ENDED')?.size || 0) === 1);
    // wiring again does not double up
    f.api._onPerm({ permission: 'generation', granted: true, allGranted: [] });
    assert.equal(f.interceptors.length, 1);
    assert.equal(f.handlers.get('GENERATION_ENDED').size, 1);
});

test('Ctrl+K: the backend only forwards the command (+chat id) to the frontends', async () => {
    const { f } = boot();
    await f.invokeCommand('open-memory', { chatId: 'chat-a' });
    const msg = f.sent.at(-1);
    assert.deepEqual(msg.msg, { event: 'command', id: 'open-memory', chatId: 'chat-a' });
    assert.equal(msg.user, undefined);
});

test('ext/settings: module switches and the interceptor budget are saved per user', async () => {
    const { f } = boot();
    const r = await f.rpc('POST', 'ext/settings', { interceptorBudgetMs: 8000, moduleMemory: false, junk: 1 });
    assert.deepEqual(r.data.settings, { moduleMemory: false, interceptorBudgetMs: 8000 });
    const g = (await f.rpc('GET', 'ext/settings')).data;
    assert.deepEqual([g.moduleMemory, g.autoInject, g.interceptorBudgetMs], [false, true, 8000]);
    const other = (await f.rpc('GET', 'ext/settings', undefined, 'u2')).data;
    assert.equal(other.moduleMemory, true, 'per user');
});

test('the disposer removes everything and flushes writes', async () => {
    const { f, stop } = boot({ store: { debounceMs: 60000 } });
    await f.rpc('POST', 'ext/settings', { window: 6 });
    await stop();
    assert.equal(f.interceptors.length, 0);
    assert.equal(f.macros.size, 0);
    assert.equal(f.frontendHandler, null);
    assert.ok(f.files.has('u1:memory/settings.json'));
});

test('dist/backend.js passes the host\'s static scan for forbidden worker capabilities', () => {
    if (!existsSync(new URL('../dist/backend.js', import.meta.url))) return;
    const src = readFileSync(new URL('../dist/backend.js', import.meta.url), 'utf8');
    // regexes copied from src/spindle/manager.service.ts:105-144 (detectDangerousBackendCapabilities)
    const checks = [
        /(?:from\s*["'`](?:node:)?fs(?:\/promises)?["'`]|require\s*\(\s*["'`](?:node:)?fs(?:\/promises)?["'`]\s*\)|import\s*\(\s*["'`](?:node:)?fs(?:\/promises)?["'`]\s*\))/,
        /(?:from\s*["'`](?:node:)?child_process["'`]|require\s*\(\s*["'`](?:node:)?child_process["'`]\s*\))/,
        /(?:from\s*["'`](?:node:)?(?:net|tls|dgram|http|https)["'`]|require\s*\(\s*["'`](?:node:)?(?:net|tls|dgram|http|https)["'`]\s*\))/,
        /(?:from\s*["'`](?:node:)?(?:worker_threads|cluster)["'`]|require\s*\(\s*["'`](?:node:)?(?:worker_threads|cluster)["'`]\s*\))/,
        /\bBun\.(?:file|write|spawn|spawnSync|serve|connect|listen)\b/,
        /\bprocess\.(?:env|exit|kill|chdir|dlopen)\b/,
        /(?<![.\w$])fetch\s*(?:\?\.\s*)?\(|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*fetch\b|(?<![.\w$])fetch\s*\.\s*(?:call|apply|bind)\s*\(/,
        /(?:from\s*["'`](?:node-fetch|undici|cross-fetch)["'`])/,
        /(?:from\s*["'`]bun["'`]|import\s*["'`]bun["'`])/,
    ];
    for (const re of checks) assert.ok(!re.test(src), `dist/backend.js matches ${re}`);
});

test('a macro context without user identity returns no room data; the interceptor fills or removes its placeholder per user', async () => {
    const { f, rpc, stop } = boot();
    story(f, 'chat-a', 15);
    await rpc('POST', 'ext/settings', { window: 4, autoInject: false });
    await rpc('POST', 'memory-module/settings', { connection: 'conn-a' });
    await rpc('POST', 'memory-module/chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'memory-module/chats/chat-a')).data.sceneJob.state === 'done');
    const placeholder = f.macros.get(MACRO_NAME).handler({ chatId: 'chat-a' });
    assert.doesNotMatch(placeholder, /달빛호수|서아|하루/);
    const prompt = [{ role: 'system', content: '앞\n' + placeholder + '\n뒤' }];
    const own = await f.intercept(prompt, { userId: 'u1', isDryRun: true });
    assert.match(own.messages[0].content, /달빛호수/); assert.equal(own.messages.length, 1);
    const other = await f.intercept(prompt, { userId: 'u2', isDryRun: true });
    assert.equal(other.messages[0].content, '앞\n\n뒤');
    assert.equal(f.macros.get(MACRO_NAME).handler({ userId: 'u2', chatId: 'chat-a' }), '');
    await stop();
});
