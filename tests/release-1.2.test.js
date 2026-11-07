import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { makeEnv } from './env.js';
import { createMemoryService } from '../src/memory/service.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
import S from '../src/memory/core/scenes.generated.cjs';
import L from '../src/memory/core/ledger.cjs';
import A from '../src/memory/core/aliases.cjs';
const require = createRequire(import.meta.url);
async function setup() {
    const env = makeEnv(); await env.um.ensureChat('room');
    const handlers = new Map();
    registerMemoryRoutes({ add(m, p, h) { handlers.set(`${m} ${p}`, h); } }, env.svc);
    const call = (method, path, body, params = { id: 'room' }, userId = env.U) => handlers.get(`${method} memory-module/${path}`)({ userId, params, body, query: {} });
    return { ...env, call };
}

test('old bilingual quotes repair without a model, survive restart, and language polls reuse the room file', async () => {
    const { um, f, host, store, U, call } = await setup();
    f.addMessages('room', [{ role: 'assistant', name: '아델', content: '아델이 비토에게 말했다.\n"Hello, Vito." (안녕, 비토.)' }]);
    const messages = await um.chatMessages('room');
    const st = S.emptyStore(); st.covered = messages.map(({ id, h }) => ({ id, h }));
    st.scenes.push({ id: 'S1', start: 1, end: 1, messages: st.covered, present: ['아델', '비토'], events: [{ text: '인사', quotes: [{ messageId: messages[0].id, number: 1, sentence: 2, by: '아델', to: '비토', text: '"Hello, Vito." (안녕, 비토.)' }] }], recollections: [] });
    um.saveScenes('room', st);
    await call('POST', 'chats/:id/attribution-check', { mode: 'rules' });
    f.model = () => { throw Error('no model expected'); };
    await um.processScenes('room', { reason: 'resume' });
    assert.equal(um.sceneJobs.get('room').state, 'done', um.sceneJobs.get('room').error);
    assert.equal(f.state.modelCalls.length, 0);
    const q = um.loadScenes('room').scenes[0].events[0].quotes[0];
    assert.ok(q.translation); assert.doesNotMatch(q.text, /안녕/); assert.match(S.quoteText(q), /안녕/);
    await um.flush();
    const fresh = createMemoryService({ host, store }).forUser(U); await fresh.ensureChat('room');
    assert.deepEqual(fresh.loadScenes('room').scenes[0].events[0].quotes[0], q);
    f.api.chat.getMessages = () => { throw Error('poll must reuse language'); };
    assert.equal(await fresh.chatLanguage('room'), 'ko');
    assert.ok(f.files.has(`${U}:memory/chats/room.lang.json`));
});

test('honorific routes persist; aliases and address providers stay isolated across users with the same room id', async () => {
    const { um, svc, f, call, U, host, store } = await setup();
    const other = svc.forUser('u2'); await other.ensureChat('room');
    const one = A.emptyTable(), two = A.emptyTable();
    A.addPerson(one, '아델', ['애칭']); A.addPerson(two, '비토', ['애칭']);
    um.roomData.save('room', 'names', one); other.roomData.save('room', 'names', two);
    const values = await Promise.all([um, other].map(user => user.roomData.using('room', async () => { await Promise.resolve(); return A.canonOf('애칭'); })));
    assert.deepEqual(values, ['아델', '비토']);
    const result = await call('POST', 'chats/:id/address', { action: 'add', entry: { from: '아델', to: '비토', term: 'Tesoro' } });
    assert.equal(result.entries.length, 1);
    assert.equal((await call('GET', 'chats/:id/address', null, { id: 'room' }, 'u2')).entries.length, 0);
    const fresh = createMemoryService({ host, store }).forUser(U); await fresh.ensureChat('room');
    assert.equal(fresh.roomData.get('room', 'address').entries[0].term, 'Tesoro');
    assert.equal(fresh.roomData.using('room', () => A.canonOf('애칭')), '아델');
    assert.ok(f.files.has(`${U}:memory/chats/room.address.json`));
});

test('recent-life off preserves existing data, removes it from prompts, and records skipped messages', async () => {
    const { um, f, call } = await setup();
    f.addMessages('room', [{ role: 'user', content: '서아가 빵을 먹었다.' }, { role: 'assistant', content: '하루가 웃었다.' }]);
    const ledger = L.emptyLedger();
    ledger.routine = [{ who: '서아', what: 'meal', text: '보존할 식사', number: 0, at: '2026-01-01T08:00' }];
    um.saveLedger('room', ledger); um.saveSettings({ connection: 'conn-a', chats: { room: { enabled: true } } });
    await call('POST', 'chats/:id/routine-mode', { mode: 'off' });
    f.model = async ({ messages }) => { assert.doesNotMatch(messages[0].content, /생활 기록\(routine\)/); return '{"open":[],"routine":[{"who":"서아","what":"meal","text":"새 식사","evidence":[{"n":"1.1"}]}]}'; };
    await um.processChat('room');
    assert.equal(um.jobStatus('room').state, 'done', um.jobStatus('room').error);
    assert.equal(um.loadLedger('room').routine[0].text, '보존할 식사');
    assert.deepEqual(um.loadLedger('room').routineGaps, [{ from: 1, to: 1 }]);
    assert.doesNotMatch(um.renderMemorySource('room'), /보존할 식사/);
    await call('POST', 'chats/:id/routine-mode', { mode: 'on' });
    assert.equal(um.loadLedger('room').routine[0].text, '보존할 식사');
});

test('room polls omit large threads/check histories, and deferred feature requests are refused', async () => {
    const { um, call } = await setup();
    const ledger = L.emptyLedger(); ledger.threads = [{ id: 'T1', status: 'open', kind: 'promise', clues: [], evidence: [{ text: 'x'.repeat(100000) }] }];
    um.saveLedger('room', ledger);
    um.roomData.save('room', 'attribution-log', { version: 1, runs: [{ entries: [{ text: 'y'.repeat(100000) }] }] });
    const info = await call('GET', 'chats/:id');
    assert.ok(JSON.stringify(info).length < 10000);
    assert.equal('threads' in info, false); assert.equal(info.threadStats.open, 1); assert.equal(info.attributionRuns, 1);
    assert.equal((await call('GET', 'chats/:id/threads')).threads[0].evidence[0].text.length, 100000);
    assert.equal((await call('GET', 'chats/:id/attribution-log')).runs.length, 1);
    assert.deepEqual(info.features.map(f => f.key), ['recentLife', 'autoApply']);
    await assert.rejects(call('POST', 'chats/:id/feature-mode', { key: 'places', mode: 'on' }), /1.3/);
});

test('the patched UI renders supported settings without deferred controls or competing window handlers', () => {
    const patched = require('./upstream-ui.cjs')();
    const source = patched.replace('export function mountMemory', 'function mountMemory').replace('  install();\n  host.onCleanup?.(cleanup);', `
        info = { features: [], scenes: {}, health: {} }; connections = []; room = 'room'; armed = 'fresh';
        return { settings: viewSettings(), home: viewHome(), nav: NAV, marks: markButtons('S1', {}), geometry: applyPanelGeometry.toString() };
    `);
    const out = vm.runInNewContext(source + '\nmountMemory({}, {});', {});
    assert.ok(out.nav.some(([id]) => id === 'names')); assert.ok(!out.nav.some(([id]) => id === 'world'));
    assert.match(out.settings, /대사 확인 방식/);
    assert.doesNotMatch(out.settings, /data-act="(?:backupDownload|restoreApply|restoreUndo|resetPanel)"/);
    assert.doesNotMatch(out.home, /data-act="backupDownload"/);
    assert.equal(out.marks, '');
    assert.match(out.geometry, /return; \/\/ Lumiverse owns/);
    assert.doesNotMatch(patched, /^    (?:installSelectionButton|setupPanelMove)\(\);/m);
});

test('a source edit during speaker checking discards the model answer and stops later scene writes', async () => {
    const { um, f } = await setup();
    const raw = '하담 | "Tommaso, vieni qui."\n그는 걸음을 멈췄다.\n"Signor Rossi, mi perdoni!"\n홀 안이 조용해졌다.\nTommaso lowered his head.';
    const rows = f.addMessages('room', [{ role: 'assistant', content: raw }]);
    const messages = await um.chatMessages('room'), m = messages[0];
    const sentence = m.sentences.findIndex(s => s.includes('mi perdoni')) + 1;
    const st = S.emptyStore(); st.covered = messages.map(({ id, h }) => ({ id, h }));
    st.personas = ['하담']; st.cast = ['Tommaso', 'Rossi'];
    st.scenes.push({ id: 'S1', start: 1, end: 1, messages: st.covered, present: ['하담', 'Tommaso', 'Rossi'], events: [{ text: '사과', quotes: [{ messageId: m.id, number: 1, sentence, text: '"Signor Rossi, mi perdoni!"', by: null, to: null }] }], recollections: [] });
    um.saveScenes('room', st); um.saveSettings({ connection: 'conn-a', chats: {} });
    f.model = async ({ messages: prompt }) => {
        rows[0].content = '이전 이야기를 고쳤다.'; rows[0].swipes[0] = rows[0].content;
        return JSON.stringify({ items: JSON.parse(prompt[1].content).items.map(x => ({ id: x.id, by: 'Tommaso', to: ['Rossi'], byEvidence: 'Tommaso lowered his head.', toEvidence: '"Signor Rossi, mi perdoni!"' })) });
    };
    await um.processScenes('room', { reason: 'resume' });
    assert.equal(um.sceneJobs.get('room').state, 'error');
    assert.match(um.sceneJobs.get('room').error, /원문이 바뀌/);
    assert.equal(um.loadScenes('room').scenes[0].events[0].quotes[0].by, null);
    assert.match(um.roomData.get('room', 'attribution-log').runs[0].notes.join(' '), /답을 저장하지/);
});
