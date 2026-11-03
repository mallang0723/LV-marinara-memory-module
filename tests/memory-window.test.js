import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeEnv, story, U } from './env.js';
import { createSummarizationReader, attachSummarizationFrontend } from '../src/common/host-settings.js';
import { createHostAdapter } from '../src/common/host-adapter.js';
import { patchMemory } from '../src/memory/ui/patch.mjs';
import { start } from '../src/backend.js';
import { fake } from './fake.js';
import S from '../src/memory/core/scenes.cjs';

test('window priority: enabled host count, disabled library value, missing default; reads stay fresh', async t => {
    const { f, host, um, logs } = makeEnv();
    t.after(() => host.dispose());
    await um.ready();
    um.saveSettings({ ...um.settings(), window: 12 });
    f.state.summarization = { messageLimitEnabled: true, messageLimitCount: 20 };
    assert.equal(await um.chatWindow(), 20);
    assert.equal((await um.chatWindowInfo()).source, 'lumiverse');
    f.state.summarization.messageLimitCount = 25;
    assert.equal(await um.chatWindow(), 25);
    f.state.summarization.messageLimitEnabled = false;
    assert.equal(await um.chatWindow(), 12);
    assert.equal((await um.chatWindowInfo()).source, 'library');
    f.state.summarization = null;
    assert.equal(await um.chatWindow(), 12, 'unavailable host still honors an explicit library value');
    um.saveSettings({ ...um.settings(), window: undefined });
    assert.equal(await um.chatWindow(), 30);
    assert.equal((await um.chatWindowInfo()).source, 'default');
    assert.equal(logs.filter(x => x.includes('메시지 제한을 읽지 못해')).length, 1);
    f.state.summarization = { messageLimitEnabled: true, messageLimitCount: 7 };
    assert.equal(await um.chatWindow(), 7, 'later recovery is read without a restart');
});

test('zero, negative, nonnumeric and nonfinite host limits fall back', async t => {
    const { f, host, um } = makeEnv();
    t.after(() => host.dispose());
    for (const count of [0, -2, 2.5, '20', null, Infinity, NaN]) {
        f.state.summarization = { messageLimitEnabled: true, messageLimitCount: count };
        assert.equal(await um.chatWindow(), 30);
    }
});

test('each folding job and reply boundary follows the host; new user text reserves one message', async t => {
    const { f, host, um } = makeEnv({ tunables: { SCENE_MIN_PENDING: 1 } });
    t.after(() => host.dispose());
    await um.ready();
    story(f, 'chat-a', 51);
    um.saveSettings({ ...um.settings(), connection: 'conn-a', window: 4, recall: 'fast' });
    f.state.summarization = { messageLimitEnabled: true, messageLimitCount: 20 };
    await um.processChat('chat-a', { rebuild: true });
    assert.equal(um.jobStatus('chat-a').state, 'done');
    assert.equal(um.loadScenes('chat-a').window.size, 20);
    const view = await um.chatMessages('chat-a');
    await um.syncBeforeReply('chat-a', { userMessage: '새 메시지' });
    assert.equal(um.windows.get('chat-a'), S.firstInsideWindow(view, 19));
    const firstKey = um.recalls.get('chat-a')?.key;
    f.state.summarization.messageLimitCount = 10;
    await um.processScenes('chat-a');
    assert.equal(um.loadScenes('chat-a').window.size, 10);
    await um.syncBeforeReply('chat-a');
    assert.equal(um.windows.get('chat-a'), S.firstInsideWindow(view, 10));
    assert.notEqual(um.recalls.get('chat-a')?.key, firstKey);
});

test('frontend reads only the authenticated setting; denied/missing response falls back without throwing', async t => {
    let backendHandler, frontendHandler, status = 200;
    const calls = [], logs = [];
    const api = {
        onFrontendMessage(fn) { backendHandler = fn; return () => {}; },
        sendToFrontend(msg, userId) { assert.equal(userId, U); void frontendHandler(msg); },
    };
    const host = createHostAdapter(api, { log: x => logs.push(x) });
    const off = attachSummarizationFrontend({
        onBackendMessage(fn) { frontendHandler = fn; return () => {}; },
        sendToBackend(msg) { backendHandler(msg, U); },
    }, { fetch: async (url, init) => {
        calls.push({ url, init });
        return { ok: status === 200, json: async () => ({ value: { messageLimitEnabled: true, messageLimitCount: 20, unrelated: 'not forwarded' } }) };
    } });
    t.after(() => { off(); host.dispose(); });
    assert.equal(await host.contextMessageLimit(U), 20);
    for (status of [403, 404, 500]) assert.equal(await host.contextMessageLimit(U), null);
    assert.equal(logs.length, 1);
    assert.ok(calls.every(c => c.url === '/api/v1/settings/summarization' && c.init.credentials === 'same-origin' && c.init.cache === 'no-store'));
    await assert.rejects(() => host.contextMessageLimit(''), /userId required/);
});

test('bridge isolates users, ignores unsolicited/stale replies, coalesces concurrent reads and times out', async t => {
    let receive;
    const sent = [];
    const reader = createSummarizationReader({
        onFrontendMessage(fn) { receive = fn; return () => {}; },
        sendToFrontend(msg, user) { sent.push({ msg, user }); },
    }, { timeoutMs: 20 });
    t.after(() => reader.dispose());
    const a = reader.read('a'), again = reader.read('a'), b = reader.read('b');
    assert.equal(a, again);
    const value = { messageLimitEnabled: true, messageLimitCount: 9 };
    receive({ type: 'memory-summarization-result', id: sent[0].msg.id, ok: true, value }, 'b');
    receive({ type: 'memory-summarization-result', id: 'stale', ok: true, value }, 'a');
    receive({ type: 'memory-summarization-result', id: sent[0].msg.id, ok: true, value }, 'a');
    assert.deepEqual(await a, value);
    assert.equal(await b, null, 'disconnected frontend falls back within the bounded wait');
    const next = reader.read('a');
    reader.dispose();
    assert.equal(await next, null);
});

test('status and extension settings expose the effective value; actual library settings HTML labels its source', async t => {
    const f = fake();
    const stop = start(f.api, { store: { debounceMs: 0 } });
    t.after(stop);
    f.state.summarization = { messageLimitEnabled: true, messageLimitCount: 20 };
    await f.rpc('POST', 'ext/settings', { window: 12 });
    const settings = (await f.rpc('GET', 'memory-module/status')).data.settings;
    assert.deepEqual(settings.windowInfo, { size: 20, source: 'lumiverse', label: '루미버스 메시지 제한 20 사용 중' });
    assert.deepEqual((await f.rpc('GET', 'ext/settings')).data.windowInfo, settings.windowInfo);
    const read = name => readFileSync(new URL(`../src/memory/ui/${name}`, import.meta.url), 'utf8');
    const runtime = patchMemory({ runtime: read('runtime.orig.js'), uiCss: '', themeCss: '', version: 'test' })
        .replace('export function mountMemory', 'function mountMemory')
        .replace('  install();\n  host.onCleanup?.(cleanup);', '  return value => { serverSettings = value; info = {}; return viewSettings(); };');
    const render = vm.runInNewContext(runtime + '\nmountMemory({}, {});', {});
    const html = render(settings);
    assert.match(html, /루미버스 메시지 제한 20 사용 중/);
    assert.match(html, /루미버스 메시지 제한이 꺼져 있을 때만 적용/);
    assert.match(html, /id="setWindow"[^>]*value="12"/);
    f.state.summarization.messageLimitEnabled = false;
    assert.match(render((await f.rpc('GET', 'memory-module/status')).data.settings), /기억 서재 창 설정 12 사용 중/);
    await f.rpc('POST', 'ext/settings', { window: null });
    f.state.summarization = null;
    assert.match(render((await f.rpc('GET', 'memory-module/status')).data.settings), /기본 창 크기 30 사용 중/);
});
