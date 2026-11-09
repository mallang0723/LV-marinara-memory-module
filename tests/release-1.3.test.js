import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './env.js';
import { createRouter } from '../src/common/router.js';
import { createMemoryService } from '../src/memory/service.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
import { FEATURE_ROUTES } from '../src/memory/room-features.js';
import { BACKUP_ROUTES } from '../src/memory/room-backup.js';
import L from '../src/memory/core/ledger.cjs';
import S from '../src/memory/core/scenes.generated.cjs';
import B from '../src/memory/core/backup.generated.cjs';

async function setup() {
    const env = makeEnv(); await env.um.ensureChat('chat-a');
    const router = createRouter(); registerMemoryRoutes(router, env.svc);
    const call = (method, path, body = {}, user = 'u1') => router.handle({ method, path: 'memory-module/' + path, body }, user);
    const room = (method, path, body, user) => call(method, 'chats/chat-a' + (path ? '/' + path : ''), body, user);
    return { ...env, router, call, room };
}
function scene(id, end, extra = {}) {
    return { id, start: end, end, title: id, summary: `${id} 이야기`, time: '2026-11-01', place: '도서관', present: ['하루'], events: [], recollections: [], messages: [], ...extra };
}
async function seed(e) {
    e.um.saveSettings({ connection: 'conn-a', recall: 'off', embedding: null, chats: { 'chat-a': { enabled: true, features: { characterState: 'on', places: 'on', keepsakes: 'on', trackers: 'on', autoApply: 'off' } } } });
    const st = S.emptyStore(); st.cast = ['하루'];
    st.scenes = [scene('S1', 1, { title: '비밀 열쇠', summary: '하루는 비밀 열쇠를 받았다.', state: [{ who: '하루', location: '도서관', outfit: '파란 옷', evidence: [{ number: 1, sentence: 1 }] }], placeNotes: [{ place: '도서관', description: '오래된 서가', evidence: [{ number: 1, sentence: 1 }] }], keepsakes: [{ name: '열쇠', owner: '하루', from: '서아', meaning: '우정', status: 'kept', evidence: [{ number: 1, sentence: 1 }] }] }), scene('S2', 2, { title: '현재', state: [{ who: '하루', location: '집', outfit: '흰 옷', evidence: [{ number: 2, sentence: 1 }] }] })];
    st.facts = [{ id: 'F1', about: '하루', text: '하루는 커피를 즐겨 마신다', sceneId: 'S1', evidence: [] }, { id: 'F2', about: '하루', text: '하루는 커피를 즐겨 마시지 않는다', sceneId: 'S2', evidence: [] }];
    const ledger = L.emptyLedger(); ledger.storyDate = '2026-11-02';
    ledger.threads = [{ id: 'T1', kind: 'promise', status: 'open', title: '독서 약속', detail: '책을 읽기로 했다', evidence: [], clues: [] }];
    e.um.saveLedger('chat-a', ledger); e.um.saveScenes('chat-a', st); await e.um.flush();
    return st;
}

test('all 20 new contracts require an authenticated user and chat routes authorize before storage or messages', async () => {
    const e = await setup();
    for (const [method, pattern] of [...FEATURE_ROUTES, ...BACKUP_ROUTES]) {
        const path = pattern.replace(':id', 'chat-a').replace(':cid', 'CF1').replace(':memoryId', 'x');
        await assert.rejects(e.call(method, path, {}, ''), /userId required/, pattern);
        if (pattern.startsWith('chats/')) {
            const get = e.f.api.chats.get;
            e.f.api.chats.get = async (id, user) => user === 'u2' ? null : get(id, user);
            await assert.rejects(e.call(method, path, {}, 'u2'), /채팅을 찾지/, pattern);
        }
    }
    assert.equal(e.f.state.modelCalls.length, 0);
    assert.equal([...e.f.files.keys()].some(k => k.startsWith('u2:')), false);
});

test('world routes: switches, manual locks, unlocking, updates and reconciled reply state', async () => {
    const e = await setup();
    await assert.rejects(e.room('POST', 'state', { action: 'add', name: '하루' }), /먼저 켜/);
    const st = await seed(e);
    let world = await e.room('GET', 'world');
    assert.equal(world.cards[0].outfit, '흰 옷');
    assert.equal(world.placeList.length, 1); assert.equal(world.keepList.length, 1);
    await e.room('POST', 'state', { action: 'set', name: '하루', field: 'outfit', value: '손으로 고친 옷' });
    await e.room('POST', 'places', { action: 'set', id: world.placeList[0].id, field: 'description', value: '직접 쓴 장소' });
    await e.room('POST', 'keepsakes', { action: 'set', id: world.keepList[0].id, field: 'meaning', value: '직접 쓴 의미' });
    e.um.saveScenes('chat-a', { ...st, scenes: [st.scenes[0]] });
    world = await e.room('GET', 'world');
    assert.equal(world.cards[0].outfit, '손으로 고친 옷');
    assert.equal(world.placeList[0].description, '직접 쓴 장소');
    assert.equal(world.keepList[0].meaning, '직접 쓴 의미');
    world = await e.room('POST', 'state', { action: 'unlock', name: '하루', field: 'outfit' });
    assert.equal(world.cards[0].outfit, '파란 옷');
    assert.match(e.um.renderMemorySource('chat-a'), /파란 옷/); assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /흰 옷/);
    await e.room('POST', 'feature-mode', { key: 'characterState', mode: 'off' });
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /파란 옷/);
    assert.equal(e.um.roomData.get('chat-a', 'state').cards[0].outfit, '파란 옷', 'off is not deletion');
    assert.equal(e.f.state.modelCalls.length, 0);
});

test('conflict decisions persist, exclude only the rejected fact, reopen, and survive merges', async () => {
    const e = await setup(); const st = await seed(e);
    const view = await e.room('GET', 'conflicts'); assert.equal(view.open, 1);
    const c = view.conflicts[0];
    await e.room('POST', `conflicts/${c.id}`, { action: 'keepA' });
    assert.match(e.um.renderMemorySource('chat-a'), /커피를 즐겨 마신다/);
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /커피를 즐겨 마시지 않는다/);
    e.um.saveScenes('chat-a', structuredClone(st));
    assert.equal((await e.room('GET', 'conflicts')).conflicts[0].status, 'keepA');
    await e.room('POST', `conflicts/${c.id}`, { action: 'reopen' });
    assert.match(e.um.renderMemorySource('chat-a'), /커피를 즐겨 마시지 않는다/);
    await e.room('POST', `conflicts/${c.id}`, { action: 'keepB' });
    const merged = structuredClone(st); merged.facts[1].replacedBy = 'F3'; merged.facts.push({ ...merged.facts[1], id: 'F3', replacedBy: undefined });
    e.um.saveScenes('chat-a', merged);
    const record = (await e.room('GET', 'conflicts')).conflicts.find(x => x.status === 'keepB');
    assert.ok(record); assert.equal(e.um.loadScenes('chat-a').facts.length, 3);
    await assert.rejects(e.room('POST', `conflicts/${c.id}`, { action: 'invalid' }));
});

test('recall marks filter overview, raw and semantic recall, trace only emitted items, follow fact merges without calls', async () => {
    const e = await setup(); const st = await seed(e);
    e.um.windows.set('chat-a', 10);
    e.um.recalls.set('chat-a', { picks: [{ id: 'S1' }], semantic: [{ id: 'S1', score: .9 }], raw: [{ number: 1, content: '비밀 열쇠', hits: ['열쇠'] }] });
    await e.room('POST', 'recall-prefs', { id: 'S1', action: 'exclude' });
    e.um.recalls.set('chat-a', { picks: [{ id: 'S1' }], semantic: [{ id: 'S1', score: .9 }], raw: [{ number: 1, text: '비밀 열쇠', hits: ['열쇠'] }] });
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /비밀 열쇠/);
    assert.ok(!e.um.recallCandidates('chat-a', st, 10).some(s => s.id === 'S1'));
    await e.room('POST', 'recall-prefs', { id: 'T1', action: 'exclude' });
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /독서 약속/);
    await e.room('POST', 'recall-prefs', { id: 'F1', action: 'pin' });
    const merged = structuredClone(st); merged.facts[0].replacedBy = 'F3'; merged.facts.push({ ...merged.facts[0], id: 'F3', replacedBy: undefined }); e.um.saveScenes('chat-a', merged);
    assert.ok(e.um.features.preferences('chat-a').pinned.includes('F3'));
    const before = e.um.renderMemorySource('chat-a'), report = await e.room('GET', 'recall-report');
    assert.equal(e.um.renderMemorySource('chat-a'), before);
    assert.ok(report.marks.some(m => m.id === 'S1' && m.state === 'excluded'));
    assert.ok(report.sections.flatMap(s => s.items).every(i => i.id !== 'S1' && i.id !== 'T1'));
    assert.equal(e.f.state.modelCalls.length, 0);
    await assert.rejects(e.room('POST', 'recall-prefs', { id: 'F99', action: 'pin' }));
});

test('trackers routes: add, from scene, edit history, delete and exact automatic suggestion undo', async () => {
    const e = await setup(); await seed(e);
    let view = await e.room('POST', 'trackers', { action: 'add', item: { type: 'cycle', label: '하루 휴가', scope: 'person', people: ['하루'], cycle: { every: 30, length: 5, starts: ['2026-10-01'] } } });
    const id = view.items[0].id;
    view = await e.room('POST', 'trackers', { action: 'fromScene', id, sceneId: 'S1' });
    assert.ok(view.items[0].cycle.starts.includes('2026-11-01'));
    await e.room('POST', 'trackers', { action: 'editStart', id, from: '2026-11-01', to: '2026-11-02' });
    await e.room('POST', 'trackers', { action: 'removeStart', id, date: '2026-11-02' });
    await e.room('POST', 'feature-mode', { key: 'autoApply', mode: 'on' });
    const st = structuredClone(e.um.loadScenes('chat-a')); st.scenes[1].summary = '하루의 휴가가 시작되었다.'; st.scenes[1].time = '2026-11-03'; e.um.saveScenes('chat-a', st);
    view = await e.room('GET', 'trackers');
    assert.equal(view.applied.length, 1);
    view = await e.room('POST', 'trackers', { action: 'undoApplied', aid: view.applied[0].id });
    assert.ok(!view.items[0].cycle.starts.includes('2026-11-03'));
    e.um.saveScenes('chat-a', st); assert.equal((await e.room('GET', 'trackers')).applied.filter(a => !a.undone).length, 0);
    view = await e.room('POST', 'trackers', { action: 'delete', id }); assert.equal(view.items.length, 0);
});

test('selected memory verifies source IDs/text before and after generation, deduplicates and stops injecting stale sources', async () => {
    const e = await setup(); await seed(e);
    const rows = e.f.addMessages('chat-a', [{ id: 'selected-source', role: 'user', content: '하루가 비밀 편지를 건넸다.' }]);
    const parts = [{ sourceId: rows[0].id, text: '비밀 편지를 건넸다.' }];
    e.f.model = () => JSON.stringify({ title: '비밀 편지', summary: '하루가 편지를 전달했다.' });
    await assert.rejects(e.room('POST', 'selected-memory', { parts: [{ sourceId: 'invented', text: '편지' }] }));
    await assert.rejects(e.room('POST', 'selected-memory', { parts: [{ sourceId: rows[0].id, text: '조작된 원문' }] }));
    assert.equal(e.f.state.modelCalls.length, 0);
    const result = await e.room('POST', 'selected-memory', { parts });
    assert.equal((await e.room('POST', 'selected-memory', { parts })).duplicate, true);
    assert.equal(e.f.state.modelCalls.length, 1);
    assert.equal((await e.room('GET', 'selected-memories')).items[0].stale, false);
    await e.um.recallBeforeReply('chat-a', await e.um.chatMessages('chat-a'), '비밀 편지');
    assert.match(e.um.renderMemorySource('chat-a'), /직접 선택해 정리한 기억/);
    rows[0].content = '원문을 수정했다.';
    assert.equal((await e.room('GET', 'selected-memories')).items[0].stale, true);
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /직접 선택해 정리한 기억/);
    await e.room('DELETE', `selected-memory/${result.memory.id}`);
    assert.equal((await e.room('GET', 'selected-memories')).items.length, 0);
    e.f.model = () => { rows[0].content = '모델 응답 중 편집'; return JSON.stringify({ title: '제목', summary: '내용' }); };
    await assert.rejects(e.room('POST', 'selected-memory', { parts: [{ sourceId: rows[0].id, text: '원문을 수정했다.' }] }), /정리 중 원문/);
    assert.equal((await e.room('GET', 'selected-memories')).items.length, 0);
});

test('backup/preview/apply/undo replace files and settings, preserve enabled state and survive restart', async () => {
    const e = await setup(); await seed(e);
    const original = (await e.room('GET', 'backup')).backup; B.validate(original);
    const imported = structuredClone(original); imported.header.chatId = 'other-room'; imported.files.scenes.scenes[0].title = '불러온 제목'; delete imported.files.state; delete imported.header.fileHashes.state;
    imported.header.fileHashes.scenes = B.hashOf(imported.files.scenes); imported.settings.enabled = false;
    const preview = await e.room('POST', 'restore/preview', { backup: imported });
    assert.equal(preview.crossRoomRequired, true); assert.ok(preview.removes.includes('state'));
    await assert.rejects(e.room('POST', 'restore/apply', { backup: imported }), /다른 방/);
    await e.room('POST', 'restore/apply', { backup: imported, crossRoom: true });
    assert.equal(e.um.loadScenes('chat-a').scenes[0].title, '불러온 제목'); assert.equal(e.um.chatEnabled('chat-a'), true);
    assert.equal(e.f.files.has('u1:memory/chats/chat-a.state.json'), false);
    const restarted = createMemoryService({ host: e.host, store: e.store }).forUser('u1'); await restarted.ensureChat('chat-a');
    assert.ok(await restarted.backup.safety('chat-a')); await restarted.backup.undo('chat-a');
    assert.equal(restarted.loadScenes('chat-a').scenes[0].title, '비밀 열쇠');
    assert.equal(await restarted.backup.safety('chat-a'), null);
    assert.equal(e.f.files.has('u1:memory/chats/chat-a.state.json'), true);
});

for (const operation of ['write', 'delete']) test(`restore ${operation} failure rolls back every file and settings; unsafe snapshots never replace data`, async () => {
    const e = await setup(); await seed(e);
    const backup = (await e.room('GET', 'backup')).backup;
    const before = new Map(e.f.files);
    backup.files.scenes.scenes[0].title = '바뀌면 안 됨'; backup.header.fileHashes.scenes = B.hashOf(backup.files.scenes);
    if (operation === 'delete') { delete backup.files.state; delete backup.header.fileHashes.state; }
    const original = e.f.api.userStorage[operation]; let failed = false;
    e.f.api.userStorage[operation] = async (key, ...args) => {
        if (!failed && key === (operation === 'delete' ? 'memory/chats/chat-a.state.json' : 'memory/chats/chat-a.scenes.json')) { failed = true; throw Error('injected I/O failure'); }
        return original(key, ...args);
    };
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), /이전 상태로 되돌렸/);
    for (const [key, value] of before) assert.equal(e.f.files.get(key), value, key);
    assert.ok(await e.um.backup.safety('chat-a'));
    await e.um.ensureChat('chat-a'); assert.equal(e.um.loadScenes('chat-a').scenes[0].title, '비밀 열쇠');
    e.f.api.userStorage[operation] = original;
    const write = e.f.api.userStorage.write;
    e.f.api.userStorage.write = async (key, ...args) => { if (key.includes('restore-undo')) throw Error('snapshot unavailable'); return write(key, ...args); };
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), /snapshot unavailable/);
    for (const [key, value] of before) assert.equal(e.f.files.get(key), value, key);
});

test('orphan routes list only the requesting user, refuse live rooms and require explicit confirmation', async () => {
    const e = await setup(); await seed(e);
    e.f.files.set('u1:memory/chats/deleted.json', JSON.stringify(L.emptyLedger()));
    e.f.files.set('u2:memory/chats/private.json', JSON.stringify(L.emptyLedger()));
    const list = await e.call('GET', 'orphans'); assert.deepEqual(list.orphans.map(o => o.id), ['deleted']);
    await assert.rejects(e.call('DELETE', 'orphans/deleted'), /명시적으로/);
    await assert.rejects(e.call('DELETE', 'orphans/chat-a', { confirm: true }), /삭제된 방/);
    await e.call('DELETE', 'orphans/deleted', { confirm: true });
    assert.equal(e.f.files.has('u1:memory/chats/deleted.json'), false);
    assert.equal(e.f.files.has('u2:memory/chats/private.json'), true);
    e.f.files.set('u1:memory/chats/gone.json', JSON.stringify(L.emptyLedger()));
    assert.equal((await e.call('POST', 'orphans/delete-all', { confirm: true })).deleted, 1);
    e.f.state.denied.push('chats'); await assert.rejects(e.call('GET', 'orphans'), /권한/);
    assert.equal(e.f.files.has('u1:memory/chats/chat-a.json'), true);
});

test('same chat ID across two users isolates all new files, backup, recall marks and rendered cache', async () => {
    const e = await setup(); await seed(e);
    const other = e.svc.forUser('u2'); await other.ensureChat('chat-a');
    other.saveSettings({ chats: { 'chat-a': { enabled: true } } });
    other.saveLedger('chat-a', L.emptyLedger()); other.saveScenes('chat-a', S.emptyStore());
    await e.room('POST', 'recall-prefs', { id: 'F1', action: 'pin' });
    await e.um.rendered('chat-a'); await other.rendered('chat-a');
    assert.match(e.um.cachedRendered('chat-a'), /커피/); assert.equal(other.cachedRendered('chat-a'), '');
    assert.deepEqual((await e.room('GET', '', {}, 'u2')).recallPrefs.pinned, []);
    assert.equal((await e.room('GET', 'world', {}, 'u2')).cards.length, 0);
    assert.equal((await e.room('GET', 'backup', {}, 'u2')).backup.files.scenes.scenes.length, 0);
    assert.equal((await e.room('GET', 'conflicts', {}, 'u2')).open, 0);
    assert.equal((await e.room('GET', 'selected-memories', {}, 'u2')).items.length, 0);
});

test('branch inheritance trims future world/decisions/prefs, remaps selected sources, preserves manual locks and never overwrites target files', async () => {
    const e = await setup();
    const rows = e.f.addMessages('chat-a', [{ id: 'a1', role: 'user', content: '첫 만남이다.' }, { id: 'a2', role: 'assistant', content: '미래의 만남이다.' }]);
    const st = await seed(e), messages = await e.um.chatMessages('chat-a');
    st.scenes.forEach((s, i) => { s.messages = [{ id: messages[i].id, h: messages[i].h }]; }); st.covered = st.scenes.flatMap(s => s.messages);
    e.um.saveScenes('chat-a', st);
    await e.room('POST', 'state', { action: 'set', name: '하루', field: 'mood', value: '직접 쓴 기분' });
    await e.room('POST', 'recall-prefs', { id: 'S2', action: 'pin' });
    e.f.model = () => '{"title":"첫 만남","summary":"만남을 기록했다."}';
    await e.room('POST', 'selected-memory', { parts: [{ sourceId: rows[0].id, text: '첫 만남이다.' }] });
    await e.room('POST', 'selected-memory', { parts: [{ sourceId: rows[1].id, text: '미래의 만남이다.' }] });
    e.f.addMessages('fork', [{ id: 'b1', role: 'user', content: '첫 만남이다.' }]);
    const result = await e.um.inheritBranch('chat-a', 'fork', { a1: 'b1', a2: 'b2' }); assert.equal(result.matched, 1);
    const world = e.um.roomData.using('fork', () => e.um.features.world('fork'));
    assert.equal(world.cards[0].outfit, '파란 옷'); assert.equal(world.cards[0].mood, '직접 쓴 기분');
    assert.deepEqual(e.um.features.preferences('fork').pinned, []);
    assert.equal(e.um.roomData.get('fork', 'conflicts').conflicts.length, 0);
    const picked = e.um.roomData.get('fork', 'selected').items;
    assert.equal(picked.length, 1); assert.equal(picked[0].parts[0].sourceId, 'b1');
    assert.equal(e.um.roomData.get('chat-a', 'selected').items.length, 2);
    e.f.addMessages('protected-fork', [{ id: 'c1', role: 'user', content: '첫 만남이다.' }]);
    e.f.files.set('u1:memory/chats/protected-fork.trackers.json', '{"version":99}');
    assert.equal((await e.um.inheritBranch('chat-a', 'protected-fork', { a1: 'c1' })).skipped, true);
    assert.equal(e.f.files.get('u1:memory/chats/protected-fork.trackers.json'), '{"version":99}');
});

test('restore rejects malformed documents, blocks while jobs run and waits for an in-flight selected-memory save', async () => {
    const e = await setup(); await seed(e);
    const backup = (await e.room('GET', 'backup')).backup;
    for (const mutate of [b => { b.header.version = 99; }, b => { b.files.scenes.scenes[0].title = 'tampered'; }, b => { b.files['../../escape'] = {}; }, b => { b.settings = JSON.parse('{"__proto__":{"polluted":true}}'); }]) {
        const bad = structuredClone(backup); mutate(bad);
        await assert.rejects(e.room('POST', 'restore/preview', { backup: bad }));
        await assert.rejects(e.room('POST', 'restore/apply', { backup: bad }));
    }
    e.um.jobs.set('chat-a', { state: 'running' });
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), /정리하는 중/);
    await assert.rejects(e.room('POST', 'restore/undo'), /정리하는 중/);
    e.um.jobs.clear();
    e.f.addMessages('chat-a', [{ id: 'concurrent', role: 'user', content: '동시 작업 원문이다.' }]);
    let release, started;
    const began = new Promise(r => { started = r; });
    e.f.model = () => new Promise(r => { release = () => r('{"title":"동시 기억","summary":"선택한 원문"}'); started(); });
    const selecting = e.room('POST', 'selected-memory', { parts: [{ sourceId: 'concurrent', text: '동시 작업 원문이다.' }] });
    await began;
    const restoring = e.room('POST', 'restore/apply', { backup });
    release(); await selecting; await restoring;
    assert.equal(e.um.roomData.get('chat-a', 'selected').items.length, 0);
    await e.room('POST', 'restore/undo');
    assert.equal(e.um.roomData.get('chat-a', 'selected').items[0].title, '동시 기억', 'safety snapshot includes completed selection');
});

test('restore hides intermediate multi-file state from reads and keeps safety copy after rollback failure for a restart undo', async () => {
    const e = await setup(); await seed(e);
    const backup = (await e.room('GET', 'backup')).backup;
    backup.files.scenes.scenes[0].title = '복원 완료'; backup.header.fileHashes.scenes = B.hashOf(backup.files.scenes);
    const original = e.f.api.userStorage.write;
    let release, entered;
    const began = new Promise(r => { entered = r; });
    e.f.api.userStorage.write = async (key, ...args) => {
        if (key === 'memory/chats/chat-a.scenes.json' && !release) { await new Promise(r => { release = r; entered(); }); }
        return original(key, ...args);
    };
    const apply = e.room('POST', 'restore/apply', { backup }); await began;
    let readDone = false; const read = e.room('GET', 'scenes').then(x => { readDone = true; return x; });
    await new Promise(r => setTimeout(r, 5)); assert.equal(readDone, false);
    release(); await apply; assert.equal((await read).scenes[0].title, '복원 완료');
    await e.room('POST', 'restore/undo');
    let damaged = false;
    e.f.api.userStorage.write = async (key, ...args) => {
        if (key === 'memory/chats/chat-a.scenes.json') {
            // Actually change the data before making rollback fail. A rejected write that leaves
            // the old bytes intact must no longer produce the false rollback-failure alert (fix1 F1).
            if (!damaged) { damaged = true; await original(key, ...args); }
            throw Error('persistent disk failure');
        }
        return original(key, ...args);
    };
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), /안전 사본/);
    e.f.api.userStorage.write = original;
    const fresh = createMemoryService({ host: e.host, store: e.store }).forUser('u1'); await fresh.ensureChat('chat-a');
    await fresh.backup.undo('chat-a'); assert.equal(fresh.loadScenes('chat-a').scenes[0].title, '비밀 열쇠');
});

test('scene exclusion suppresses containing chapter/arc summaries; a finished translation does not block restore', async () => {
    const e = await setup(); const st = await seed(e);
    st.chapters = [{ id: 'C1', scenes: ['S1'], title: '누출될 챕터', summary: '비밀 열쇠 챕터 요약', turns: [], keep: [] }, { id: 'C2', scenes: ['S2'], title: '현재 챕터', summary: '안전한 내용', turns: [], keep: [] }];
    st.arcs = [{ id: 'A1', chapters: ['C1', 'C2'], title: '누출될 큰 흐름', summary: '비밀 열쇠 큰 흐름', turns: [], keep: [] }];
    e.um.saveScenes('chat-a', st);
    await e.room('POST', 'recall-prefs', { id: 'S1', action: 'exclude' });
    assert.doesNotMatch(e.um.renderMemorySource('chat-a'), /누출될|비밀 열쇠/);
    assert.match(e.um.renderMemorySource('chat-a'), /현재 챕터/);
    e.um.preparing.set('chat-a', { working: false, target: 'ko', left: 0 });
    const backup = (await e.room('GET', 'backup')).backup;
    assert.equal((await e.room('POST', 'restore/apply', { backup })).undoAvailable, true);
});

test('a failed branch write removes newly copied feature files/settings/caches and permits a retry', async () => {
    const e = await setup();
    e.f.addMessages('chat-a', [{ id: 'a1', role: 'user', content: '첫 만남이다.' }]);
    const st = await seed(e), messages = await e.um.chatMessages('chat-a');
    st.scenes = [st.scenes[0]]; st.scenes[0].messages = [{ id: messages[0].id, h: messages[0].h }]; st.covered = st.scenes[0].messages;
    e.um.saveScenes('chat-a', st); await e.um.flush();
    e.f.addMessages('fork', [{ id: 'b1', role: 'user', content: '첫 만남이다.' }]);
    const write = e.f.api.userStorage.write; let failed = false;
    e.f.api.userStorage.write = async (key, ...args) => { if (!failed && key === 'memory/chats/fork.state.json') { failed = true; throw Error('fork write failure'); } return write(key, ...args); };
    await assert.rejects(e.um.inheritBranch('chat-a', 'fork', { a1: 'b1' }), /fork write failure/);
    assert.equal(e.um.settings().chats.fork, undefined);
    assert.equal([...e.f.files.keys()].some(k => k.startsWith('u1:memory/chats/fork.')), false);
    e.f.api.userStorage.write = write;
    assert.equal((await e.um.inheritBranch('chat-a', 'fork', { a1: 'b1' })).matched, 1);
    assert.equal(e.um.roomData.get('fork', 'state').cards.length, 1);
});
