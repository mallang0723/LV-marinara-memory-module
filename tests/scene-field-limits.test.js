import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchScenes, patchRecall } from '../src/memory/core-patch.mjs';
import { patchMemory } from '../src/memory/ui/patch.mjs';
import S from '../src/memory/core/scenes.generated.cjs';
import L from '../src/memory/core/ledger.cjs';
import TR from '../src/memory/core/translate.cjs';
import { fake } from './fake.js';
import { replyFor } from './fake-model.js';
import { story, waitUntil } from './env.js';
import { start } from '../src/backend.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const english = (prefix, length) => (prefix + ' during the long journey through the northern countryside').padEnd(length, 'x').slice(0, length);
const fields = { time: english('Late afternoon', 100), place: english('The old library', 100), weather: english('Light rain', 50) };
const eventTime = english('Just before sunset', 70);

function fold(values = fields, at = eventTime) {
    const store = S.emptyStore();
    store.cast = ['Alice'];
    store.scenes.push({ id: 'S1', start: 1, end: 1, events: [], recollections: [] });
    store.nextScene = 2;
    const slice = L.prepareMessages([{ id: 'm2', number: 2, role: 'assistant', speaker: 'Alice', content: 'Alice keeps a brass key in the library.' }]);
    const applied = S.applyScenes(store, { scenes: [{
        end: 2, ...values, title: 'A discovery', summary: 'Alice finds the key.', present: ['Alice'],
        events: [{ text: 'Alice finds the key.', time: at, quotes: [{ n: '2.1', q: 'brass key' }] }],
        facts: [{ about: 'Alice', text: 'Keeps a brass key.', evidence: [{ n: '2.1', q: 'brass key' }] }],
        learned: [{ who: 'Alice', scene: 'S1', what: 'The key opens the library.' }],
        later: [{ scene: 'S1', by: 'Alice', what: 'The key belongs to the library.' }],
    }] }, slice, 2);
    assert.ok(!applied.error, applied.error);
    return applied;
}

test('folding preserves long English fields and all explicit scene-time copies', () => {
    const applied = fold();
    for (const [key, value] of Object.entries(fields)) assert.equal(applied.scenes[0][key], value);
    assert.equal(applied.scenes[0].events[0].time, eventTime);
    for (const key of ['facts', 'learned', 'later']) {
        assert.equal(applied[key].length, 1, key);
        assert.equal(applied[key][0].when, fields.time, key);
    }
});

test('new caps still bound oversized input, preserving existing whitespace/null handling', () => {
    const applied = fold({ time: 't'.repeat(121), place: 'p'.repeat(121), weather: 'w'.repeat(61) }, 'e'.repeat(81));
    assert.equal(applied.scenes[0].time, 't'.repeat(120));
    assert.equal(applied.scenes[0].place, 'p'.repeat(120));
    assert.equal(applied.scenes[0].weather, 'w'.repeat(60));
    assert.equal(applied.scenes[0].events[0].time, 'e'.repeat(80));
    for (const key of ['facts', 'learned', 'later']) assert.equal(applied[key][0].when, 't'.repeat(120));
    const cleaned = fold({ time: '  Late\n afternoon  ', place: 'none', weather: null });
    assert.equal(cleaned.scenes[0].time, 'Late afternoon');
    assert.equal(cleaned.scenes[0].place, null);
    assert.equal(cleaned.scenes[0].weather, null);
});

test('inferred knowledge uses the same extended scene time', () => {
    const store = S.emptyStore();
    store.cast = ['하루'];
    store.facts.push({ id: 'F1', text: '책상 아래 일기장을 숨겼다', unaware: ['하루'] });
    const slice = L.prepareMessages([{ id: 'm1', number: 1, speaker: '하루', role: 'assistant', content: '하루는 책상 아래 일기장을 숨겼다는 것을 알고 있다.' }]);
    const applied = S.applyScenes(store, { scenes: [{ end: 1, ...fields, title: '발견', summary: '알아챘다.' }] }, slice, 1);
    assert.ok(!applied.error, applied.error);
    assert.equal(applied.learned.length, 1);
    assert.equal(applied.learned[0].quiet, true);
    assert.equal(applied.learned[0].when, fields.time);
});

test('each core anchor fails loudly when missing or duplicated, including inferred learned time', () => {
    const original = read('src/memory/core/scenes.cjs');
    const lines = original.split('\n').filter(line => /cleanText\((?:item\.(?:time|place|weather)|e\?\.time),/.test(line));
    assert.equal(lines.length, 8);
    for (const line of lines) {
        assert.throws(() => patchScenes(original.replace(line, '')), /patch anchor .* found 0 time\(s\), expected 1/);
        assert.throws(() => patchScenes(original + '\n' + line), /patch anchor .* found 2 time\(s\), expected 1/);
    }
    assert.throws(() => patchScenes(patchScenes(original)), /patch anchor/);
    const recall = read('src/memory/core/recall.cjs');
    assert.throws(() => patchRecall(recall.replace("require('./scenes.cjs')", 'null')), /found 0/);
    assert.throws(() => patchRecall(recall + "\nrequire('./scenes.cjs')"), /found 2/);
});

function koreanSceneHTML(store) {
    // Exercise actual patched renderers, with the Korean display translations populated.
    const runtime = patchMemory({ runtime: read('src/memory/ui/runtime.orig.js'), uiCss: '', themeCss: '', version: 'test' })
        .replace('export function mountMemory', 'function mountMemory')
        .replace('  install();\n  host.onCleanup?.(cleanup);', `  return value => {
            store = value; info = { chatLang: 'en', threads: [] };
            selectedScene = store.scenes[0].id;
            trMap = Object.fromEntries(${JSON.stringify(TR.displayTexts(store))}.map(text => [text, '한국어 번역']));
            return viewScenes();
        };`);
    return vm.runInNewContext(runtime + '\nmountMemory({}, {});', {})(store);
}

test('service folding, persisted edit route, prompt and Korean library keep full field values', async t => {
    const f = fake();
    const stop = start(f.api, { store: { debounceMs: 0 }, tunables: { SCENE_MIN_PENDING: 1 } });
    t.after(stop);
    story(f, 'chat-a', 15);
    f.model = async ({ messages }) => {
        const reply = JSON.parse(replyFor(messages));
        for (const scene of reply.scenes || []) {
            Object.assign(scene, fields);
            for (const event of scene.events) event.time = eventTime;
        }
        return JSON.stringify(reply);
    };
    const rpc = async (method, path, body) => {
        const response = await f.rpc(method, 'memory-module/' + path, body);
        assert.equal(response.ok, true, response.error);
        return response.data;
    };
    await f.rpc('POST', 'ext/settings', { window: 4 });
    await rpc('POST', 'settings', { connection: 'conn-a' });
    await rpc('POST', 'chats/chat-a/start', {});
    await waitUntil(async () => (await rpc('GET', 'chats/chat-a')).sceneJob.state === 'done');
    let store = await rpc('GET', 'chats/chat-a/scenes');
    for (const scene of store.scenes) {
        for (const [key, value] of Object.entries(fields)) assert.equal(scene[key], value);
        assert.equal(scene.events[0].time, eventTime);
    }
    // Different full-length values prove edits are saved, not simply read back from folding.
    const editedFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, 'New ' + value.slice(4)]));
    const scene = store.scenes[0];
    await rpc('PATCH', `chats/chat-a/scenes/${scene.id}`, { ...editedFields, events: [{ ...scene.events[0], time: eventTime }] });
    store = await rpc('GET', 'chats/chat-a/scenes');
    const html = koreanSceneHTML(store);
    assert.match(html, /한국어 번역/);
    assert.doesNotMatch(html, /maxlength=/i);
    const prompt = (await rpc('GET', 'chats/chat-a')).rendered;
    for (const [key, value] of Object.entries(editedFields)) {
        assert.equal(store.scenes[0][key], value, key);
        assert.ok(html.includes(`value="${value}"`), `Korean editor ${key}`);
        assert.ok(prompt.includes(value), `renderLedger ${key}`);
    }
    assert.ok(html.includes(`<span>${editedFields.time}</span>`), 'scene shelf keeps every word');
    assert.ok(html.includes(`value="${eventTime}"`));
    assert.ok(prompt.includes(eventTime));
    const translated = TR.translateText(prompt, 'ko', () => null);
    for (const value of Object.values(editedFields)) assert.ok(translated.text.includes(value), 'Korean fallback preserves original');
    const header = `${editedFields.time} · ${editedFields.place} · ${editedFields.weather}`;
    assert.deepEqual(TR.readTranslation({ lines: [header] }, [header]), [header], 'translation validation has no old field cap');
    assert.ok([...f.files.values()].some(value => value.includes(editedFields.time)), 'edit flushed to storage');
});
