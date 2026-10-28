import test from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './fake.js';
import { start } from '../src/backend.js';
import { ROUTES, PREFIX } from '../src/memory/routes.js';
import { story, waitUntil } from './env.js';

const boot = async (opts = {}) => {
    const f = fake();
    const logs = [];
    const stop = start({ ...f.api, log: { info: m => logs.push(m) } }, { afterReplyMs: 5, store: { debounceMs: 0 }, tunables: { SCENE_MIN_PENDING: 1 }, ...opts });
    story(f, 'chat-a', 15);
    await f.rpc('POST', 'ext/settings', { window: 4 });
    const rpc = async (method, path, body) => { const r = await f.rpc(method, PREFIX + path, body); return r; };
    return { f, stop, rpc, logs };
};

test('all 30 routes of the original module are registered under memory-module/', async () => {
    assert.equal(ROUTES.length, 30);
    const { f } = await boot();
    // an unknown route is 404, the 30 known ones are not
    const miss = await f.rpc('GET', 'memory-module/nope');
    assert.equal(miss.ok, false); assert.equal(miss.status, 404);
    const fine = await Promise.all(ROUTES.map(async ([method, pattern]) => {
        const path = pattern.replace(':id', 'chat-a').replace(':tid', 'T1').replace(':action', 'close').replace(':sceneId', 'S1').replace(':chapterId', 'C1').replace(':arcId', 'A1').replace(':factId', 'F1');
        const r = await f.rpc(method, PREFIX + path, {});
        return [method + ' ' + pattern, r.status !== 404 || /찾지 못했습니다\)$/.test(r.error || '') === false];
    }));
    for (const [name, ok] of fine) assert.ok(ok, `${name} is routed`);
});

test('GET chats/:id has every field the screen reads', async () => {
    const { rpc } = await boot();
    const r = await rpc('GET', 'chats/chat-a');
    assert.equal(r.ok, true, r.error);
    for (const k of ['enabled', 'job', 'sceneJob', 'routine', 'routineItems', 'storyNow', 'personas', 'cast', 'vectors', 'recall', 'summary', 'scenes', 'threads', 'storyDate', 'deadlines', 'lastNumber', 'rendered', 'version', 'health']) assert.ok(k in r.data, `field ${k}`);
    assert.equal(r.data.enabled, false);
    assert.equal(r.data.scenes.count, 0);
});

test('settings are saved on the spot: connection by id or name, bad names refused', async () => {
    const { rpc, f } = await boot();
    const bad = await rpc('POST', 'settings', { connection: '없는 연결' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /찾지 못했습니다.*연결 A/);
    const ok = await rpc('POST', 'settings', { connection: '연결 B' });
    assert.deepEqual(ok.data.connection, { id: 'conn-b', name: '연결 B', model: 'm-b' });
    assert.equal(JSON.parse(f.files.get('u1:memory/settings.json')).connection, 'conn-b', 'written without waiting for the debounce');
    for (const [path, body, key] of [['settings/recall', { mode: 'fast' }, 'recall'], ['settings/recall-style', { style: 'active' }, 'recallStyle'], ['settings/recall-amount', { amount: 'more' }, 'recallAmount'], ['settings/chapter-length', { length: 'long' }, 'chapterLength']]) {
        assert.equal((await rpc('POST', path, body)).ok, true, path);
        assert.equal((await rpc('POST', path, { mode: 'x', style: 'x', amount: 'x', length: 'x' })).ok, false, path + ' rejects junk');
    }
});

test('start -> ledger + scenes done, enabled, then GET chats/:id shows them and the rendered text', async () => {
    const { rpc, f } = await boot();
    await rpc('POST', 'settings', { connection: 'conn-a' });
    await rpc('POST', 'settings/recall', { mode: 'fast' });
    const s = await rpc('POST', 'chats/chat-a/start', {});
    assert.deepEqual(s.data, { started: true, fresh: true });
    await waitUntil(async () => (await rpc('GET', 'chats/chat-a')).data.sceneJob.state === 'done');
    const r = (await rpc('GET', 'chats/chat-a')).data;
    assert.equal(r.enabled, true);
    assert.ok(r.summary.processed >= 14);
    assert.ok(r.threads.length >= 1);
    assert.ok(r.rendered.startsWith('[Memory:'));
    const scenes = (await rpc('GET', 'chats/chat-a/scenes')).data;
    assert.ok(scenes.scenes.length >= 1);
    const list = (await rpc('GET', 'chats')).data;
    assert.equal(list.find(c => c.id === 'chat-a').enabled, true);
    assert.equal(list.find(c => c.id === 'chat-a').mode, 'roleplay');
});

test('hand edits: thread close/reopen/edit, fact edit/delete, scene edit', async () => {
    const { rpc } = await boot();
    await rpc('POST', 'settings', { connection: 'conn-a' });
    await rpc('POST', 'chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'chats/chat-a')).data.sceneJob.state === 'done');
    const info = (await rpc('GET', 'chats/chat-a')).data;
    const t = info.threads[0];
    assert.equal((await rpc('POST', `chats/chat-a/threads/${t.id}/close`, { how: '풀림' })).ok, true);
    assert.equal((await rpc('GET', 'chats/chat-a')).data.threads[0].status, 'closed');
    assert.equal((await rpc('POST', `chats/chat-a/threads/${t.id}/reopen`, {})).ok, true);
    assert.equal((await rpc('POST', `chats/chat-a/threads/${t.id}/edit`, { title: '고친 제목', dueDate: '24-10-20' })).ok, true);
    assert.equal((await rpc('GET', 'chats/chat-a')).data.threads[0].title, '고친 제목');
    assert.equal((await rpc('POST', `chats/chat-a/threads/${t.id}/nope`, {})).ok, false);
    const scenes = (await rpc('GET', 'chats/chat-a/scenes')).data;
    const sc = scenes.scenes[0];
    const edited = await rpc('PATCH', `chats/chat-a/scenes/${sc.id}`, { title: '고친 장면' });
    assert.equal(edited.data.title, '고친 장면');
    assert.equal(edited.data.edited, true);
    const fact = scenes.facts[0];
    assert.equal((await rpc('PATCH', `chats/chat-a/facts/${fact.id}`, { text: '고친 사실' })).ok, true);
    assert.equal((await rpc('DELETE', `chats/chat-a/facts/${fact.id}`)).data.deleted, true);
    assert.equal((await rpc('DELETE', `chats/chat-a/facts/${fact.id}`)).ok, false);
});

test('enable / disable / stop / estimate / status / scene-error / trial / recall-test answer', async () => {
    const { rpc } = await boot();
    assert.equal((await rpc('POST', 'chats/chat-a/enable')).data.enabled, true);
    assert.equal((await rpc('POST', 'chats/chat-a/disable')).data.enabled, false);
    assert.deepEqual((await rpc('POST', 'chats/chat-a/stop')).data, { stopping: false });
    const est = (await rpc('POST', 'chats/chat-a/estimate')).data;
    assert.equal(est.messages, 15);
    const st = (await rpc('GET', 'status')).data;
    assert.equal(st.version, '0.2.0-lv.1'); assert.ok(st.embedding && st.health);
    assert.deepEqual((await rpc('GET', 'chats/chat-a/scene-error')).data, { text: null });
    assert.deepEqual((await rpc('GET', 'chats/chat-a/trial')).data, { state: 'none' });
    assert.equal((await rpc('POST', 'chats/chat-a/trial', { from: 5, to: 2 })).ok, false);
    assert.equal((await rpc('POST', 'chats/chat-a/recall-test', { text: '' })).ok, false);
    assert.equal((await rpc('POST', 'chats/chat-a/speaker-tags', { on: true })).data.speakerTags, false);
});

test('trial: a slice is read on a throwaway ledger, nothing saved to the chat', async () => {
    const { rpc, f } = await boot();
    await rpc('POST', 'settings', { connection: 'conn-a' });
    const t = await rpc('POST', 'chats/chat-a/trial', { from: 1, to: 6 });
    assert.equal(t.data.started, true);
    await waitUntil(async () => (await rpc('GET', 'chats/chat-a/trial')).data.state === 'done');
    const res = (await rpc('GET', 'chats/chat-a/trial')).data;
    assert.ok(res.result.threads.length >= 1);
    assert.ok(![...f.files.keys()].some(k => k.endsWith('chat-a.json')));
});

test('search / recall-test use meaning search once scenes are indexed', async () => {
    const { rpc } = await boot();
    await rpc('POST', 'settings', { connection: 'conn-a' });
    await rpc('POST', 'settings/recall', { mode: 'fast' });
    await rpc('POST', 'chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'chats/chat-a')).data.sceneJob.state === 'done');
    const s = await rpc('POST', 'chats/chat-a/search', { queries: [{ query: '달빛호수 약속' }], scope: 'side-b' });
    assert.equal(s.ok, true, s.error);
    assert.equal(s.data.state, 'ok');
    assert.ok(s.data.results[0].hits.length >= 1);
    assert.equal((await rpc('POST', 'chats/chat-a/search', { queries: [] })).ok, false);
    const r = await rpc('POST', 'chats/chat-a/recall-test', { text: '달빛호수 약속 기억나?' });
    assert.equal(r.ok, true, r.error);
    assert.ok('picks' in r.data && 'candidates' in r.data);
});

test('settings/embedding: connection mode checks the connection, an unknown one is rolled back with a Korean error', async () => {
    const { rpc } = await boot();
    const ok = await rpc('POST', 'settings/embedding', { mode: 'connection' });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.data.model, 'fake-embed');
    const bad = await rpc('POST', 'settings/embedding', { mode: 'manual', model: '없는 임베딩' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /임베딩을 쓰지 못했습니다/);
    assert.equal((await rpc('GET', 'status')).data.settings.embedding.source, 'connection', 'rolled back');
    assert.equal((await rpc('POST', 'settings/embedding', { mode: 'off' })).data.mode, 'off');
    assert.equal((await rpc('GET', 'status')).data.embedding.mode, 'off');
});

test('without the embeddings permission meaning search is off with a hint (no crash)', async () => {
    const { rpc, f } = await boot();
    f.state.denied.push('embeddings');
    const bad = await rpc('POST', 'settings/embedding', { mode: 'connection' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /embeddings|임베딩/);
});

test('the routes refuse a frame without a user id', async () => {
    const { f } = await boot();
    const before = f.sent.length;
    f.frontendHandler({ requestId: 'x1', type: 'api', method: 'GET', path: 'memory-module/status' }, '', 's');
    await new Promise(r => setTimeout(r, 10));
    const reply = f.sent.slice(before).find(s => s.msg.requestId === 'x1').msg;
    assert.equal(reply.ok, false);
    assert.match(reply.error, /userId required/);
});

test('host route the memory screen uses: connections (the others are not served)', async () => {
    const { f } = await boot();
    const g = (m, p, b) => f.rpc(m, p, b);
    assert.equal((await g('GET', 'connections')).data.length, 2);
    for (const path of ['chats', 'lorebooks', 'characters/char-haru', 'generate/raw', 'anon-memory/chats/chat-a', 'anon/storage']) assert.equal((await g(path.startsWith('generate') ? 'POST' : 'GET', path, {})).ok, false, path);
});
