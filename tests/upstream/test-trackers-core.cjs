// Pure upstream 8d5f090 tests (MIT tlsiddl); Lumiverse service cases live in release-1.3.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/memory/core/ledger.cjs');
const S = require('../../src/memory/core/scenes.generated.cjs');
const A = require('../../src/memory/core/aliases.cjs');
const Tk = require('../../src/memory/core/trackers.cjs');
const F = require('../../src/memory/core/features.cjs');
const T = require('../../src/memory/core/translate.cjs');
const EUNSEO = '은서', RAON = '라온', DAIN = '다인';
const cast = [EUNSEO, RAON, DAIN];

// ---- registry ----
test('registry: a switch, off by default, ready', () => {
  assert.equal(F.FEATURES.trackers.default, false);
  assert.equal(F.FEATURES.trackers.ready, true);
  assert.match(F.FEATURES.trackers.label, /트래커/);
  assert.equal(F.resolve({ chats: { t1: {} } }, 't1', 'trackers').enabled, false);
  assert.equal(F.resolve({ chats: { t1: { features: { trackers: 'on' } } } }, 't1', 'trackers').enabled, true);
});

// ---- date math ----
test('dates: YYYY-MM-DD and YY-MM-DD are read, real calendar dates only, leap years count', () => {
  assert.equal(Tk.parseDate('2024-07-16'), '2024-07-16');
  assert.equal(Tk.parseDate('24-07-16'), '2024-07-16');
  assert.equal(Tk.parseDate(' 24.7.6 '), '2024-07-06');
  assert.equal(Tk.parseDate('2024-02-29'), '2024-02-29');
  assert.equal(Tk.parseDate('2023-02-29'), null);
  assert.equal(Tk.parseDate('2100-02-29'), null, '2100 is not a leap year');
  assert.equal(Tk.parseDate('2000-02-29'), '2000-02-29');
  assert.equal(Tk.parseDate('24-13-01'), null);
  assert.equal(Tk.parseDate('내일'), null);
  assert.equal(Tk.parseDate(''), null);
  assert.equal(Tk.daysBetween('2024-02-28', '2024-03-01'), 2, 'a leap February');
  assert.equal(Tk.daysBetween('2023-02-28', '2023-03-01'), 1);
  assert.equal(Tk.daysBetween('2023-12-31', '2024-01-01'), 1);
  assert.equal(Tk.daysBetween('2024-03-01', '2024-02-28'), -2);
  assert.equal(Tk.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(Tk.addMonths('2023-01-31', 1), '2023-02-28');
  assert.equal(Tk.addMonths('2024-11-15', 3), '2025-02-15');
  assert.equal(Tk.addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(Tk.localDate(new Date(2024, 6, 5, 23, 59)), '2024-07-05');
});

const base = { label: '시험', scope: 'room', people: [], clock: 'story', inject: 'present', createdAt: '', updatedAt: '' };
const count = (start, firstDay = 1) => ({ ...base, id: 'c', type: 'count', label: '만난 지', count: { start, firstDay } });
const until = (target) => ({ ...base, id: 'u', type: 'until', until: { target } });
const cycle = (c) => ({ ...base, id: 'y', type: 'cycle', label: '주기', cycle: { every: 28, unit: 'day', length: 5, starts: [], predict: 'fixed', ...c } });

test('count: days since the start, the first day as 1 or 0; before the start it says so', () => {
  assert.equal(Tk.evaluate(count('2024-07-04'), '2024-07-16').short, '13일째');
  assert.equal(Tk.evaluate(count('2024-07-04', 0), '2024-07-16').short, '12일째');
  assert.equal(Tk.evaluate(count('2024-07-16'), '2024-07-16').short, '1일째');
  assert.equal(Tk.evaluate(count('2024-07-16', 0), '2024-07-16').short, '0일째');
  assert.equal(Tk.evaluate(count('2024-02-20'), '2024-03-05').short, '15일째', 'across a leap day');
  assert.equal(Tk.evaluate(count('2024-07-20'), '2024-07-16').short, '시작 전 D-4');
});

test('until: D-N, D-day, D+N', () => {
  assert.equal(Tk.evaluate(until('2024-07-19'), '2024-07-16').short, 'D-3');
  assert.equal(Tk.evaluate(until('2024-07-16'), '2024-07-16').short, 'D-day');
  assert.equal(Tk.evaluate(until('2024-07-14'), '2024-07-16').short, 'D+2');
  assert.equal(Tk.evaluate(until('2024-03-01'), '2024-02-28').short, 'D-2');
});

test('cycle: in the cycle k/length; fixed and average predictions; month unit; overdue; nothing recorded', () => {
  const c = cycle({ starts: ['2024-07-10'] });
  assert.equal(Tk.evaluate(c, '2024-07-10').short, '진행 중 (1/5일째)');
  assert.equal(Tk.evaluate(c, '2024-07-14').short, '진행 중 (5/5일째)');
  assert.equal(Tk.evaluate(c, '2024-07-15').short, '다음까지 D-23', 'fixed: every 28 days from 07-10 = 08-07');
  assert.equal(Tk.evaluate(c, '2024-08-07').short, '다음까지 D-day');
  assert.equal(Tk.evaluate(c, '2024-08-10').short, '예정일 3일 지남');
  // average of the last intervals (30 and 26 -> 28 -> same here; use 20 and 30 -> 25)
  const avg = cycle({ predict: 'average', starts: ['2024-05-01', '2024-05-21', '2024-06-20'] });
  assert.equal(Tk.evaluate(avg, '2024-06-26').short, '다음까지 D-19', 'mean 25 days: 06-20 + 25 = 07-15');
  const one = cycle({ predict: 'average', every: 30, starts: ['2024-06-20'] });
  assert.equal(Tk.evaluate(one, '2024-06-26').short, '다음까지 D-24', 'one start only: falls back to every');
  const month = cycle({ unit: 'month', every: 1, starts: ['2024-01-31'], length: 3 });
  assert.equal(Tk.evaluate(month, '2024-02-10').short, '다음까지 D-19', '31 Jan + 1 month = 29 Feb');
  const empty = cycle({});
  assert.equal(Tk.evaluate(empty, '2024-07-16').ok, false);
  const future = cycle({ starts: ['2024-07-20'] });
  assert.equal(Tk.evaluate(future, '2024-07-16').short, '다음까지 D-4');
  assert.equal(Tk.evaluate(cycle({ starts: ['2024-07-10', '2024-07-20'] }), '2024-07-12').short, '진행 중 (3/5일째)', 'a start after today is not the last one yet');
});

test('clocks: story uses the story date, real uses the given date; an unknown story date says so', () => {
  const items = [{ ...count('2024-07-04'), id: 'a' }, { ...count('2024-07-04'), id: 'b', clock: 'real' }];
  const known = Tk.view({ version: 1, items }, { story: '2024-07-16', real: '2025-01-01' });
  assert.equal(known[0].status.text, '13일째');
  assert.equal(known[1].status.text, '182일째');
  const unknown = Tk.view({ version: 1, items }, { story: null, real: '2024-07-05' });
  assert.equal(unknown[0].status.text, '이야기 날짜 모름');
  assert.equal(unknown[0].status.ok, false);
  assert.equal(unknown[0].line, '');
  assert.equal(unknown[1].status.text, '2일째');
});

// ---- items ----
test('items: add, edit, delete with checks; people become canonical; scope decides how many', () => {
  A.using({ people: { [EUNSEO]: { aliases: ['Eunseo'] } }, rev: 1 }, () => {
    let file = Tk.emptyTrackers();
    file = Tk.addItem(file, { type: 'count', label: '만난 지', scope: 'pair', people: ['Eunseo', RAON], count: { start: '24-07-04' } }, 'T0');
    assert.deepEqual(file.items[0].people, [EUNSEO, RAON]);
    assert.equal(file.items[0].count.start, '2024-07-04');
    assert.equal(file.items[0].count.firstDay, 1);
    assert.equal(file.items[0].id, 'tk1');
    assert.equal(file.items[0].clock, 'story');
    assert.equal(file.items[0].inject, 'present');
    assert.throws(() => Tk.addItem(file, { type: 'count', label: 'x', scope: 'pair', people: [EUNSEO], count: { start: '24-07-04' } }), /두 사람/);
    assert.throws(() => Tk.addItem(file, { type: 'count', label: 'x', scope: 'person', people: [], count: { start: '24-07-04' } }), /한 사람/);
    assert.throws(() => Tk.addItem(file, { type: 'count', label: '', count: { start: '24-07-04' } }), /이름/);
    assert.throws(() => Tk.addItem(file, { type: 'count', label: 'x', count: { start: '24-02-31' } }), /시작일/);
    assert.throws(() => Tk.addItem(file, { type: 'until', label: 'x' }), /목표일/);
    assert.throws(() => Tk.addItem(file, { type: 'nope', label: 'x' }), /종류/);
    assert.throws(() => Tk.addItem(file, { type: 'cycle', label: 'x', cycle: { every: 0 } }), /주기/);
    assert.throws(() => Tk.addItem(file, { type: 'cycle', label: 'x', cycle: { starts: ['아무때나'] } }), /시작일 형식/);
    assert.throws(() => Tk.addItem(file, { type: 'count', label: 'x', clock: 'moon', count: { start: '24-07-04' } }), /날짜 기준/);
    file = Tk.editItem(file, 'tk1', { label: '사귄 지', inject: 'always', count: { start: '24-07-05', firstDay: 0 } }, 'T1');
    assert.equal(file.items[0].label, '사귄 지');
    assert.equal(file.items[0].count.firstDay, 0);
    assert.equal(file.items[0].type, 'count', 'the type cannot change');
    assert.equal(file.items[0].createdAt, 'T0');
    file = Tk.addItem(file, { type: 'until', label: '시험', until: { target: '2024-08-01' } });
    assert.equal(file.items[1].id, 'tk2');
    file = Tk.deleteItem(file, 'tk1');
    assert.deepEqual(file.items.map((i) => i.id), ['tk2']);
    assert.throws(() => Tk.deleteItem(file, 'zz'), /찾지 못/);
    const full = Array.from({ length: Tk.MAX_ITEMS }, (_, i) => ({ id: `tk${i + 1}`, type: 'until', label: 'x', scope: 'room', people: [], clock: 'story', inject: 'present', until: { target: '2024-08-01' } }));
    assert.throws(() => Tk.addItem({ version: 1, items: full, suggestions: [] }, { type: 'until', label: 'y', until: { target: '2024-08-01' } }), /개까지/);
  });
});

test('cycle history: add, edit, remove, kept sorted and capped at 12; a date is kept once', () => {
  let file = Tk.addItem(Tk.emptyTrackers(), { type: 'cycle', label: '발정기', scope: 'person', people: [EUNSEO], cycle: { every: 30, length: 5 } });
  for (let i = 1; i <= 14; i++) file = Tk.addStart(file, 'tk1', `2024-${String(Math.ceil(i / 2)).padStart(2, '0')}-${i % 2 ? '01' : '15'}`);
  assert.equal(file.items[0].cycle.starts.length, 12);
  assert.equal(file.items[0].cycle.starts.at(-1), '2024-07-15');
  assert.equal(file.items[0].cycle.starts[0], '2024-02-01', 'the oldest two fell away');
  file = Tk.addStart(file, 'tk1', '2024-07-15');
  assert.equal(file.items[0].cycle.starts.length, 12, 'the same date is kept once');
  file = Tk.editStart(file, 'tk1', '2024-07-15', '2024-07-18');
  assert.equal(file.items[0].cycle.starts.at(-1), '2024-07-18');
  file = Tk.removeStart(file, 'tk1', '2024-07-18');
  assert.equal(file.items[0].cycle.starts.at(-1), '2024-07-01');
  assert.throws(() => Tk.removeStart(file, 'tk1', '2020-01-01'), /기록에 없습니다/);
  const c = Tk.addItem(Tk.emptyTrackers(), { type: 'count', label: 'x', count: { start: '24-07-01' } });
  assert.throws(() => Tk.addStart(c, 'tk1', '2024-07-02'), /주기 트래커만/);
});

test('from a scene: a count tracker starts on the date, a cycle gets a start, a new count tracker can be made, until cannot', () => {
  let file = Tk.addItem(Tk.emptyTrackers(), { type: 'count', label: '만난 지', count: { start: '24-01-01' } });
  file = Tk.addItem(file, { type: 'cycle', label: '주기', cycle: {} });
  file = Tk.addItem(file, { type: 'until', label: '시험', until: { target: '2024-08-01' } });
  let next = Tk.startFromDate(file, { trackerId: 'tk1', date: '2024-07-16' });
  assert.equal(next.items[0].count.start, '2024-07-16');
  next = Tk.startFromDate(file, { trackerId: 'tk2', date: '2024-07-16' });
  assert.deepEqual(next.items[1].cycle.starts, ['2024-07-16']);
  assert.throws(() => Tk.startFromDate(file, { trackerId: 'tk3', date: '2024-07-16' }), /D-day/);
  next = Tk.startFromDate(file, { label: '사귄 지', scope: 'pair', people: [EUNSEO, RAON], date: '2024-07-16' });
  assert.equal(next.items.at(-1).type, 'count');
  assert.equal(next.items.at(-1).count.start, '2024-07-16');
  assert.deepEqual(next.items.at(-1).people, [EUNSEO, RAON]);
});

// ---- the injected line ----
const lineFile = () => {
  let f = Tk.emptyTrackers();
  f = Tk.addItem(f, { type: 'count', label: '만난 지', scope: 'person', people: [DAIN], inject: 'always', count: { start: '2024-07-04' } });
  f = Tk.addItem(f, { type: 'count', label: '사귄 지', scope: 'pair', people: [EUNSEO, RAON], inject: 'present', count: { start: '2024-07-13' } });
  f = Tk.addItem(f, { type: 'cycle', label: '발정기', scope: 'person', people: [EUNSEO], inject: 'present', cycle: { every: 30, length: 5, starts: ['2024-07-15'] } });
  f = Tk.addItem(f, { type: 'until', label: '시험', scope: 'room', inject: 'present', until: { target: '2024-07-19' } });
  f = Tk.addItem(f, { type: 'until', label: '비밀', scope: 'room', inject: 'never', until: { target: '2024-07-19' } });
  f = Tk.addItem(f, { type: 'count', label: '실제', scope: 'room', inject: 'always', clock: 'real', count: { start: '2024-07-01' } });
  return f;
};

test('line: always first, then present ones whose people are all there (a room tracker always counts); never is never', () => {
  const file = lineFile();
  const at = (present, extra = {}) => Tk.injectionBlock(file, { present, story: '2024-07-16', real: '2024-07-31', ...extra });
  assert.equal(at([EUNSEO, RAON]), '[기록] 다인 만난 지 13일째 · 31일째 · 은서·라온 사귄 지 4일째 · 은서 발정기: 진행 중 (2/5일째) · 시험 D-3'.replace('· 31일째', '· 실제 31일째'));
  assert.equal(at([EUNSEO]), '[기록] 다인 만난 지 13일째 · 실제 31일째 · 은서 발정기: 진행 중 (2/5일째) · 시험 D-3', 'the pair needs both');
  assert.equal(at([]), '[기록] 다인 만난 지 13일째 · 실제 31일째 · 시험 D-3');
  assert.doesNotMatch(at([EUNSEO, RAON]), /비밀/);
  assert.equal(at([EUNSEO, RAON], { story: null }), '[기록] 실제 31일째', 'story-clock trackers say nothing without a story date');
  assert.equal(Tk.injectionBlock(null, { present: [] }), '');
  assert.equal(Tk.injectionBlock(Tk.emptyTrackers(), { present: [] }), '');
});

test('line: names are matched through the name table; the cap leaves out what does not fit', () => {
  A.using({ people: { [EUNSEO]: { aliases: ['Eunseo'] } }, rev: 2 }, () => {
    const file = Tk.addItem(Tk.emptyTrackers(), { type: 'count', label: '만난 지', scope: 'person', people: ['Eunseo'], count: { start: '2024-07-04' } });
    assert.deepEqual(file.items[0].people, [EUNSEO]);
    assert.equal(Tk.injectionBlock(file, { present: ['Eunseo'], story: '2024-07-16' }), '[기록] 은서 만난 지 13일째');
    assert.equal(Tk.injectionBlock(file, { present: [EUNSEO], story: '2024-07-16' }), '[기록] 은서 만난 지 13일째');
    assert.equal(Tk.injectionBlock(file, { present: [DAIN], story: '2024-07-16' }), '');
  });
  let file = Tk.emptyTrackers();
  for (let i = 0; i < 20; i++) file = Tk.addItem(file, { type: 'count', label: `기념일${i}`, scope: 'room', inject: 'always', count: { start: '2024-07-04' } });
  const line = Tk.injectionBlock(file, { present: [], story: '2024-07-16' });
  assert.ok(line.length <= Tk.INJECT_CHARS && line.startsWith('[기록] 기념일0 13일째'), line.length);
  assert.ok(!line.endsWith(' · '));
  assert.equal(Tk.injectionBlock(file, { present: [], story: '2024-07-16', max: 8 }), '', 'nothing fits');
  assert.equal(T.planLines(line, 'en')[0].kind, 'keep', 'never sent for translation');
});

// ---- suggestions ----
const sc = (id, end, extra = {}) => ({ id, start: end, end, time: null, events: [], present: [], recollections: [], summary: '', ...extra });
const dateOf = (scene) => L.parseClock(scene.time)?.date || null;

test('suggestions: a start the story states becomes an open suggestion; once; never twice; answered ones stay answered', () => {
  const file = Tk.addItem(Tk.emptyTrackers(), { type: 'cycle', label: '은서 발정기', scope: 'person', people: [EUNSEO], cycle: { every: 30, length: 5, starts: ['2024-06-10'] } });
  const store = { ...S.emptyStore(), cast, scenes: [
    sc('S1', 3, { time: '24-07-16 (화)', summary: '은서가 아침에 일어났다. 은서의 발정기가 시작되었다.' }),
    sc('S2', 6, { time: '24-07-17', summary: '라온은 책을 읽었다.', events: [{ text: '은서는 발정기 때문에 쉬었다.', quotes: [] }] }),
    sc('S3', 9, { time: '24-07-18', summary: '은서의 발정기는 아직 시작되지 않았다.' }),
    sc('S4', 12, { summary: '은서의 발정기가 시작됐다.' }),
    sc('S5', 15, { time: '24-07-20', summary: '라온의 발정기가 시작됐다.' }),
    sc('S6', 18, { time: '24-07-21', summary: '은서가 집에 왔다.' }),
  ] };
  const next = Tk.suggest(file, store, dateOf, 'N');
  assert.equal(next.suggestions.length, 1, 'only S1: a start word with the label word and the person, a date, no negation');
  assert.deepEqual({ ...next.suggestions[0], id: 'x' }, { id: 'x', trackerId: 'tk1', date: '2024-07-16', sceneId: 'S1', status: 'open', text: '은서 은서 발정기 시작을 24-07-16(으)로 기록할까요?', createdAt: 'N' });
  assert.equal(Tk.suggest(next, store, dateOf), next, 'no duplicate: nothing new, the same object');
  assert.deepEqual(next.items[0].cycle.starts, ['2024-06-10'], 'nothing is applied by itself');
  const ignored = Tk.answerSuggestion(next, next.suggestions[0].id, 'ignore');
  assert.equal(ignored.suggestions[0].status, 'ignored');
  assert.equal(Tk.suggest(ignored, store, dateOf), ignored, 'an ignored one is not asked again');
  assert.deepEqual(ignored.items[0].cycle.starts, ['2024-06-10']);
  assert.throws(() => Tk.answerSuggestion(ignored, ignored.suggestions[0].id, 'accept'), /이미 답한/);
  const accepted = Tk.answerSuggestion(next, next.suggestions[0].id, 'accept');
  assert.deepEqual(accepted.items[0].cycle.starts, ['2024-06-10', '2024-07-16']);
  assert.equal(accepted.suggestions[0].status, 'done');
  assert.equal(Tk.suggest(accepted, store, dateOf), accepted, 'a date already recorded is not suggested');
  assert.throws(() => Tk.answerSuggestion(next, 'nope', 'accept'), /찾지 못/);
  // Only cycle trackers are looked at, and a label with nothing but names and generic words has no keyword.
  const other = Tk.addItem(Tk.emptyTrackers(), { type: 'count', label: '발정기', count: { start: '24-07-01' } });
  assert.equal(Tk.suggest(other, store, dateOf), other);
  assert.deepEqual(Tk.keywordsOf({ label: '은서 주기', people: [EUNSEO] }), []);
  assert.deepEqual(Tk.keywordsOf({ label: '은서 발정기', people: [EUNSEO] }), ['발정기']);
  // A room-wide tracker needs no name in the sentence.
  const room = Tk.addItem(Tk.emptyTrackers(), { type: 'cycle', label: '장마', cycle: { every: 365, length: 30 } });
  const rainy = { ...S.emptyStore(), scenes: [sc('S1', 3, { time: '24-06-25', summary: '장마가 시작되었다.' })] };
  assert.equal(Tk.suggest(room, rainy, dateOf).suggestions[0].date, '2024-06-25');
  // Deleting the tracker removes its suggestions.
  assert.equal(Tk.deleteItem(next, 'tk1').suggestions.length, 0);
});

