// Ported from upstream tests/test-branches.cjs (09d0699): the pure branchMemory cases, unchanged. The service-level cases
// (files, settings, vectors, hook) are in the second half and use the fake Spindle host instead of the Marinara engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { branchMemory } from '../src/memory/service.js';
import { makeEnv, story, U } from './env.js';
const require = createRequire(import.meta.url);
const L = require('../src/memory/core/ledger.cjs');
const S = require('../src/memory/core/scenes.cjs');
const V = require('../src/memory/core/vectors.cjs');

function fixture() {
  const source = L.prepareMessages(Array.from({ length: 6 }, (_, i) => ({
    id: `m${i + 1}`, number: 10 + i * 3, speaker: i % 2 ? 'Narrator' : 'User',
    role: i % 2 ? 'narrator' : 'user', content: `2026-10-${20 + i} 12:00\n${i + 1}번째 일.`,
  })));
  const ledger = L.emptyLedger();
  const evidence = { messageId: source[0].id, number: source[0].number, sentence: 1, text: '첫 약속' };
  for (let i = 0; i < 6; i += 2) {
    L.beginBatch(ledger, i);
    if (!i) {
      ledger.nextId = 2;
      ledger.threads.push({ id: 'T1', kind: 'promise', title: '약속', who: '도윤', toward: null, detail: null, status: 'open', openedAt: { ...evidence }, evidence: [{ ...evidence }], clues: [], edited: true });
      ledger.routine = [{ who: '도윤', what: 'sleep', text: '잠', number: source[0].number }];
    }
    if (i === 4) {
      ledger.threads[0].status = 'closed';
      ledger.threads[0].closed = { evidence: [{ messageId: 'm5', number: source[4].number, text: '나중에 지킨 약속' }] };
      ledger.routine.push({ who: '도윤', what: 'sleep', text: '미래 수면', number: source[4].number });
    }
    L.commitBatch(ledger, source.slice(i, i + 2));
  }
  const scenes = S.emptyStore();
  scenes.scenes = [0, 2, 4].map((i, j) => ({
    id: `S${j + 1}`, start: source[i].number, end: source[i + 1].number,
    messages: source.slice(i, i + 2).map((m) => ({ id: m.id, h: m.h })),
    title: `장면${j + 1}`, summary: '직접 수정한 기억', events: [{ text: '사건', quotes: [{ ...evidence, messageId: source[i].id, number: source[i].number }] }],
    recollections: [], present: [], heardLater: [], edited: true,
  }));
  scenes.covered = scenes.scenes.flatMap((s) => s.messages);
  scenes.nextScene = 4; scenes.nextFact = 3;
  scenes.facts = [
    { id: 'F1', text: '비밀', sceneId: 'S1', evidence: [{ ...evidence }], unaware: ['도윤'], replacedBy: 'F2' },
    { id: 'F2', text: '미래 사실', sceneId: 'S3', evidence: [{ ...evidence, number: source[4].number, messageId: 'm5' }], unaware: [] },
  ];
  S.setKnowing(scenes.facts[0], '도윤', 'S3', { unaware: false });
  scenes.scenes[0].later = [{ what: '미래 폭로', in: 'S3' }];
  scenes.scenes[0].heardLater = [{ who: '도윤', in: 'S3' }];
  scenes.chapters = [{ id: 'C1', scenes: ['S1'], start: source[0].number, end: source[1].number, title: '첫 챕터', edited: true }, { id: 'C2', scenes: ['S2', 'S3'], start: source[2].number, end: source[5].number, title: '미래 챕터' }];
  scenes.arcs = [{ id: 'A1', chapters: ['C1', 'C2'], title: '미래 큰 흐름' }];
  scenes.window = { size: 30, firstInside: 10 };
  return { source, ledger, scenes };
}
function fork(f, count = 6) {
  const target = f.source.slice(0, count).map((m, i) => ({ ...structuredClone(m), id: `b${i + 1}`, number: 100 + i * 5 }));
  const ids = new Map(f.source.slice(0, count).map((m, i) => [m.id, target[i].id]));
  return { target, ids };
}

test('full branch keeps hand edits, summaries, knowledge and rollback history, remapping every source reference', () => {
  const f = fixture(), { target, ids } = fork(f);
  const before = JSON.stringify(f);
  const out = branchMemory(f.ledger, f.scenes, f.source, target, ids);
  assert.equal(out.matched, 6);
  assert.equal(out.ledgerReset, false);
  assert.equal(out.ledger.threads[0].edited, true);
  assert.equal(out.ledger.threads[0].evidence[0].messageId, 'b1');
  assert.equal(out.ledger.threads[0].closed.evidence[0].number, 120);
  assert.equal(out.ledger.lastNumber, 125);
  assert.equal(out.scenes.chapters[0].start, 100);
  assert.equal(out.scenes.scenes[0].events[0].quotes[0].number, 100);
  assert.equal(L.reconcile(out.ledger, target).rolledBack, false);
  assert.equal(S.changedAt(out.scenes, target), -1);
  assert.deepEqual(out.scenes.facts[0].unaware, []);
  assert.equal(out.scenes.window, null);
  assert.equal(JSON.stringify(f), before, 'original never changed');
  target[4].h = 'changed in branch';
  assert.equal(L.reconcile(out.ledger, target).rolledBack, true);
  assert.equal(out.ledger.threads[0].status, 'open', 'copied undo snapshots remain usable');
  assert.equal(out.ledger.threads[0].evidence[0].messageId, 'b1');
  assert.equal(f.ledger.threads[0].status, 'closed', 'source stays independent');
});

test('past fork excludes later events, closures, daily life, revelations, knowledge, chapters and arcs', () => {
  const f = fixture(), { target, ids } = fork(f, 4);
  const before = JSON.stringify(f);
  const out = branchMemory(f.ledger, f.scenes, f.source, target, ids);
  assert.equal(out.ledger.threads[0].status, 'open');
  assert.equal(out.ledger.routine.length, 1);
  assert.equal(out.ledger.storyDate, '2026-10-23');
  assert.equal(out.ledger.lastNumber, 115);
  assert.deepEqual(out.scenes.scenes.map((s) => s.id), ['S1', 'S2']);
  assert.deepEqual(out.scenes.facts.map((f) => f.id), ['F1']);
  assert.deepEqual(out.scenes.facts[0].unaware, ['도윤']);
  assert.equal(out.scenes.facts[0].replacedBy, undefined);
  assert.deepEqual(out.scenes.scenes[0].later, []);
  assert.deepEqual(out.scenes.scenes[0].heardLater, []);
  assert.deepEqual(out.scenes.chapters.map((c) => c.id), ['C1']);
  assert.deepEqual(out.scenes.arcs, []);
  assert.equal(JSON.stringify(f), before);
  assert.equal(S.changedAt(out.scenes, target), -1);
});

test('fork through a scene/batch keeps only whole verified units and leaves the tail to be read', () => {
  const f = fixture(), { target, ids } = fork(f, 3);
  const out = branchMemory(f.ledger, f.scenes, f.source, target, ids);
  assert.equal(out.scenes.covered.length, 2);
  assert.equal(out.ledger.processed.length, 2);
  assert.equal(L.reconcile(out.ledger, target).from, 2);
  assert.equal(out.scenes.scenes[0].edited, true);
});

test('missing old undo history re-reads the ledger, never carries a future closure', () => {
  const f = fixture(), { target, ids } = fork(f, 2);
  f.ledger.batches = f.ledger.batches.filter((b) => b.start >= 4);
  const out = branchMemory(f.ledger, f.scenes, f.source, target, ids);
  assert.equal(out.ledgerReset, true);
  assert.deepEqual(out.ledger.threads, []);
  assert.deepEqual(out.ledger.processed, []);
  assert.equal(out.scenes.scenes.length, 1, 'old scenes do not depend on bounded ledger undo history');
});

test('changed text, hidden messages, speaker, or tracker stops inheritance at the verified common prefix', () => {
  for (const kind of ['text', 'hidden', 'speaker', 'tracker']) {
    const f = fixture(), { target, ids } = fork(f);
    if (kind === 'text') target[2].h = 'different';
    if (kind === 'hidden') target.splice(2, 1);
    if (kind === 'speaker') target[2].speaker = 'Other';
    if (kind === 'tracker') { f.source[2].c = 't2:old'; target[2].c = 't2:new'; }
    const out = branchMemory(f.ledger, f.scenes, f.source, target, ids);
    assert.equal(out.matched, 2, kind);
    assert.equal(out.scenes.scenes.length, 1, kind);
    assert.equal(out.ledger.processed.length, 2, kind);
  }
});

test('branching a branch remaps the already inherited IDs again, with no source references left', () => {
  const f = fixture(), first = fork(f);
  const once = branchMemory(f.ledger, f.scenes, f.source, first.target, first.ids);
  const target = first.target.slice(0, 4).map((m, i) => ({ ...m, id: `c${i}`, number: 300 + i * 7 }));
  const ids = new Map(first.target.slice(0, 4).map((m, i) => [m.id, target[i].id]));
  const twice = branchMemory(once.ledger, once.scenes, first.target, target, ids);
  assert.equal(twice.ledger.threads[0].evidence[0].messageId, 'c0');
  assert.equal(twice.scenes.scenes[1].end, 321);
  assert.equal(L.reconcile(twice.ledger, target).rolledBack, false);
  assert.equal(S.changedAt(twice.scenes, target), -1);
  assert.equal(once.ledger.threads[0].status, 'closed');
  assert.equal(twice.ledger.threads[0].status, 'open');
});

test('empty branch has no inherited events and a parent without memory has nothing to copy', () => {
  const f = fixture();
  const empty = branchMemory(f.ledger, f.scenes, f.source, [], new Map());
  assert.deepEqual(empty.ledger.threads, []);
  assert.deepEqual(empty.scenes.scenes, []);
  assert.deepEqual(empty.scenes.facts, []);
  const absent = branchMemory(null, null, [], [], new Map());
  assert.equal(absent.ledger, null);
  assert.equal(absent.scenes, null);
});


/** A chat that is a prefix copy of `from` with new message ids, like Lumiverse's branchChat; returns { idMap }. */
function branchOf(f, from, to, count) {
    const rows = f.addMessages(from, []).slice(0, count);
    const copies = f.addMessages(to, rows.map(m => ({ role: m.role, name: m.name, content: m.content })));
    return { idMap: Object.fromEntries(rows.map((m, i) => [m.id, copies[i].id])) };
}

test('CHAT_FORKED path: the branch gets ledger, scenes, vectors and settings before its first reply; the source stays as it was', async () => {
    const env = makeEnv({ tunables: { SCENE_MIN_PENDING: 1 } });
    const { f, um } = env;
    await um.ready();
    story(f, 'chat-a', 15);
    um.saveSettings({ ...um.settings(), connection: 'conn-a', window: 4 });
    um.setChatEnabled('chat-a', true);
    await um.processChat('chat-a', { rebuild: true });
    await um.ensureChat('chat-a');
    const scenesA = um.loadScenes('chat-a');
    assert.ok(scenesA.scenes.length >= 1);
    const vectors = V.emptyIndex('example');
    const docs = scenesA.scenes.flatMap(V.sceneDocs);
    V.putVectors(vectors, docs, docs.map(() => [1, 0]));
    f.files.set(`${U}:memory/chats/chat-a.vectors.json`, JSON.stringify(vectors));
    await um.flush();
    const before = ['', '.scenes', '.vectors'].map(x => f.files.get(`${U}:memory/chats/chat-a${x}.json`));
    const { idMap } = branchOf(f, 'chat-a', 'chat-b', 15);
    const out = await um.branchCreated('chat-a', 'chat-b', idMap);
    assert.equal(out.matched, 15);
    const ledgerB = JSON.parse(f.files.get(`${U}:memory/chats/chat-b.json`));
    assert.ok(ledgerB.processed.length > 0);
    assert.ok(JSON.stringify(ledgerB).includes(Object.values(idMap)[1]), 'evidence points at the new message ids');
    assert.equal(JSON.parse(f.files.get(`${U}:memory/chats/chat-b.scenes.json`)).scenes.length, scenesA.scenes.length);
    assert.ok(f.files.has(`${U}:memory/chats/chat-b.vectors.json`));
    assert.equal(um.settings().chats['chat-b'].enabled, true);
    assert.equal(um.settings().connection, 'conn-a');
    assert.deepEqual(['', '.scenes', '.vectors'].map(x => f.files.get(`${U}:memory/chats/chat-a${x}.json`)), before, 'source files untouched');
    // repeated event and an independent edit
    const edited = structuredClone(um.loadLedger('chat-b'));
    edited.nextId = 99;
    um.saveLedger('chat-b', edited);
    assert.equal((await um.branchCreated('chat-a', 'chat-b', idMap)).skipped, true);
    assert.equal(um.loadLedger('chat-b').nextId, 99);
});

test('a fork of a chat with no memory writes nothing; a past fork keeps only the earlier scenes', async () => {
    const { f, um } = makeEnv({ tunables: { SCENE_MIN_PENDING: 1 } });
    await um.ready();
    story(f, 'chat-a', 15);
    const { idMap } = branchOf(f, 'chat-a', 'chat-b', 6);
    await um.branchCreated('chat-a', 'chat-b', idMap);
    assert.ok(![...f.files.keys()].some(k => k.includes('chat-b')), 'nothing to copy, nothing written');
    um.saveSettings({ ...um.settings(), connection: 'conn-a', window: 4 });
    um.setChatEnabled('chat-a', true);
    await um.processChat('chat-a', { rebuild: true });
    await um.ensureChat('chat-a');
    const all = um.loadScenes('chat-a').scenes.length;
    const { idMap: m2 } = branchOf(f, 'chat-a', 'chat-c', 5);
    const out = await um.branchCreated('chat-a', 'chat-c', m2);
    assert.equal(out.matched, 5);
    assert.ok(out.scenes.scenes.length < all, `${out.scenes.scenes.length} of ${all}`);
    assert.ok(out.scenes.scenes.every(s => s.end <= 5));
});

test('a broken destination file or the same chat is refused and left untouched', async () => {
    const { f, um } = makeEnv();
    await um.ready();
    story(f, 'chat-a', 4);
    f.files.set(`${U}:memory/chats/chat-b.json`, '{bad');
    assert.equal((await um.branchCreated('chat-a', 'chat-b', {})).skipped, true);
    assert.equal(f.files.get(`${U}:memory/chats/chat-b.json`), '{bad');
    assert.match((await um.branchCreated('chat-a', 'chat-a', {})).error, /원본 방/);
    assert.match((await um.branchCreated('chat-a', '../x', {})).error, /invalid chat id/);
});
