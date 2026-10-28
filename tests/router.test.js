import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, normalizePath } from '../src/common/router.js';
import { fake } from './fake.js';

test('normalizePath strips /api/ and parses the query', () => {
    assert.deepEqual(normalizePath('/api/chats/abc/messages?limit=8'), { path: 'chats/abc/messages', query: { limit: '8' } });
    assert.deepEqual(normalizePath('chats/'), { path: 'chats', query: {} });
});

test('static segments beat params, params are decoded, userId is passed to the handler', async () => {
    const r = createRouter();
    r.add('GET', 'chats/:id', ({ params, userId }) => ({ who: 'param', id: params.id, userId }));
    r.add('GET', 'chats/recent', () => ({ who: 'static' }));
    r.add('POST', 'chats/:id/start', ({ params, body }) => ({ started: params.id, body }));
    assert.equal((await r.handle({ method: 'GET', path: 'chats/recent' }, 'u')).who, 'static');
    assert.deepEqual(await r.handle({ method: 'GET', path: 'api/chats/a%20b' }, 'u'), { who: 'param', id: 'a b', userId: 'u' });
    assert.deepEqual(await r.handle({ method: 'POST', path: 'chats/x/start', body: { fresh: true } }, 'u'), { started: 'x', body: { fresh: true } });
});

test('no userId is refused, unknown path is 404', async () => {
    const r = createRouter();
    r.add('GET', 'a', () => 1);
    await assert.rejects(() => r.handle({ method: 'GET', path: 'a' }, ''), /userId required/);
    await assert.rejects(() => r.handle({ method: 'GET', path: 'b' }, 'u'), e => e.status === 404);
});

test('attach: replies over the frontend channel with the same requestId, errors keep their code', async () => {
    const f = fake();
    const r = createRouter();
    r.add('GET', 'ok', () => ({ fine: true }));
    r.add('GET', 'denied', () => { throw Object.assign(new Error('권한 필요'), { code: 'permission' }); });
    r.attach(f.api);
    const ok = await f.rpc('GET', 'ok');
    assert.deepEqual([ok.ok, ok.data], [true, { fine: true }]);
    const bad = await f.rpc('GET', 'denied');
    assert.deepEqual([bad.ok, bad.code], [false, 'permission']);
    // a frame from a non-api message type is ignored
    f.frontendHandler({ requestId: 'x', type: 'other' }, 'u1');
    assert.ok(!f.sent.some(s => s.msg.requestId === 'x'));
    assert.equal(f.sent.at(-1).user, 'u1');
});
