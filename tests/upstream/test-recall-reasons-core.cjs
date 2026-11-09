// Pure cases from upstream 8d5f090 (MIT tlsiddl).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/memory/core/scenes.generated.cjs');
const F = require('../../src/memory/core/features.cjs');
const Rp = require('../../src/memory/core/reasons.cjs');
const HARANG = '하랑', SEOYUN = '서윤', JIHO = '지호';

// ---- the fixture: eight scenes (the window starts at message 19), facts, a chapter, open threads ----
const scene = (n, title, summary, present, extra = {}) => ({
  id: `S${n}`, start: n * 3 - 2, end: n * 3, messages: [], time: `3월 ${n}일`, place: '항구', title, summary, present,
  events: [{ text: `${title} 사건`, importance: 'normal', quotes: [], with: present }], recollections: [], edited: false, ...extra,
});
const fact = (id, about, text, extra = {}) => ({ id, about, text, sceneId: 'S1', evidence: [], unaware: [], guess: [], edited: false, ...extra });
const base = () => ({
  ...S.emptyStore(),
  cast: [HARANG, SEOYUN, JIHO],
  personas: [],
  scenes: [
    scene(1, '부두의 열쇠', '하랑이 부두에서 서윤에게 놋쇠 열쇠를 맡겼다.', [HARANG, SEOYUN]),
    scene(2, '시장 소동', '지호가 시장에서 소란을 피웠다.', [JIHO]),
    scene(3, '등대 방문', '서윤이 오래된 등대를 찾아갔다.', [SEOYUN, JIHO]),
    scene(4, '비 오는 날', '셋이 처마 밑에서 비를 피했다.', [HARANG, SEOYUN, JIHO]),
    scene(5, '아침 식사', '하랑이 죽을 끓였다.', [HARANG]),
    scene(6, '편지', '서윤이 편지를 받았다.', [SEOYUN]),
    scene(7, '골목', '지호가 골목을 걸었다.', [JIHO]),
    scene(8, '귀가', '하랑과 지호가 집에 돌아왔다.', [HARANG, JIHO]),
  ],
  facts: [
    fact('F1', HARANG, '놋쇠 열쇠를 서윤에게 맡겼다'),
    fact('F2', SEOYUN, '등대 근처에서 자랐다'),
    fact('F3', JIHO, '시장 상인들과 친하다'),
  ],
  nextFact: 4,
  chapters: [{ id: 'C1', title: '첫 항구', time: '3월 1일~3월 3일', summary: '항구에 도착해 열쇠를 맡기는 이야기.', turns: [], keep: [], scenes: ['S1', 'S2', 'S3'] }],
  nextChapter: 2,
});
const threads = () => [
  { id: 'T1', kind: 'promise', title: '열쇠를 돌려주기', who: HARANG, toward: SEOYUN, detail: '다음 달에 돌려주기로 했다', status: 'open', openedAt: { number: 2 }, evidence: [{ number: 2 }], clues: [] },
  { id: 'T2', kind: 'secret', title: '등대의 비밀', who: SEOYUN, toward: null, detail: null, status: 'open', openedAt: { number: 8 }, evidence: [{ number: 8 }], clues: [] },
];
// ---- the module itself ----
test('built in: no switch, not in the registry', () => {
  assert.ok(F.BUILTIN.includes('recallReasons'));
  assert.equal(F.known('recallReasons'), false);
  assert.equal(F.resolve({ features: { recallReasons: false } }, 'a', 'recallReasons').enabled, true);
  assert.ok(!F.view({}, 'a').some((f) => f.key === 'recallReasons'));
});

test('marks: pinning and leaving out exclude each other, the same button takes it back, bad ids are refused, an old file shape is repaired', () => {
  let p = Rp.emptyPrefs();
  p = Rp.toggle(p, 'S2', 'excluded');
  assert.deepEqual(p, { version: 1, pinned: [], excluded: ['S2'] });
  p = Rp.toggle(p, 'S2', 'pinned');
  assert.deepEqual(p, { version: 1, pinned: ['S2'], excluded: [] }, 'pinning lifts it out of the left-out list');
  p = Rp.toggle(p, 'S2', 'pinned');
  assert.deepEqual(p, Rp.emptyPrefs());
  assert.throws(() => Rp.toggle(p, '../x', 'pinned'), /정할 수 없는/);
  assert.throws(() => Rp.toggle(p, 'S1', 'both'), /pinned 또는 excluded/);
  assert.deepEqual(Rp.normalize({ pinned: ['S1', 'S1', 'x', 7], excluded: ['S1', 'F2'] }), { version: 1, pinned: ['S1'], excluded: ['F2'] });
  assert.equal(Rp.kindOf('S3'), 'scene');
  assert.equal(Rp.kindOf('C1'), 'chapter');
  assert.equal(Rp.kindOf('F9'), 'fact');
  assert.equal(Rp.kindOf('T4'), 'thread');
});

test('marks: gone items drop silently, a kind that could not be read is kept, merged facts hand their mark on, a left-out chapter hides its scenes', () => {
  const store = base();
  const ledger = { threads: threads() };
  const ids = Rp.liveIds(store, ledger, S.liveFacts);
  const marks = { pinned: ['S1', 'S99', 'F2'], excluded: ['T1', 'T9', 'C1'] };
  assert.deepEqual(Rp.prune(marks, ids), { version: 1, pinned: ['S1', 'F2'], excluded: ['T1', 'C1'] });
  assert.deepEqual(Rp.prune(marks, ids, { ledger: false }).excluded, ['T1', 'T9', 'C1'], 'no ledger to check against: threads stay');
  store.facts[1].replacedBy = 'F3';
  assert.deepEqual(Rp.followMerges({ pinned: ['F2'], excluded: [] }, store).pinned, ['F3']);
  assert.deepEqual([...Rp.hiddenScenes(store, new Set(['C1', 'S5']))].sort(), ['S1', 'S2', 'S3', 'S5']);
  assert.equal(Rp.sets(marks).any, true);
  assert.equal(Rp.sets(null).any, false);
});

test('labels: short Korean text for every kind', () => {
  assert.equal(Rp.label({ kind: 'present', names: [HARANG, SEOYUN] }), `지금 장면에 ${HARANG}·${SEOYUN} 있음`);
  assert.equal(Rp.label({ kind: 'keyword', terms: ['부두'] }), '‘부두’ 언급');
  assert.equal(Rp.label({ kind: 'keyword', terms: [] }), '지금 대화와 낱말이 겹침');
  assert.equal(Rp.label({ kind: 'meaning', score: 0.713 }), '뜻이 비슷함 0.71');
  assert.equal(Rp.label({ kind: 'recent' }), '최근 장면');
  assert.equal(Rp.label({ kind: 'pinned' }), '고정');
  assert.equal(Rp.label({ kind: 'thread-open' }), '끝나지 않은 일');
  assert.equal(Rp.label({ kind: 'selected' }), '직접 선택한 기억');
  assert.equal(Rp.label({ kind: 'follow', from: 'S2' }), 'S2에 이어진 일');
  assert.equal(Rp.label({ kind: 'nonsense' }), '');
  assert.deepEqual(Rp.labelled([{ kind: 'recent' }, { kind: 'nonsense' }]), [{ kind: 'recent', label: '최근 장면' }]);
});

