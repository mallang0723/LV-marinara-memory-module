import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchMemory } from '../src/memory/ui/patch.mjs';
import { scrollFresh } from '../qa/feature-checks.mjs';

const source = patchMemory({ runtime: readFileSync(new URL('../src/memory/ui/runtime.orig.js', import.meta.url), 'utf8'), uiCss: '', themeCss: '', version: 'test' });
// Execute the production request/refresh/poll and view functions, without installing a DOM.
// A render invocation would replace #content.innerHTML; count those boundary crossings.
const instrumented = source.replace('export function mountMemory', 'function mountMemory')
    .replace('  function render() {', '  function render() { LV.rendered();')
    .replace('  install();\n  host.onCleanup?.(cleanup);', `  room = 'chat-a'; tab = 'facts'; open = true;
  info = { job: { state: 'idle' }, sceneJob: { state: 'idle' } };
  return {
    ensureConflicts, schedulePoll, backupPaper,
    move: (id, nextTab) => { room = id; tab = nextTab; },
    dispose: () => { disposed = true; },
    selected: items => { info = { selectedMemories: items }; return selectedMemoriesHtml(); },
    choose: element => { root = { querySelector: () => element }; return handle('restoreChoose'); },
    conflicts: () => conflicts,
  };`);
const fixture = { open: 1, conflicts: [{ id: 'C1', a: 'F1', b: 'F2', status: 'open', aText: '앞', bText: '뒤' }] };
function harness() {
    const h = { renders: 0, requests: [], timers: [], response: fixture, pending: null };
    const mount = vm.runInNewContext(instrumented + '\nmountMemory', {
        setTimeout(fn, delay) { h.timers.push({ fn, delay }); return h.timers.length; }, clearTimeout() {},
    });
    h.ui = mount({}, {
        rendered() { h.renders++; },
        async fetch(path) {
            h.requests.push(path);
            const value = h.pending ? await h.pending : path.endsWith('/conflicts') ? h.response : { job: { state: 'idle' }, sceneJob: { state: 'idle' } };
            return { ok: true, text: async () => JSON.stringify(value) };
        },
    });
    return h;
}

test('conflict re-entry refreshes data without replacing unchanged rows; real decisions and errors redraw', async () => {
    const h = harness();
    await h.ui.ensureConflicts();
    assert.equal(h.renders, 1);
    await h.ui.ensureConflicts();
    assert.equal(h.requests.length, 2, 'still fetch fresh decisions');
    assert.equal(h.renders, 1, 'unchanged rows keep their DOM, focus and scroll');
    h.response = { open: 0, conflicts: [{ ...fixture.conflicts[0], status: 'keepA' }] };
    await h.ui.ensureConflicts();
    assert.equal(h.renders, 2);
    assert.equal(h.ui.conflicts().conflicts[0].status, 'keepA');
    h.pending = Promise.reject(Error('offline'));
    await h.ui.ensureConflicts();
    assert.equal(h.renders, 3, 'failure hides the previous banner');
    assert.equal(h.ui.conflicts(), null);
    await h.ui.ensureConflicts();
    assert.equal(h.renders, 3, 'repeated failure does not redraw unchanged content');
});

test('overlapping identical conflict responses redraw only once', async () => {
    const h = harness();
    let release;
    h.pending = new Promise(resolve => { release = resolve; });
    const one = h.ui.ensureConflicts(), two = h.ui.ensureConflicts();
    release(fixture);
    await Promise.all([one, two]);
    assert.equal(h.renders, 1);
});

test('late conflicts cannot redraw another tab, overwrite another room, or redraw after disposal', async () => {
    for (const action of ['tab', 'room', 'dispose']) {
        const h = harness();
        let release;
        h.pending = new Promise(resolve => { release = resolve; });
        const request = h.ui.ensureConflicts();
        if (action === 'tab') h.ui.move('chat-a', 'world');
        if (action === 'room') h.ui.move('chat-b', 'facts');
        if (action === 'dispose') h.ui.dispose();
        release(fixture); await request;
        assert.equal(h.renders, 0, action);
        assert.equal(h.ui.conflicts() === null, action !== 'tab', action);
    }
});

test('idle polling only fetches room status and leaves conflict rows alone', async () => {
    const h = harness();
    await h.ui.ensureConflicts();
    h.ui.schedulePoll();
    assert.equal(h.timers[0].delay, 10000);
    await h.timers[0].fn();
    assert.equal(h.renders, 1);
    assert.deepEqual(h.requests, ['/api/memory-module/chats/chat-a/conflicts', '/api/memory-module/chats/chat-a']);
});

test('selected cards retain all source quotes but omit only a redundant summary', () => {
    const { ui } = harness();
    const item = { id: 'M1', title: '편지', summary: '하루가 편지를 건넸다.', parts: [{ text: '하루가 편지를 건넸다.' }] };
    let html = ui.selected([item]);
    assert.equal(html.split(item.summary).length - 1, 1);
    assert.match(html, /<blockquote>하루가 편지를 건넸다\.<\/blockquote>/);
    assert.match(html, /data-selected-id="M1"/);
    html = ui.selected([{ ...item, summary: '  하루가\n편지를 건넸다.  ' }]);
    assert.doesNotMatch(html, /<p>\s*하루가/);
    html = ui.selected([{ ...item, summary: '<요약> 편지로 마음을 전했다.' }]);
    assert.match(html, /<p>&lt;요약&gt; 편지로 마음을 전했다\.<\/p>/);
    assert.match(html, /<blockquote>하루가 편지를 건넸다\.<\/blockquote>/);
    html = ui.selected([{ ...item, summary: '첫째 둘째', parts: [{ text: '첫째' }, { text: '둘째' }] }]);
    assert.doesNotMatch(html, /<p>첫째 둘째/);
    assert.equal((html.match(/<blockquote>/g) || []).length, 2);
});

test('Korean backup button invokes the hidden input and is disabled during jobs', async () => {
    const { ui } = harness();
    const idle = ui.backupPaper({ running: false });
    assert.match(idle, /<button type="button" data-act="restoreChoose"[^>]*>백업 파일 고르기<\/button>/);
    assert.match(idle, /<input type="file"[^>]*hidden aria-label="백업 파일"/);
    assert.match(ui.backupPaper({ running: true }), /data-act="restoreChoose"[^>]*disabled/);
    let clicks = 0;
    await ui.choose({ click: () => { clicks++; } });
    assert.equal(clicks, 1);
});

test('QA scrolling re-resolves only detached rows; other failures remain failures', async () => {
    let queries = 0, scrolls = 0;
    await scrollFresh({
        async waitFor() { queries++; },
        async scrollIntoViewIfNeeded() { if (++scrolls === 1) throw Error('Element is not attached to the DOM'); },
    });
    assert.equal(queries, 2);
    assert.equal(scrolls, 2);
    await assert.rejects(scrollFresh({ async waitFor() {}, async scrollIntoViewIfNeeded() { throw Error('Timeout waiting for stable element'); } }), /Timeout/);
    await assert.rejects(scrollFresh({ async waitFor() {}, async scrollIntoViewIfNeeded() { throw Error('Element is not attached to the DOM'); } }, 0), /not attached/);
});
