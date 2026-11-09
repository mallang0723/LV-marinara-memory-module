import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './env.js';
import { createRouter } from '../src/common/router.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
import { createMemoryService } from '../src/memory/service.js';
import { createInjector } from '../src/common/injector.js';
import S from '../src/memory/core/scenes.generated.cjs';
import B from '../src/memory/core/backup.generated.cjs';
import Cf from '../src/memory/core/conflicts.generated.cjs';
import St from '../src/memory/core/state.generated.cjs';
import Pl from '../src/memory/core/places.generated.cjs';
import Ks from '../src/memory/core/keepsakes.generated.cjs';
import Tk from '../src/memory/core/trackers.generated.cjs';
import Rp from '../src/memory/core/reasons.generated.cjs';

async function env(debounceMs = 0) {
    const e = makeEnv({ debounceMs });
    await e.um.ensureChat('chat-a');
    e.um.saveSettings({ ...e.um.settings(), connection: 'conn-a', recall: 'off', chats: { 'chat-a': { enabled: true, features: Object.fromEntries(['characterState', 'places', 'keepsakes', 'trackers'].map(k => [k, 'on'])) } } });
    e.um.saveScenes('chat-a', S.emptyStore()); await e.um.flush();
    const router = createRouter(); registerMemoryRoutes(router, e.svc);
    e.call = (method, path, body = {}) => router.handle({ method, path: 'memory-module/' + path, body }, 'u1');
    e.room = (method, path, body) => e.call(method, 'chats/chat-a/' + path, body);
    return e;
}
const pause = ms => new Promise(r => setTimeout(r, ms));
const settingsOther = (e, value) => e.um.saveSettings({ ...e.um.settings(), chats: { ...e.um.settings().chats, other: { marker: value } } });
for (const op of ['apply', 'undo', 'orphan']) test(`F1 ${op}: pending and active settings writes from another room survive (500ms debounce)`, async () => {
    const e = await env(500);
    const doc = (await e.room('GET', 'backup')).backup;
    if (op === 'undo') await e.room('POST', 'restore/apply', { backup: doc });
    if (op === 'orphan') {
        e.f.files.set('u1:memory/chats/dead.json', '{"version":1,"threads":[]}');
        e.um.saveSettings({ ...e.um.settings(), chats: { ...e.um.settings().chats, dead: { enabled: true } } }); await e.um.flush();
    }
    const write = e.f.api.userStorage.write, del = e.f.api.userStorage.delete;
    let raced = false, activeRace = false;
    const trigger = key => {
        if (!raced && key.startsWith(`memory/chats/${op === 'orphan' ? 'dead' : 'chat-a'}`)) { raced = true; settingsOther(e, 'pending'); assert.ok(e.store.hasPending()); }
    };
    e.f.api.userStorage.delete = async (key, ...args) => { trigger(key); return del(key, ...args); };
    e.f.api.userStorage.write = async (key, ...args) => {
        trigger(key);
        if (raced && key === e.um.keys.settings && !activeRace) { activeRace = true; settingsOther(e, 'latest'); await pause(20); }
        return write(key, ...args);
    };
    if (op === 'orphan') await e.call('DELETE', 'orphans/dead', { confirm: true });
    else await e.room('POST', `restore/${op}`, { backup: doc });
    await e.um.flush();
    assert.ok(raced && activeRace);
    const disk = JSON.parse(e.f.files.get('u1:memory/settings.json'));
    assert.equal(disk.chats.other.marker, 'latest'); assert.deepEqual(disk, e.um.settings());
    if (op === 'orphan') { assert.ok(!disk.chats.dead); assert.equal((await e.call('GET', 'orphans')).orphans.some(x => x.id === 'dead'), false); }
    else assert.deepEqual(e.um.loadScenes('chat-a').facts, []);
});

test('F1 raw replacement drains a pending write and waits for its active storage operation', async () => {
    const e = makeEnv({ debounceMs: 500 });
    const write = e.f.api.userStorage.write;
    e.f.api.userStorage.write = async (...a) => { await pause(10); return write(...a); };
    const first = e.store.setJson('u1', 'key', { old: true });
    await e.store.replaceRaw('u1', 'key', '{"new":true}'); await first;
    assert.equal(e.f.files.get('u1:key'), '{"new":true}');
});

for (const failure of ['missing', 'broken', 'version', 'unreadable']) test(`F2 ${failure} scenes: world/trackers/conflicts GETs do not rewrite derived data`, async () => {
    const e = await env();
    const st = S.emptyStore();
    st.scenes = [{ id: 'S1', start: 1, end: 1, state: [{ who: '하루', outfit: '옷' }], place: '집', placeNotes: [{ place: '집', description: '집' }], keepsakes: [{ name: '편지', owner: '하루' }] }];
    e.um.saveScenes('chat-a', st);
    e.um.roomData.save('chat-a', 'conflicts', { version: 1, next: 2, conflicts: [{ id: 'C1', a: 'F1', b: 'F2', status: 'keepA' }] });
    await e.um.flush();
    const key = 'u1:memory/chats/chat-a.scenes.json';
    if (failure === 'missing') e.f.files.delete(key);
    else e.f.files.set(key, failure === 'version' ? '{"version":999}' : failure === 'broken' ? '{broken' : JSON.stringify(st));
    if (failure === 'unreadable') { const read = e.f.api.userStorage.read; e.f.api.userStorage.read = (k, ...a) => { if (k.endsWith('.scenes.json')) throw Error('temporary read failure'); return read(k, ...a); }; }
    e.um.invalidateRoom('chat-a'); await e.um.ensureChat('chat-a');
    const before = new Map(e.f.files);
    for (const name of ['world', 'trackers', 'conflicts']) await e.room('GET', name);
    await e.um.flush(); assert.deepEqual(e.f.files, before);
    assert.equal(e.um.roomData.get('chat-a', 'conflicts').conflicts[0].status, 'keepA');
});

test('F2 restoring conflicts without scenes retains the decisions through subsequent GETs', async () => {
    const e = await env();
    const conflicts = { version: 1, next: 2, conflicts: [{ id: 'C1', a: 'F1', b: 'F2', status: 'keepB' }] };
    const backup = B.build({ chatId: 'chat-a', files: { conflicts } });
    await e.room('POST', 'restore/apply', { backup });
    const before = new Map(e.f.files);
    for (const name of ['world', 'trackers', 'conflicts']) await e.room('GET', name);
    await e.um.flush(); assert.deepEqual(e.f.files, before);
    assert.equal(e.um.roomData.get('chat-a', 'conflicts').conflicts[0].status, 'keepB');
});

function conflictData(n) {
    const st = S.emptyStore(), conflicts = [];
    for (let i = 0; i < n; i++) {
        const a = `F${2*i+1}`, b = `F${2*i+2}`, about = `인물${i}`;
        st.facts.push({ id: a, about, text: '커피를 즐겨 마신다' }, { id: b, about, text: '커피를 즐겨 마시지 않는다' });
        conflicts.push({ id: `C${i+1}`, a, b, about, status: i % 2 ? 'keepA' : 'keepB' });
    }
    return { st, file: { version: 1, conflicts, next: n+1 } };
}
test('F3 more than 150 keepA/keepB decisions survive fold, save, restart and fact exclusion', async () => {
    const e = await env(), { st, file } = conflictData(170);
    e.um.roomData.save('chat-a', 'conflicts', file); e.um.saveScenes('chat-a', st); await e.um.flush();
    const fresh = createMemoryService({ host: e.host, store: e.store }).forUser('u1'); await fresh.ensureChat('chat-a'); fresh.features.refresh('chat-a', fresh.loadScenes('chat-a'));
    assert.equal(fresh.roomData.get('chat-a', 'conflicts').conflicts.length, 170);
    const hidden = fresh.features.filters('chat-a', st).hideFacts;
    for (const c of file.conflicts) assert.ok(hidden.has(c.status === 'keepA' ? c.b : c.a));
    const merged = structuredClone(st); merged.facts[1].replacedBy = 'F999'; merged.facts.push({ id: 'F999', about: '인물0', text: '합친 사실' });
    fresh.roomData.save('chat-a', 'conflicts', { ...file, conflicts: file.conflicts.map(c => ({ ...c, status: 'keepA' })) }); fresh.saveScenes('chat-a', merged);
    assert.ok(fresh.features.filters('chat-a', merged).hideFacts.has('F999')); await fresh.flush();
});

test('F3 pruning only both/dismissed decisions; missing fact temporarily keeps exclusions', () => {
    const { st, file } = conflictData(180);
    file.conflicts.slice(160).forEach(c => { c.status = 'both'; });
    const next = Cf.fold(st, file);
    assert.equal(next.conflicts.length, 160); assert.ok(next.conflicts.every(c => /keep/.test(c.status)));
    assert.equal(Cf.fold(S.emptyStore(), next).conflicts.length, 160);
});

for (const [name, core, empty, key, cap] of [['state', St, 'emptyState', 'cards', 60], ['places', Pl, 'emptyPlaces', 'places', 80], ['keepsakes', Ks, 'emptyKeepsakes', 'items', 60]]) test(`F5 ${name}: more than cap manual cards and locked/aliased cards survive; omitted automatic count is accurate`, () => {
    let manual = core[empty]();
    for (let i = 0; i < cap + 5; i++) manual = name === 'state' ? core.addCard(manual, `수동${i}`) : (name === 'places' ? core.addPlace(manual, `수동${i}`) : core.addItem(manual, `수동${i}`));
    assert.equal(core.fold(S.emptyStore(), manual)[key].length, cap + 5);
    const st = S.emptyStore();
    for (let i = 0; i < cap + 4; i++) st.scenes.push({ id: `S${i+1}`, start: i+1, end: i+1, state: [{ who: `자동${i}`, outfit: '옷' }], place: `장소${i}`, placeNotes: [{ place: `장소${i}`, description: '장소' }], keepsakes: [{ name: `물건${i}`, owner: '하루' }] });
    let previous = core[empty]();
    if (name === 'state') previous = core.setField(previous, '자동0', 'outfit', '잠금');
    else {
        // Build the early card alone, then lock it before newer automatic cards push it past the cap.
        previous = core.fold({ ...st, scenes: [st.scenes[0]] }, previous);
        previous = core.setField(previous, previous[key][0].id, name === 'places' ? 'description' : 'meaning', '잠금');
    }
    const folded = core.fold(st, previous);
    assert.ok(folded[key].some(c => Object.values(c.user || {}).includes('잠금')));
    assert.equal(folded[key].length, cap); assert.equal(folded.omittedAuto, 4);
});

test('F5 more than 30 manual trackers and 2000 pinned/excluded marks survive edit, merge and normalize', () => {
    let file = Tk.emptyTrackers();
    for (let i = 0; i < 35; i++) file = Tk.addItem(file, { type: 'count', label: `기록${i}`, clock: 'real', scope: 'room', count: { start: '2026-01-01' } });
    file = Tk.editItem(file, file.items[0].id, { label: '직접 수정' });
    assert.equal(Tk.forBranch(file, S.emptyStore()).items.length, 35);
    const prefs = { pinned: Array.from({ length: 2100 }, (_, i) => `S${i+1}`), excluded: Array.from({ length: 2100 }, (_, i) => `F${i+1}`) };
    const next = Rp.followMerges(prefs, { facts: [{ id: 'F2100', replacedBy: 'F9999' }, { id: 'F9999' }] });
    assert.equal(Rp.sets(next).pinned.size, 2100); assert.equal(Rp.sets(next).excluded.size, 2100); assert.ok(next.excluded.includes('F9999'));
});

test('F5 open conflicts above 30 expose the exact omitted automatic count', () => {
    const { st } = conflictData(36); const file = Cf.fold(st, Cf.emptyConflicts());
    assert.equal(file.conflicts.length, 30); assert.equal(Cf.view(file, st).omittedAuto, 6);
    assert.equal(Cf.fold(st, file).omittedAuto, 6);
});

for (const change of ['edit', 'delete']) test(`F4 selected-memory ${change}: timeout fallback contains no cached selected text`, async () => {
    const e = await env(); const rows = e.f.addMessages('chat-a', [{ role: 'user', content: '비밀 편지 원문이다.' }]);
    e.f.model = () => JSON.stringify({ title: '비밀 편지', summary: '선택전용내용' });
    await e.room('POST', 'selected-memory', { parts: [{ sourceId: rows[0].id, text: rows[0].content }] });
    await e.um.recallBeforeReply('chat-a', await e.um.chatMessages('chat-a'), '비밀 편지');
    assert.match(await e.um.rendered('chat-a'), /선택전용내용/);
    if (change === 'edit') rows[0].content = '바뀐 원문'; else e.f.messages.set('chat-a', []);
    e.um.syncBeforeReply = () => new Promise(() => {});
    e.um.saveSettings({ ...e.um.settings(), interceptorBudgetMs: 1 });
    const result = await createInjector({ service: e.svc }).handler([{ role: 'user', content: '비밀 편지' }], { userId: 'u1', chatId: 'chat-a', generationType: 'normal' });
    assert.doesNotMatch(JSON.stringify(result), /선택전용내용|직접 선택해 정리한 기억/); await e.um.flush();
});

test('F6 two restores retain the earlier raw snapshot and two undo operations restore both states', async () => {
    const e = await env();
    const first = new Map(e.f.files), a = (await e.room('GET', 'backup')).backup;
    const b = structuredClone(a); b.files.scenes.cast = ['복원1']; b.header.fileHashes.scenes = B.hashOf(b.files.scenes);
    await e.room('POST', 'restore/apply', { backup: b });
    const safety = e.f.files.get('u1:memory/restore-undo/chat-a/snapshot.json');
    const c = structuredClone(a); c.files.scenes.cast = ['복원2']; c.header.fileHashes.scenes = B.hashOf(c.files.scenes);
    await e.room('POST', 'restore/apply', { backup: c });
    assert.equal(e.f.files.get('u1:memory/restore-undo/chat-a/snapshot.prev.json'), safety);
    await e.room('POST', 'restore/undo'); assert.deepEqual(e.um.loadScenes('chat-a').cast, ['복원1']);
    await e.room('POST', 'restore/undo'); assert.deepEqual(e.f.files, first);
});

test('F6 preview lists lang, vectors and even corrupt files that apply removes', async () => {
    const e = await env(), backup = (await e.room('GET', 'backup')).backup;
    const extra = ['lang', 'vectors', 'selected'];
    for (const k of extra) e.f.files.set(`u1:memory/chats/chat-a${B.FILES[k]}`, '{broken');
    const p = await e.room('POST', 'restore/preview', { backup });
    assert.deepEqual(p.removes.sort(), extra.sort());
    await e.room('POST', 'restore/apply', { backup });
    for (const k of extra) assert.ok(!e.f.files.has(`u1:memory/chats/chat-a${B.FILES[k]}`));
});

test('F1 a storage error after a completed rollback write must not claim rollback data loss', async () => {
    const e = await env(500), backup = (await e.room('GET', 'backup')).backup;
    const before = e.f.files.get('u1:memory/chats/chat-a.scenes.json');
    backup.files.scenes.cast = ['수정']; backup.header.fileHashes.scenes = B.hashOf(backup.files.scenes);
    const write = e.f.api.userStorage.write;
    e.f.api.userStorage.write = async (key, ...args) => { const result = await write(key, ...args); if (key.endsWith('.scenes.json')) throw Error('write acknowledgement failed'); return result; };
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), error => /이전 상태로 되돌렸/.test(error.message) && !/복구에 실패/.test(error.message));
    assert.equal(e.f.files.get('u1:memory/chats/chat-a.scenes.json'), before);
});

test('F2 a blocked scenes key with an old cached scene does not refresh derived data', async () => {
    const e = await env();
    e.um.roomData.save('chat-a', 'conflicts', { version: 1, next: 2, conflicts: [{ id: 'C1', a: 'F1', b: 'F2', status: 'both' }] }); await e.um.flush();
    await e.store.markBroken('u1', e.um.keys.scenes('chat-a'), Error('read failed'));
    const before = new Map(e.f.files);
    for (const name of ['world', 'trackers', 'conflicts']) await e.room('GET', name);
    await e.um.flush(); assert.deepEqual(e.f.files, before);
});

test('F6 failed previous-snapshot verification prevents any second-restore mutation', async () => {
    const e = await env(), backup = (await e.room('GET', 'backup')).backup;
    await e.room('POST', 'restore/apply', { backup });
    const before = new Map(e.f.files), write = e.f.api.userStorage.write;
    e.f.api.userStorage.write = (key, ...args) => key.endsWith('snapshot.prev.json') ? undefined : write(key, ...args);
    await assert.rejects(e.room('POST', 'restore/apply', { backup }), /이전 안전 사본 검증/);
    assert.deepEqual(e.f.files, before);
});

test('F5/F6 generated screen shows Korean omission counts and every removed backup file', async () => {
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const { patchMemory } = await import('../src/memory/ui/patch.mjs');
    const source = patchMemory({ runtime: readFileSync(new URL('../src/memory/ui/runtime.orig.js', import.meta.url), 'utf8'), uiCss: '', themeCss: '', version: 'test' });
    const fn = name => { const start = source.indexOf(`  function ${name}(`), end = source.indexOf('\n  }\n', start); return runInNewContext(`(${source.slice(start, end+4)})`, { esc: x => String(x ?? '') }); };
    const notice = fn('omissionNotice')({ state: 4, places: 2, keepsakes: 1, conflicts: 6 });
    assert.match(notice, /인물 상태 4개.*장소 2개.*소중한 물건 1개.*열린 충돌 6개/); assert.match(notice, /직접 고친 기록과 판단은 보존/);
    assert.equal(fn('omissionNotice')({ state: 0 }), '');
    const html = fn('backupPaper')({ preview: { data: { source: { chatId: 'chat-a' }, backup: {}, current: {}, vectors: {}, removes: ['lang', 'vectors', 'selected'] } } });
    assert.match(html, /지울 파일: lang, vectors, selected/); assert.match(html, /직전 안전 사본/);
});

test('F7 QA seed has an authorized empty room, populated 1.3 screens, and chat-scoped command events', async () => {
    const { createQaEnv } = await import('../qa/backend-env.mjs');
    const e = await createQaEnv();
    const call = async path => { const r = await e.f.rpc('GET', 'memory-module/' + path, {}, 'qa-user'); assert.ok(r.ok, r.error); return r.data; };
    assert.equal((await call('chats/chat-none')).enabled, false);
    const world = await call('chats/chat-a/world'); assert.ok(world.trackers.items.length && world.cards.length && world.keepList.length && world.placeList.length);
    assert.ok((await call('chats/chat-a/conflicts')).open > 0);
    assert.ok((await call('chats/chat-a/selected-memories')).items.length > 0);
    assert.ok((await call('chats/chat-a/recall-report')).marks.length > 0);
    assert.ok((await call('orphans')).orphans.some(o => o.id === 'deleted-qa'));
    assert.ok((await call('chats/chat-a/backup')).backup.files.scenes);
    await e.f.invokeCommand('open-memory', { chatId: 'chat-a' });
    assert.ok(e.drain().some(m => m.event === 'command' && m.id === 'open-memory' && m.chatId === 'chat-a'));
});
