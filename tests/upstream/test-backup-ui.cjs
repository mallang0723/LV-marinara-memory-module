// Upstream 8d5f090 backup UI assertions, using the patched Lumiverse runtime.
// Static preview fixtures here; actual preview/apply/undo routes are tested in release-1.3.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const B = require('../../src/memory/core/backup.generated.cjs');
const S = require('../../src/memory/core/scenes.generated.cjs');
const fixture = B.build({ chatId: 'roomA', chatName: '푸른/달: "방"?', files: { scenes: { ...S.emptyStore(), scenes: [{ id: 'S1' }, { id: 'S2' }], facts: [{ id: 'F1', text: '사실' }] } }, settingsEntry: null });
const preview = (backup, id) => ({ source: backup.header, sameRoom: id === 'roomA', crossRoomRequired: id !== 'roomA', backup: B.counts(backup.files), current: B.counts(backup.files), vectors: { inBackup: false, willClear: false }, removes: [], busy: false, undoAvailable: false });
test('file names are safe', () => {
  const d = new Date(2026, 0, 2, 3, 4);
  assert.equal(B.fileName('방 이름', d), '기억백업-방 이름-20260102-0304.json');
  assert.equal(B.fileName('', d), '기억백업-이름없음-20260102-0304.json');
  assert.doesNotMatch(B.fileName('../../x\\y:z*?"<>|', d), /[\\/:*?"<>|]/);
  assert.ok(B.fileName('가'.repeat(300), d).length < 80);
  assert.doesNotMatch(B.fileName('..', d), /-\.\.-/);
});

// ---- screen ----
const source = require('../upstream-ui.cjs')();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fn = (name) => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }\n', start);
  return vm.runInNewContext(`(${source.slice(start, end + 4).trim()})`, { esc, Date });
};

test('screen: backup button, vectors checkbox, preview with counts, two-click apply, cross-room checkbox, undo', async () => {
  const backup = fixture;
  const backupPaper = fn('backupPaper');
  const idle = backupPaper({ armed: '', preview: null, withVectors: false, running: false, undo: null });
  assert.match(idle, /data-act="backupDownload">백업 내려받기/);
  assert.match(idle, /id="setBackupVectors" >/);
  assert.match(idle, /검색 색인 포함 \(크기 큼\)/);
  assert.match(idle, /id="restoreFile"/);
  assert.doesNotMatch(idle, /restoreUndo|restoreApply/);
  assert.match(backupPaper({ armed: '', preview: null, withVectors: true, running: false, undo: null }), /id="setBackupVectors" checked/);
  assert.match(backupPaper({ armed: '', preview: null, withVectors: false, running: true, undo: null }), /id="restoreFile" accept="[^"]*" disabled/);

  const same = preview(backup, 'roomA');
  const html = backupPaper({ armed: '', preview: { room: 'roomA', data: same, cross: false }, withVectors: false, running: false, undo: null });
  assert.match(html, /장면: 백업 2 · 지금 2/);
  assert.match(html, /알게 된 사실: 백업 1/);
  assert.match(html, /푸른\/달: &quot;방&quot;\?/, 'room name escaped');
  assert.match(html, /data-act="restoreApply" >이 백업 불러오기/);
  assert.doesNotMatch(html, /restoreCross/);
  assert.match(backupPaper({ armed: 'restoreApply', preview: { room: 'roomA', data: same, cross: false }, running: false }), /한 번 더 누르면 백업을 불러옵니다/);

  const other = preview(backup, 'roomB');
  const blocked = backupPaper({ armed: '', preview: { room: 'roomB', data: other, cross: false }, running: false });
  assert.match(blocked, /id="restoreCross" >/);
  assert.match(blocked, /다른 방의 백업을 이 방에 적용/);
  assert.match(blocked, /data-act="restoreApply" disabled>/, 'cannot apply before the box is ticked');
  const ticked = backupPaper({ armed: '', preview: { room: 'roomB', data: other, cross: true }, running: false });
  assert.match(ticked, /id="restoreCross" checked/);
  assert.match(ticked, /data-act="restoreApply" >/);

  const undo = backupPaper({ armed: '', preview: null, running: false, undo: { at: '2026-01-02T03:04:00.000Z' } });
  assert.match(undo, /data-act="restoreUndo" >불러오기 되돌리기/);
  assert.match(backupPaper({ armed: 'restoreUndo', preview: null, running: false, undo: { at: '2026-01-02T03:04:00.000Z' } }), /한 번 더 누르면 불러오기를 되돌립니다/);
});

test('screen: the settings tab shows the backup section, and "처음부터 다시 정리" offers a backup first', () => {
  assert.match(source, /\$\{backupPaper\(\{/);
  assert.match(source, /armed === 'fresh' \? '<div class="note"[^']*먼저 백업 내려받기/);
  // The backup click keeps the "press once more" state of the dangerous button.
  assert.match(source, /'backupDownload', 'restoreApply', 'restoreUndo', 'addressDelete', 'stateReset', 'placeDelete', 'keepDelete', 'trackerDelete', 'trackerDropStart']\.includes\(actName\)\) armed = ''/);
  assert.match(source, /case 'backupDownload':/);
  assert.match(source, /\/restore\/preview/);
  assert.match(source, /\/restore\/apply/);
  assert.match(source, /\/restore\/undo/);
  assert.match(source, /createObjectURL/);
});
