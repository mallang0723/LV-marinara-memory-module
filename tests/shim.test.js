import test from 'node:test';
import assert from 'node:assert/strict';
import { uid, responseLike, createLink, createFetch, createMarinara } from '../src/shim/marinara.js';
import { fake } from './fake.js';
import { start } from '../src/backend.js';

function bridge() {
    const f = fake({ onSend: (m) => setTimeout(() => toFrontend?.(m), 1) });
    let toFrontend = null;
    start({ ...f.api, log: { info() {} } }, { store: { debounceMs: 0 }, afterReplyMs: 5 });
    const ctx = { sendToBackend: m => setTimeout(() => f.frontendHandler(JSON.parse(JSON.stringify(m)), 'u1', 'sess'), 1), onBackendMessage: fn => { toFrontend = fn; return () => { toFrontend = null; }; } };
    return { f, ctx };
}

test('uid works on a plain-http origin (no randomUUID, no crypto at all) and is unique', () => {
    const c = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
        for (const fake of [{}, { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } }, undefined]) {
            Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
            const ids = new Set(Array.from({ length: 50 }, () => uid()));
            assert.equal(ids.size, fake?.getRandomValues ? 1 : 50, 'fixed random source gives one id, fallback gives distinct ones');
            assert.ok([...ids].every(x => typeof x === 'string' && x.length >= 20));
        }
        Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'x'.repeat(36) }, configurable: true, writable: true });
        assert.equal(uid(), 'x'.repeat(36));
    } finally { if (c) Object.defineProperty(globalThis, 'crypto', c); }
});

test('apiFetch: ok replies, errors with status, permission -> 403, never throws for backend errors', async () => {
    const { ctx } = bridge();
    const { marinara } = createMarinara(createLink(ctx));
    const ok = await marinara.apiFetch('connections', { method: 'GET' });
    assert.equal(ok.ok, true);
    assert.equal((await ok.json()).length, 2);
    const nf = await marinara.apiFetch('nope/at/all');
    assert.equal(nf.status, 404);
    assert.match((await nf.json()).error, /길을 찾지 못했습니다/);
    const post = await marinara.apiFetch('memory-module/chats/chat-a/enable', { method: 'POST', body: '{}' });
    assert.deepEqual(await post.json(), { enabled: true });
});

test('apiFetch for a denied permission is a 403 with code permission; the fallback fetch is closed', async () => {
    const { ctx, f } = bridge();
    f.state.denied.push('generation');
    const { marinara } = createMarinara(createLink(ctx));
    const r = await marinara.apiFetch('connections');
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'permission');
    await assert.rejects(() => marinara.fetch('/api/connections'), /network disabled/);
});

test('a timeout rejects the request and a dead channel rejects pending ones', async () => {
    const ctx = { sendToBackend() {}, onBackendMessage: () => () => {} };
    const link = createLink(ctx, { timeoutMs: 20 });
    await assert.rejects(() => link.request('GET', 'x'), e => e.timeout);
    const link2 = createLink(ctx, { timeoutMs: 10_000 });
    const p = link2.request('GET', 'x');
    link2.dispose();
    await assert.rejects(p, /종료/);
    const r = await createFetch(createLink(ctx, { timeoutMs: 10 }))('x');
    assert.equal(r.status, 503);
});

test('abort signal ends a pending request with AbortError', async () => {
    const ctx = { sendToBackend() {}, onBackendMessage: () => () => {} };
    const link = createLink(ctx);
    const ctl = new AbortController();
    const p = createFetch(link)('generate/raw', { method: 'POST', body: '{}', signal: ctl.signal });
    ctl.abort();
    await assert.rejects(p, e => e.name === 'AbortError');
});

test('events (no requestId) go to listeners, replies only to their request', async () => {
    let push;
    const ctx = { sendToBackend() {}, onBackendMessage: fn => { push = fn; return () => {}; } };
    const link = createLink(ctx);
    const got = [];
    link.onEvent(m => got.push(m));
    push({ event: 'command', id: 'open-memory' });
    push({ requestId: 'unknown', ok: true });
    assert.deepEqual(got, [{ event: 'command', id: 'open-memory' }]);
});

test('responseLike clone/json/text', async () => {
    const r = responseLike(200, { a: 1 });
    assert.deepEqual(await r.clone().json(), { a: 1 });
    assert.equal(await r.text(), '{"a":1}');
    assert.equal(responseLike(204).status, 204);
});
