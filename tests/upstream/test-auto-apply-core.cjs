// Tracker auto-apply cases from upstream 8d5f090 (MIT tlsiddl).
const clone = v => JSON.parse(JSON.stringify(v));
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/memory/core/scenes.generated.cjs');
const L = require('../../src/memory/core/ledger.cjs');
const Tk = require('../../src/memory/core/trackers.cjs');
const EUNSEO = '은서', RAON = '라온', DAIN = '다인';
const sc = (id, end, extra = {}) => ({ id, start: end, end, time: null, events: [], present: [], recollections: [], summary: '', ...extra });
const dateOf = (scene) => L.parseClock(scene.time)?.date || null;
const cycleFile = (starts = ['2024-06-10']) => Tk.addItem(Tk.emptyTrackers(), { type: 'cycle', label: '은서 발정기', scope: 'person', people: [EUNSEO], cycle: { every: 30, length: 5, starts } });
const storyStore = () => ({ ...S.emptyStore(), cast: [EUNSEO, RAON, DAIN], scenes: [sc('S1', 3, { time: '24-07-16 (화)', summary: '은서의 발정기가 시작되었다.' })] });

test('trackers: a start the story states is recorded at once and listed; the suggestion counts as done', () => {
  const file = cycleFile();
  const next = Tk.suggest(file, storyStore(), dateOf, '2026-01-01T00:00:00.000Z', { auto: true });
  assert.deepEqual(next.items[0].cycle.starts, ['2024-06-10', '2024-07-16']);
  assert.equal(next.suggestions.length, 1);
  assert.equal(next.suggestions[0].status, 'done');
  assert.equal(next.suggestions[0].auto, true);
  assert.equal(next.applied.length, 1);
  assert.deepEqual({ ...next.applied[0], id: undefined }, { id: undefined, kind: 'tracker', sid: next.suggestions[0].id, trackerId: 'tk1', label: '은서 발정기', date: '2024-07-16', sceneId: 'S1', text: next.suggestions[0].text, appliedAt: '2026-01-01T00:00:00.000Z', dropped: [], undone: false });
  const view = Tk.appliedView(next);
  assert.equal(view.length, 1);
  assert.match(view[0].text, /은서 발정기 시작일 24-07-16/);
  // A second scan finds nothing to do.
  assert.equal(Tk.suggest(next, storyStore(), dateOf, undefined, { auto: true }), next);
});

test('trackers: without auto the suggestion stays open and nothing is recorded (as before)', () => {
  const next = Tk.suggest(cycleFile(), storyStore(), dateOf);
  assert.equal(next.suggestions[0].status, 'open');
  assert.deepEqual(next.items[0].cycle.starts, ['2024-06-10']);
  assert.deepEqual(next.applied, []);
});

test('trackers: undo restores the tracker exactly, ignores the suggestion and it is never applied again', () => {
  const file = cycleFile();
  const applied = Tk.suggest(file, storyStore(), dateOf, '2026-01-01T00:00:00.000Z', { auto: true });
  const undone = Tk.undoApplied(applied, applied.applied[0].id, '2026-01-02T00:00:00.000Z');
  assert.deepEqual(undone.items[0].cycle, file.items[0].cycle, 'the very same starts as before');
  assert.equal(undone.suggestions[0].status, 'ignored');
  assert.equal(undone.applied[0].undone, true);
  assert.deepEqual(Tk.appliedView(undone), []);
  assert.throws(() => Tk.undoApplied(undone, undone.applied[0].id), /이미 되돌렸습니다/);
  assert.throws(() => Tk.undoApplied(undone, 'ap_nope'), /찾지 못했습니다/);
  const again = Tk.suggest(undone, storyStore(), dateOf, undefined, { auto: true });
  assert.equal(again, undone, 'a scan after the undo does nothing');
  assert.deepEqual(Tk.autoApply(undone, undone.suggestions[0].id), undone, 'not even when asked directly');
  // Even if the answered suggestion itself was lost (the list is capped), the record of the undo still blocks it.
  const lost = clone(undone);
  lost.suggestions = [];
  const asked = Tk.suggest(lost, storyStore(), dateOf, undefined, { auto: true });
  assert.deepEqual(asked.items[0].cycle.starts, ['2024-06-10'], 'asked again, but not applied');
  assert.equal(asked.suggestions[0].status, 'open');
});

test('trackers: a start pushed out of the 12 kept comes back with the undo', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `2023-${String(i + 1).padStart(2, '0')}-10`);
  const file = cycleFile(twelve);
  const applied = Tk.suggest(file, storyStore(), dateOf, undefined, { auto: true });
  assert.equal(applied.items[0].cycle.starts.length, 12);
  assert.deepEqual(applied.applied[0].dropped, ['2023-01-10']);
  assert.ok(!applied.items[0].cycle.starts.includes('2023-01-10'));
  const undone = Tk.undoApplied(applied, applied.applied[0].id);
  assert.deepEqual(undone.items[0].cycle.starts, twelve);
});

test('trackers: undo after the user already removed the date, or deleted the tracker, changes nothing else', () => {
  const applied = Tk.suggest(cycleFile(['2024-05-01']), storyStore(), dateOf, undefined, { auto: true });
  const removed = Tk.removeStart(applied, 'tk1', '2024-07-16');
  const a = Tk.undoApplied(removed, removed.applied[0].id);
  assert.deepEqual(a.items[0].cycle.starts, ['2024-05-01']);
  const gone = Tk.deleteItem(applied, 'tk1');
  assert.deepEqual(gone.applied, [], 'the record goes with its tracker');
});

test('trackers: the history keeps the last 50; only fresh suggestions are applied, older open ones wait', () => {
  let file = cycleFile();
  file.suggestions = Array.from({ length: 55 }, (_, i) => ({ id: `sg${i}`, trackerId: 'tk1', date: Tk.addDays('2024-08-01', i), sceneId: 'S1', status: 'open', text: `t${i}`, createdAt: 'x' }));
  for (let i = 0; i < 55; i++) file = Tk.autoApply(file, `sg${i}`);
  assert.equal(Tk.MAX_APPLIED, 50);
  assert.equal(file.applied.length, 50);
  assert.equal(file.applied[0].sid, 'sg5');
  assert.equal(file.applied.at(-1).sid, 'sg54');
  // Old open suggestions are not applied by a later scan.
  const open = cycleFile();
  open.suggestions = [{ id: 'old', trackerId: 'tk1', date: '2024-07-01', sceneId: 'S0', status: 'open', text: 't', createdAt: 'x' }];
  const scanned = Tk.suggest(open, storyStore(), dateOf, undefined, { auto: true });
  assert.equal(scanned.suggestions.find((s) => s.id === 'old').status, 'open');
  assert.deepEqual(scanned.items[0].cycle.starts, ['2024-06-10', '2024-07-16'], 'only the one found now');
  assert.equal(scanned.applied.length, 1);
});

test('trackers: a branch keeps the list of what was applied', () => {
  const applied = Tk.suggest(cycleFile(), storyStore(), dateOf, undefined, { auto: true });
  assert.equal(Tk.forBranch(applied, storyStore()).applied.length, 1);
});

const room = (id, features = {}, global) => {
  settingsFor(id, { trackers: 'on', ...features }, global);
  X.saveScenes(id, { ...S.emptyStore(), cast: [EUNSEO, RAON, DAIN], scenes: [sc('S1', 3, { time: '24-07-16 (화)', summary: '은서의 발정기가 시작되었다.', present: [EUNSEO] })] });
};
const addCycle = (id) => call('POST /chats/:id/trackers', id, { action: 'add', item: { type: 'cycle', label: '은서 발정기', scope: 'person', people: [EUNSEO], cycle: { every: 30, length: 5, starts: ['2024-06-10'] } } });

