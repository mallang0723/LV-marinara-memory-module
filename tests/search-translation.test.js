// 기억 검색 (1.2.0-lv.2 live QA B): memory is stored in English and the library shows the cached Korean translation, so a Korean query
// ("테오") used to find nothing although the Korean view shows 테오. Runs the real patched screen code (viewSearch) on a room whose
// scene / fact / open item are English, with the translation cache and the name table filled the way the routes fill them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchMemory } from '../src/memory/ui/patch.mjs';
import { replaceRange } from '../src/patch-util.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const original = read('src/memory/ui/runtime.orig.js');
const runtime = patchMemory({ runtime: original, uiCss: '', themeCss: '', version: 'test' })
    .replace('export function mountMemory', 'function mountMemory')
    .replace('  install();\n  host.onCleanup?.(cleanup);', `  return state => {
      room = 'chat-a'; store = state.store; info = { chatLang: 'en', threads: state.threads || [] };
      trMap = state.tr || {}; names = state.names || null; namesRoom = state.names ? 'chat-a' : '';
      return query => { searchQuery = searchDraft = query; return viewSearch(); };
  };`);
const mount = vm.runInNewContext(runtime + '\nmountMemory({}, {});', {});

const store = {
    scenes: [{ id: 'S1', title: 'Teo returns', summary: 'Teo comes back to the bakery.', events: [{ text: 'Teo apologises to Mina.', quotes: [] }], recollections: [] },
             { id: 'S2', title: 'Quiet evening', summary: 'Nothing happens.', events: [], recollections: [] }],
    chapters: [], arcs: [],
    facts: [{ id: 'F1', about: 'Teo', text: 'Teo keeps a brass key.' }, { id: 'F2', about: 'Mina', text: 'Mina likes tea.' }],
};
const threads = [{ id: 'T1', kind: 'promise', title: 'Promise to Teo', detail: 'Mina promised to visit Teo.' }];
const tr = {
    'Teo returns': '테오가 돌아오다', 'Teo comes back to the bakery.': '테오가 빵집으로 돌아온다.', 'Teo apologises to Mina.': '테오가 미나에게 사과한다.',
    'Teo keeps a brass key.': '테오는 놋쇠 열쇠를 갖고 있다.', 'Promise to Teo': '테오와의 약속', 'Mina promised to visit Teo.': '미나가 테오를 찾아가기로 약속했다.',
};
const ids = html => [...html.matchAll(/data-goto-(\w+)="(\w+)"/g)].map(m => `${m[1]}:${m[2]}`);
const count = html => Number(html.match(/(\d+)개 검색 결과/)?.[1]);

test('a Korean query finds English-stored scene, fact and open item through the cached translation', () => {
    const html = mount({ store, threads, tr })('테오');
    assert.deepEqual(ids(html).sort(), ['fact:F1', 'scene:S1', 'thread:T1']);
    assert.equal(count(html), 3);
    assert.match(html, /테오가 빵집으로 돌아온다/);      // the excerpt is the Korean the screen shows
});

test('English still works, with and without a translation cache', () => {
    for (const state of [{ store, threads, tr }, { store, threads }]) {
        const html = mount(state)('Teo');
        assert.deepEqual(ids(html).sort(), ['fact:F1', 'scene:S1', 'thread:T1']);
        assert.equal(count(html), 3);
    }
    assert.deepEqual(ids(mount({ store, threads, tr })('brass')), ['fact:F1']);   // English words that only the stored text has
    assert.match(mount({ store, threads, tr })('brass'), /Teo keeps a brass key/);
});

test('a record that matches in both languages is one hit, and a miss stays a miss', () => {
    const both = { ...tr, 'Mina likes tea.': 'Mina는 차를 좋아한다. 테오 Teo' };
    const html = mount({ store, threads, tr: both })('Teo');
    assert.equal(ids(html).filter(x => x === 'fact:F2').length, 1);
    assert.equal(ids(html).length, new Set(ids(html)).size);
    const none = mount({ store, threads, tr })('없는말');
    assert.equal(count(none), 0);
    assert.match(none, /일치하는 기억이 없습니다/);
    assert.equal(count(mount({ store, threads, tr })('')), NaN);
});

test('name table: a Korean alias or a 호칭 사전 pair finds the English record even when no translation holds it', () => {
    const names = { people: { Teo: { aliases: ['테오'] } }, address: { entries: [{ id: 'a1', term: 'Master', pairWith: 'a2' }, { id: 'a2', term: '주인님', pairOf: 'a1' }] } };
    let html = mount({ store, threads, names })('테오');            // no translation cache at all
    assert.deepEqual(ids(html).sort(), ['fact:F1', 'scene:S1', 'thread:T1']);
    assert.equal(count(html), 3);
    const withHonorific = { ...store, facts: [...store.facts, { id: 'F3', about: 'Mina', text: 'Mina calls him Master.' }] };
    html = mount({ store: withHonorific, threads, names })('주인님');
    assert.deepEqual(ids(html), ['fact:F3']);
    // an alias is exact: "테" alone is not a name
    assert.equal(count(mount({ store, threads, names })('테')), 0);
    // both routes at once (alias + translation) still give each record once
    html = mount({ store, threads, names, tr })('테오');
    assert.equal(ids(html).length, 3);
});

test('the search tab loads the name table, and the patch anchors fail loudly', () => {
    assert.match(runtime, /const needsNames = \(\) => \['names', 'life', 'search'\]\.includes\(tab\);/);
    assert.throws(() => replaceRange('a', 'x', 'y', ''), /patch range/);
    assert.throws(() => replaceRange('x y x', 'x', 'y', ''), /patch range/);
});
