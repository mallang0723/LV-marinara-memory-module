// Pure upstream 8d5f090 tests (MIT tlsiddl); Lumiverse service cases live in release-1.3.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/memory/core/ledger.cjs');
const S = require('../../src/memory/core/scenes.generated.cjs');
const Cf = require('../../src/memory/core/conflicts.generated.cjs');
const DOHA = '도하', IAN = '이안', SOYUL = '소율';

// ---- the check ----
const kind = (a, b) => Cf.compare(a, b)?.kind || null;

test('check: the same thing with and without a negation, different numbers, colours, sides and opposite states', () => {
  assert.equal(kind('커피를 즐겨 마신다', '커피를 즐겨 마시지 않는다'), 'negation');
  assert.equal(kind('매운 음식을 잘 먹는다', '매운 음식을 못 먹는다'), 'negation');
  assert.equal(kind('He drinks coffee at home', 'He does not drink coffee at home'), 'negation');
  assert.equal(kind('동생이 7살이다', '동생이 9살이다'), 'number');
  assert.equal(kind('7월 3일에 도서관에서 만나기로 했다', '7월 9일에 도서관에서 만나기로 했다'), 'number');
  assert.equal(kind('머리카락이 검은색이다', '머리카락이 흰색이다'), 'value');
  assert.equal(kind('The cat is black and lives in the garden', 'The cat is white and lives in the garden'), 'value');
  assert.equal(kind('왼쪽 팔에 큰 흉터가 있다', '오른쪽 팔에 큰 흉터가 있다'), 'value');
  assert.equal(kind('아버지는 살아 계신다', '아버지는 돌아가셨다'), null, 'words the check does not know are not guessed at');
  assert.equal(kind('아버지는 살아 있다', '아버지는 죽었다'), 'value');
  assert.match(Cf.compare('동생이 7살이다', '동생이 9살이다').reason, /숫자가 다름: 7살 ↔ 9살/);
  assert.match(Cf.compare('머리카락이 검은색이다', '머리카락이 흰색이다').reason, /검정 ↔ 흰색/);
});

test('check: unrelated, merely different, updated and identical facts are not conflicts', () => {
  assert.equal(kind('커피를 마신다', '차를 마시지 않는다'), null, 'different things');
  assert.equal(kind('눈이 푸른색이다', '손이 크다'), null);
  assert.equal(kind('동생이 7살이다', '어머니가 40살이다'), null, 'different people in the sentence');
  assert.equal(kind('고양이를 키운다', '강아지를 키우지 않는다'), null);
  assert.equal(kind('이제는 커피를 마시지 않는다', '커피를 즐겨 마신다'), null, 'a fact that tells of a change is an update');
  assert.equal(kind('예전에는 커피를 즐겨 마셨다', '커피를 즐겨 마시지 않는다'), null);
  assert.equal(kind('He used to drink coffee', 'He does not drink coffee'), null);
  assert.equal(kind('항구 근처에 산다', '항구 근처에 오래 산다'), null);
  assert.equal(kind('커피를 즐겨 마신다', '커피를 즐겨 마신다'), null, 'identical');
  assert.equal(kind('', '커피를 즐겨 마신다'), null);
  assert.equal(kind('동생이 7살이다', '동생이 7살이다 (확실하다)'), null, 'the same number');
  assert.equal(kind('동생이 7살이다', '동생은 키가 크다'), null, 'no number to compare');
});

// ---- the facts of a room ----
const fact = (id, about, text, extra = {}) => ({ id, about, text, sceneId: 'S1', evidence: [], unaware: [], guess: [], edited: false, ...extra });
const storeOf = (facts, over = {}) => ({ ...S.emptyStore(), cast: [DOHA, IAN, SOYUL], personas: [], facts, scenes: [{ id: 'S1', start: 1, end: 2, title: '첫 장면', summary: '요약', present: [DOHA, IAN], events: [], recollections: [] }], ...over });
const base = () => storeOf([
  fact('F1', DOHA, '커피를 즐겨 마신다'),
  fact('F2', DOHA, '커피를 즐겨 마시지 않는다'),
  fact('F3', IAN, '커피를 즐겨 마시지 않는다'),
  fact('F4', DOHA, '동생이 7살이다'),
  fact('F5', DOHA, '동생이 9살이다'),
  fact('F6', DOHA, '항구 근처에 산다'),
]);

test('detect: only facts about the same person are compared; replaced ones and explicit replacements are left out', () => {
  const found = [...Cf.detect(base()).values()].map((c) => `${c.a}-${c.b}:${c.kind}`).sort();
  assert.deepEqual(found, ['F1-F2:negation', 'F4-F5:number']);
  const s = base();
  s.facts[0].replacedBy = 'F2';
  assert.deepEqual([...Cf.detect(s).values()].map((c) => `${c.a}-${c.b}`), ['F4-F5'], 'a replaced fact is no longer a live one');
  const t = base();
  t.facts[1].replaces = 'F1';
  assert.deepEqual([...Cf.detect(t).values()].map((c) => `${c.a}-${c.b}`), ['F4-F5'], 'a fact that says it replaces the other');
  assert.equal(Cf.detect(storeOf([fact('F1', '', '커피를 즐겨 마신다'), fact('F2', '', '커피를 즐겨 마시지 않는다')])).size, 0, 'no subject, no comparison');
  assert.equal(Cf.detect(null).size, 0);
});

test('fold: new conflicts open with ids that are not reused; a second look adds no duplicates and keeps the time stamp', () => {
  const store = base();
  const file = Cf.fold(store, null, '2026-01-01T00:00:00.000Z');
  assert.equal(file.conflicts.length, 2);
  assert.deepEqual(file.conflicts.map((c) => [c.id, c.a, c.b, c.about, c.status]), [['C1', 'F1', 'F2', DOHA, 'open'], ['C2', 'F4', 'F5', DOHA, 'open']]);
  const again = Cf.fold(store, file, '2026-02-02T00:00:00.000Z');
  assert.deepEqual(again, file, 'nothing changed: the very same file, time stamp included');
  // Answered, then looked at again.
  const answered = Cf.answer(file, 'C1', 'both', '2026-03-03T00:00:00.000Z');
  assert.equal(answered.conflicts[0].status, 'both');
  assert.equal(answered.conflicts[0].answeredAt, '2026-03-03T00:00:00.000Z');
  const later = Cf.fold(store, answered);
  assert.equal(later.conflicts.length, 2, 'an answered pair is not asked again');
  assert.equal(later.conflicts[0].status, 'both');
  // A new fact that disagrees gets the next number.
  store.facts.push(fact('F7', DOHA, '고양이를 키운다'), fact('F8', DOHA, '머리카락이 검은색이다'), fact('F9', DOHA, '머리카락이 흰색이다'));
  const grown = Cf.fold(store, later);
  assert.deepEqual(grown.conflicts.map((c) => c.id), ['C1', 'C2', 'C3']);
  assert.equal(grown.conflicts[2].kind, 'value');
});

test('fold: an open conflict goes away when the facts stop disagreeing or are gone; keep decisions stay even if a fact is temporarily absent (LV fix1)', () => {
  const store = base();
  let file = Cf.fold(store, null);
  file = Cf.answer(file, 'C2', 'keepA');
  // The user fixes F2 by hand: no longer a conflict.
  store.facts[1].text = '아침에만 커피를 즐겨 마신다';
  file = Cf.fold(store, file);
  assert.deepEqual(file.conflicts.map((c) => c.id), ['C2']);
  // LV fix1: a missing fact must not erase an exclusion decision.
  store.facts = store.facts.filter((f) => f.id !== 'F5');
  assert.deepEqual(Cf.fold(store, file).conflicts.map(c => c.id), ['C2']);
  // An answered one stays even if the wording changed.
  store.facts.push(fact('F5', DOHA, '동생이 8살이다'));
  const kept = Cf.fold(store, file);
  assert.deepEqual(kept.conflicts.map((c) => c.id), ['C2']);
  assert.equal(Cf.fold(store, file).conflicts[0].status, 'keepA');
});

test('fold: at most 30 stay open', () => {
  const facts = [];
  for (let i = 0; i < 40; i++) facts.push(fact(`F${i * 2 + 1}`, `인물${i}`, '약속 장소는 도서관이다'), fact(`F${i * 2 + 2}`, `인물${i}`, '약속 장소는 도서관이 아니다'));
  const file = Cf.fold(storeOf(facts), null);
  assert.equal(file.conflicts.filter((c) => c.status === 'open').length, Cf.MAX_OPEN);
});

test('answers: five statuses, a wrong one or a missing conflict is refused', () => {
  const file = Cf.fold(base(), null);
  for (const status of Cf.STATUSES) assert.equal(Cf.answer(file, 'C1', status).conflicts[0].status, status);
  assert.equal(Cf.answer(Cf.answer(file, 'C1', 'both'), 'C1', 'open').conflicts[0].answeredAt, undefined, 'reopened');
  assert.throws(() => Cf.answer(file, 'C1', 'whatever'), /중 하나여야/);
  assert.throws(() => Cf.answer(file, 'C9', 'both'), /찾지 못했습니다/);
  assert.equal(file.conflicts[0].status, 'open', 'the file given is not changed');
});

test('hidden: keeping the earlier hides the later and the other way round; nothing else hides anything; nothing is deleted', () => {
  const store = base();
  let file = Cf.fold(store, null);
  assert.deepEqual([...Cf.hiddenIds(file, store)], [], 'open: both stay');
  file = Cf.answer(Cf.answer(file, 'C1', 'keepA'), 'C2', 'keepB');
  assert.deepEqual([...Cf.hiddenIds(file, store)].sort(), ['F2', 'F4']);
  for (const status of ['both', 'dismissed', 'open']) assert.deepEqual([...Cf.hiddenIds(Cf.answer(file, 'C1', status), store)], ['F4']);
  assert.equal(store.facts.length, 6, 'no fact was deleted');
  assert.deepEqual([...Cf.hiddenIds(file, storeOf([]))], [], 'a fact that is gone hides nothing');
  assert.deepEqual([...Cf.hiddenIds(null, store)], []);
});

test('view: open ones first, both texts and scenes, answered ones after', () => {
  const store = base();
  const file = Cf.answer(Cf.fold(store, null), 'C1', 'both');
  const v = Cf.view(file, store);
  assert.equal(v.open, 1);
  assert.deepEqual(v.conflicts.map((c) => [c.id, c.status]), [['C2', 'open'], ['C1', 'both']]);
  assert.deepEqual([v.conflicts[0].aText, v.conflicts[0].bText, v.conflicts[0].aScene], ['동생이 7살이다', '동생이 9살이다', 'S1']);
  assert.deepEqual(Cf.view(null, store), { omittedAuto: 0, open: 0, conflicts: [] });
});

