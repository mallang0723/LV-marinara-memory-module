// Ported from upstream tests/test-memory-expression.cjs (09d0699): prompt wiring and stored-memory preservation, not a real-model benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEnv } from './env.js';
const require = createRequire(import.meta.url);
const S = require('../src/memory/core/scenes.cjs');

test('all recall styles retain the same memory while discouraging repeated expression', async () => {
    const { f, um, U } = makeEnv();
    await um.ready();
    const chatId = 'expression';
    await um.ensureChat(chatId);
    const store = S.emptyStore();
    store.scenes = [{ id: 'S1', start: 1, end: 2, messages: [], title: '복귀 일정', summary: '목요일부터 다시 일하기로 했다.', events: [], recollections: [], present: [] }];
    um.saveScenes(chatId, store);
    await um.flush();
    const file = `${U}:memory/chats/${chatId}.scenes.json`;
    const saved = f.files.get(file);
    let previousBody;
    for (const style of ['quiet', 'natural', 'active', 'unknown']) {
        um.saveSettings({ ...um.settings(), chats: { [chatId]: { enabled: true } }, recallStyle: style });
        const rendered = um.renderLedger(chatId);
        assert.match(rendered, /목요일부터 다시 일하기로 했다/);
        assert.match(rendered, /do not retell, paraphrase or re-explain them in narration, inner thoughts or dialogue/);
        assert.match(rendered, /explicit question or requested correction/);
        assert.match(rendered, /specific answer the user asked to hear again/);
        assert.match(rendered, /Correct or restate that answer only; do not replay its already explained background, origin story or supporting anecdote in narration, inner thoughts or dialogue/);
        assert.match(rendered, /Unless the user explicitly asks to revisit that past event itself/);
        assert.match(rendered, /remain implicit in tone, familiarity, choices and reactions/);
        assert.match(rendered.split('[End of memory.')[1], /A requested correction is not permission to retell its background/);
        assert.match(rendered, /new development that changes their meaning/);
        assert.match(rendered, /decision that directly needs that detail now/);
        assert.match(rendered, /Do not repeatedly use the same remembered fact as the same rationale/);
        assert.match(rendered, /preserve its dates, elapsed time, counts and circumstances/);
        assert.match(rendered.split('[End of memory.')[1], /Keep already expressed facts implicit/);
        assert.doesNotMatch(rendered, /Their shared history should be felt in this reply|tease or press about them/);
        if (style === 'active') assert.match(rendered, /active remembering does not require spoken callbacks/);
        const body = rendered.slice(rendered.indexOf('\n\n') + 2, rendered.lastIndexOf('\n\n'));
        if (previousBody !== undefined) assert.equal(body, previousBody, 'style changes expression instructions, not remembered facts');
        previousBody = body;
        assert.equal(um.renderLedger(chatId), rendered, 'repeated reads keep memory available');
        assert.equal(f.files.get(file), saved, 'rendering never rewrites stored memory');
    }
    um.saveSettings({ ...um.settings(), chats: { [chatId]: { enabled: false } } });
    assert.equal(um.renderLedger(chatId), '', 'disabled room still injects nothing');
    um.saveSettings({ ...um.settings(), chats: { empty: { enabled: true } } });
    await um.ensureChat('empty');
    assert.equal(um.renderLedger('empty'), '', 'no instruction-only injection without memory');
});
