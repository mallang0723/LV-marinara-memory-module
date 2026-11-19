// 「하단 블록 빼고 읽기」: the strip function, the fingerprint staying the stored text's, off = unchanged. Synthetic text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeEnv, story } from './env.js';
import { fake } from './fake.js';
import { createEngine } from '../src/adapter/engine.js';
import { createTranslatorLink, hashText as fnv } from '../src/adapter/translator.js';

const require = createRequire(import.meta.url);
const HB = require('../src/adapter/hide-blocks.cjs');
const L = require('../src/memory/core/ledger.cjs');
const FX = JSON.parse(readFileSync(new URL('./fixtures/translator-contract.json', import.meta.url), 'utf8'));
const strip = (t, o) => HB.stripHiddenBlocks(t, o);
const P = '<prose>\nThe lamp flickered. "Stay," she said.\n</prose>';
const ST = '<status wi-exclude>\n<summary>Place: hall</summary>\n<details>Inventory: key</details>\n</status>';

const CASES = [
    ['plain text untouched', 'Just a line.', 'Just a line.'],
    ['no tags untouched', 'a < b and c > d', 'a < b and c > d'],
    ['status block removed, prose kept', `${P}\n\n${ST}`, P],
    ['block first', `${ST}\n\n${P}`, P],
    ['name-suffixed status', `${P}\n\n<status:Mira wi-exclude>\n<summary>x</summary>\n</status:Mira>`, P],
    ['two suffixed blocks of the same name', `${P}\n<status:A wi-exclude>a</status:A>\n<status:B wi-exclude>b</status:B>`, P],
    ['nested details inside', `${P}\n<tracker wi-exclude>\n<details>a<details>b</details>c</details>\n</tracker>`, P],
    ['same-name nesting pairs by depth', `${P}\n<threads wi-exclude>\n<threads>x</threads>\ny\n</threads>\nafter`, `${P}\n\nafter`],
    ['meanwhile kept even with wi-exclude', `${P}\n<meanwhile wi-exclude>\nElsewhere.\n</meanwhile>`, `${P}\n<meanwhile wi-exclude>\nElsewhere.\n</meanwhile>`],
    ['diary kept', `<diary wi-exclude>dear diary</diary>`, `<diary wi-exclude>dear diary</diary>`],
    ['diaries kept', `<diaries wi-exclude>x</diaries>`, `<diaries wi-exclude>x</diaries>`],
    ['true_thoughts without wi-exclude kept', `${P}\n<true_thoughts>\nI should go.\n</true_thoughts>`, `${P}\n<true_thoughts>\nI should go.\n</true_thoughts>`],
    ['same name without wi-exclude stays', `<status>\n<summary>kept</summary>\n</status>`, `<status>\n<summary>kept</summary>\n</status>`],
    ['no closing tag: untouched', `${P}\n<status wi-exclude>\nnever closed`, `${P}\n<status wi-exclude>\nnever closed`],
    ['mention in backticks does not start a block', `Plan: use \`<visuals wi-exclude>\` later.\n${P}\n</visuals>`, `Plan: use \`<visuals wi-exclude>\` later.\n${P}\n</visuals>`],
    ['mention mid-line does not start a block', `see <visuals wi-exclude> here ${P} </visuals>`, `see <visuals wi-exclude> here ${P} </visuals>`],
    ['block right after a closing tag', `<ad-stat>x</ad-stat><scene_plan wi-exclude>plan</scene_plan>\n${P}`, `<ad-stat>x</ad-stat>\n${P}`],
    ['indented block start', `${P}\n   <bond wi-exclude>b</bond>`, P],
    ['attribute order', `${P}\n<psych class="a" wi-exclude id="b">z</psych>`, P],
    ['wi-exclude as value text is not the attribute', `<x data-note="wi-exclude">k</x>`, `<x data-note="wi-exclude">k</x>`],
    ['uppercase tag', `${P}\n<STATUS wi-exclude>s</STATUS>`, P],
    ['style removed always', `<style>.a{color:red}</style>\n${P}`, P],
    ['style without wi-exclude mid-line stays', `text <style>.a{}</style> text`, `text <style>.a{}</style> text`],
    ['three blank lines collapse to two (only when stripped)', `A\n\n\n\n${ST}\n\n\n\nB`, `A\n\nB`],
    ['untouched message keeps its blank lines', `A\n\n\n\nB`, `A\n\n\n\nB`],
    ['self-closing is not a block', `<face wi-exclude/>\n${P}`, `<face wi-exclude/>\n${P}`],
];
for (const [name, input, want] of CASES) test(`strip: ${name}`, () => assert.equal(strip(input, {}), want));

test('strip: extra tags (no wi-exclude) are removed; keep list is the room\'s', () => {
    assert.equal(strip(`<ad-stat>\nHP 5\n</ad-stat>\n${P}`, { extra: ['ad-stat'] }), P);
    assert.equal(strip(`<stat>x</stat>${P}`, { extra: 'ad-stat, stat' }), P);
    assert.equal(strip(`${P}\n<status wi-exclude>s</status>`, { keep: ['status'] }), `${P}\n<status wi-exclude>s</status>`);
    assert.equal(strip(`${P}\n<meanwhile wi-exclude>m</meanwhile>`, { keep: [] }), P, 'an emptied keep list keeps nothing');
    assert.deepEqual(HB.tagsOf(undefined), { extra: [], keep: ['meanwhile', 'diary', 'diaries'] });
    assert.deepEqual(HB.cleanList('A, b-c, <d>, 9x, ;;'), ['a', 'b-c', 'd']);
});

test('readableContent never empties a message and keeps the stored text beside the story', () => {
    assert.deepEqual(HB.readableContent(ST, {}), { content: ST }, 'blocks only: read as it is');
    const r = HB.readableContent(`${P}\n${ST}`, {});
    assert.equal(r.content, P); assert.equal(r.rawContent, `${P}\n${ST}`);
    assert.deepEqual(HB.readableContent(P, {}), { content: P }, 'nothing to strip: no rawContent key');
});

const rows = () => [
    { role: 'user', name: '서아', content: 'Seoa asks Haru to stay.' },
    { role: 'assistant', name: '하루', content: `${P}\n\n${ST}\n\n<meanwhile wi-exclude>\nA bell rings elsewhere.\n</meanwhile>` },
    { role: 'user', name: '서아', content: 'She nods.' },
    { role: 'assistant', name: '하루', content: ST },
    { role: 'user', name: '서아', content: 'ok' },
    { role: 'assistant', name: '하루', content: `${P}\n<tracker wi-exclude>t</tracker>` },
];
const msgs = e => e.um.u.run(() => e.um.svc.chatMessages('chat-a'));
const setMode = (e, mode) => { const s = e.um.settings(); e.um.saveSettings({ ...s, chats: { ...(s.chats || {}), 'chat-a': { ...(s.chats?.['chat-a'] || {}), features: mode ? { hideBlocks: mode } : {} } } }); };

test('off by default: listMessages carries no new key and the fingerprints are the stored text\'s', async () => {
    const e = makeEnv({ fakeOpts: { lean: true } });
    e.f.addMessages('chat-a', rows());
    await e.um.ready(); await e.um.preloadRoom('chat-a');
    const list = await e.um.u.run(() => e.um.svc._test.engine().then(en => en.chats.listMessages('chat-a'))).catch(() => null);
    const direct = await e.inst.u.eng.engine.chats.listMessages('chat-a');
    assert.ok(direct.every(r => !('rawContent' in r)), 'no rawContent when off');
    assert.deepEqual(direct.map(r => Object.keys(r).sort().join()), direct.map(() => 'activeSwipeIndex,characterId,content,extra,id,lv,role,rowid'));
    assert.equal(direct[1].content, rows()[1].content);
    const m = await msgs(e);
    assert.equal(m.length, 6);
    assert.equal(m[1].h, L.hashText(rows()[1].content));
    assert.ok(m.every(x => !('rawContent' in x)));
});

test('on: the story is read without the blocks, the fingerprint stays the stored text\'s (no "원문 변경됨" on switching)', async () => {
    const e = makeEnv({ fakeOpts: { lean: true } });
    e.f.addMessages('chat-a', rows());
    await e.um.ready(); await e.um.preloadRoom('chat-a');
    const before = await msgs(e);
    setMode(e, 'on');
    const after = await msgs(e);
    assert.deepEqual(after.map(m => m.h), before.map(m => m.h), 'h identical on and off');
    assert.ok(after.every(m => !('rawContent' in m)), 'rawContent is not left on the prepared messages');
    assert.ok(!/Place: hall|Inventory|>t</.test(after[1].content + after[5].content));
    assert.ok(after[1].content.includes('Stay,'), 'prose kept');
    assert.ok(after[1].content.includes('A bell rings elsewhere'), 'meanwhile kept');
    assert.equal(after[3].content, before[3].content, 'a message that is only blocks is read as it is, never dropped');
    assert.equal(after.length, before.length);
    // reconcile: a ledger folded while off sees no change once on
    const reconcile = L.reconcile;
    const ledger = { processed: before.map(m => ({ id: m.id, h: m.h })), batches: [], };
    assert.equal(reconcile(ledger, after).rolledBack, false);
    setMode(e, 'off');
    assert.deepEqual((await msgs(e)).map(m => [m.content, m.h]), before.map(m => [m.content, m.h]), 'turning it off restores the earlier reading');
});

test('room tags: saved by the extension route, read by the next listing, shown on the feature row', async () => {
    const e = makeEnv({ fakeOpts: { lean: true } });
    e.f.addMessages('chat-a', [{ role: 'assistant', name: '하루', content: `<ad-stat>\nHP\n</ad-stat>\n${P}` }, { role: 'user', name: '서아', content: 'hi' }]);
    await e.um.ready(); await e.um.preloadRoom('chat-a');
    setMode(e, 'on');
    assert.ok((await msgs(e))[0].content.includes('HP'), 'not listed: kept');
    await e.inst.saveHideBlocks('chat-a', { extra: 'ad-stat', keep: 'meanwhile' });
    assert.ok(!(await msgs(e))[0].content.includes('HP'));
    const info = await e.rpc('GET', 'chats/chat-a');
    const row = info.features.find(f => f.key === 'hideBlocks');
    assert.deepEqual(row.tags, { extra: ['ad-stat'], keep: ['meanwhile'] });
    assert.equal(row.default, false); assert.equal(row.enabled, true);
    assert.throws(() => e.inst.saveHideBlocks('../x', {}), /chatId/);
});

test('switch via the stock routes: default off, room on', async () => {
    const e = makeEnv({ fakeOpts: { lean: true } });
    e.f.addMessages('chat-a', rows());
    let info = await e.rpc('GET', 'chats/chat-a');
    const f0 = info.features.find(f => f.key === 'hideBlocks');
    assert.equal(f0.label, '하단 블록 빼고 읽기'); assert.equal(f0.enabled, false);
    await e.rpc('POST', 'chats/chat-a/feature-mode', { key: 'hideBlocks', mode: 'on' });
    info = await e.rpc('GET', 'chats/chat-a');
    assert.equal(info.features.find(f => f.key === 'hideBlocks').enabled, true);
});

test('translator: pub hash is checked against the stored text and the translation survives when on', async () => {
    const f = fake({ lean: true });
    f.rpcPool.peers.set('st_translator.contract', JSON.parse(JSON.stringify(FX.contract)));
    const content = `${FX.content}\n\n${ST}`;
    const rowsF = story(f, 'chat-a', 4);
    const reply = rowsF.at(-1);
    reply.content = content; reply.swipes = [content];
    reply.metadata = { st_translator: { v: 1, pub: { ...JSON.parse(JSON.stringify(FX.pub)), h: fnv(content) } } };
    const translator = createTranslatorLink(f.api, { version: '1.4.2-lv.2' });
    const mk = hide => createEngine({ api: f.api, userId: 'u1', translator, getHideBlocks: () => hide });
    const off = (await mk(null).engine.chats.listMessages('chat-a')).at(-1);
    const on = (await mk({ extra: [], keep: HB.DEFAULT_KEEP }).engine.chats.listMessages('chat-a')).at(-1);
    assert.equal(off.extra.translation, FX.pub.text);
    assert.equal(on.extra.translation, FX.pub.text, 'translation kept');
    assert.equal(on.content, FX.content);
    assert.ok(!on.content.includes('status'));
    assert.equal(on.extra.translationSource, on.content, 'translationSource is what the library reads (service compares it to content)');
    assert.equal(on.rawContent, content);
});
