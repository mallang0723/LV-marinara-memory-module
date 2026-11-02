// Lumiverse integration coverage for upstream 0.11.x: persistence, call routing and non-destructive repairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, story, waitUntil } from './env.js';
import { createMemoryService } from '../src/memory/service.js';
import { createRouter } from '../src/common/router.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
import L from '../src/memory/core/ledger.cjs';
import S from '../src/memory/core/scenes.cjs';
import { replyFor } from './fake-model.js';

async function setup(tunables = {}) {
    const env = makeEnv({ tunables });
    await env.um.ensureChat('chat-a');
    env.um.saveSettings({ connection: 'conn-a', embedding: null, recall: 'off', chats: { 'chat-a': { enabled: true } } });
    const router = createRouter();
    registerMemoryRoutes(router, env.svc);
    return { ...env, rpc: (method, path, body) => router.handle({ method, path: 'memory-module/' + path, body }, env.U) };
}

test('language settings, separate translation connection and Korean cache survive a new service instance', async () => {
    const { um, f, rpc, host, store, U } = await setup();
    story(f);
    const scenes = S.emptyStore();
    scenes.facts = [{ id: 'F1', text: 'They promised to meet on Saturday.' }];
    um.saveScenes('chat-a', scenes);
    await rpc('POST', 'settings/language', { writeLanguage: 'en', memoryLanguage: 'auto', translateConnection: 'conn-b', translateQuotes: true });
    f.model = async ({ messages }) => JSON.stringify({ lines: JSON.parse(messages[1].content).lines.map(() => '토요일에 만나기로 약속했다.') });
    await rpc('GET', 'chats/chat-a/translations');
    await waitUntil(() => !um.translating.size);
    assert.ok(f.state.modelCalls.length);
    assert.ok(f.state.modelCalls.every(call => call.connection_id === 'conn-b'));
    await um.flush();
    const fresh = createMemoryService({ host, store }).forUser(U);
    await fresh.ensureChat('chat-a');
    await fresh.chatLanguage('chat-a');
    assert.equal(fresh.writeLanguage('chat-a'), 'en');
    assert.equal(fresh.settings().translateConnection, 'conn-b');
    assert.equal(fresh.translationLookup('chat-a', 'ko')(scenes.facts[0].text), '토요일에 만나기로 약속했다.');
    assert.ok(fresh.displayTranslationTexts('chat-a').includes(scenes.facts[0].text));
    const previous = JSON.stringify(um.settings());
    await assert.rejects(rpc('POST', 'settings/language', { memoryLanguage: 'en', writeLanguage: 'bad' }));
    assert.equal(JSON.stringify(um.settings()), previous, 'invalid partial update changes nothing');
});

test('English writing instructions reach actual host generation for ledger and scenes', async () => {
    const { um, f } = await setup({ SCENE_MIN_PENDING: 1 });
    story(f, 'chat-a', 15);
    um.saveSettings({ ...um.settings(), writeLanguage: 'en', window: 4 });
    f.model = async ({ messages }) => {
        const system = messages[0].content;
        if (system.startsWith('너는 장기 롤플레이의 기억 관리자야')) {
            assert.match(messages.at(-1).content, /\[기록 언어\].*영어로 써/);
            return replyFor(messages, f.state.modelCounts);
        }
        return JSON.stringify({ lines: JSON.parse(messages[1].content).lines.map(line => 'English ' + line.length) });
    };
    await um.processChat('chat-a');
    assert.equal(um.jobStatus('chat-a').state, 'done');
    assert.equal(um.sceneJobs.get('chat-a').state, 'done');
    assert.ok(f.state.modelCounts.memory > 0 && f.state.modelCounts.scenes > 0);
    assert.ok(f.state.modelCalls.every(call => call.connection_id === 'conn-a'));
});

test('compact RP date survives the host adapter and reply preparation (upstream compact-date-flow)', async () => {
    const { um, f } = await setup();
    f.addMessages('chat-a', [{ role: 'user', content: '§RP|20250214|10:45|장소|날씨§ 본문' }]);
    assert.equal(L.storyTime(await um.chatMessages('chat-a')), '2025-02-14T10:45');
    await um.syncBeforeReply('chat-a');
    assert.equal(um.storyToday('chat-a', null), '2025-02-14');
});

test('translation never adds a second full budget before a reply; cached/source memory remains available', async () => {
    const { um, f } = await setup({ TRANSLATE_REPLY_MS: 1000 });
    const ledger = L.emptyLedger();
    ledger.routine = [{ who: '서아', what: 'meal', text: '토스트를 먹었다', at: '2025-02-14T08:00' }];
    um.saveLedger('chat-a', ledger);
    um.saveSettings({ ...um.settings(), memoryLanguage: 'en' });
    let release;
    f.model = ({ messages }) => new Promise(resolve => { release = () => resolve(JSON.stringify({ lines: JSON.parse(messages[1].content).lines.map(() => 'A translated line') })); });
    const started = Date.now();
    const out = await um.syncBeforeReply('chat-a', { budgetMs: 40 });
    assert.ok(Date.now() - started < 250);
    assert.match(out, /토스트/);
    assert.ok(release);
    release();
    await waitUntil(() => !um.translating.size);
    await um.flush();
});

test('resuming repairs recipient batches beyond 20 using the selected host connection', async () => {
    const { um, f } = await setup();
    f.addMessages('chat-a', Array.from({ length: 45 }, () => ({ role: 'assistant', content: '카시안이 이리나를 바라봤다.\n"Hello, sweetheart." (안녕, 여보.)' })));
    const messages = await um.chatMessages('chat-a');
    const st = S.emptyStore();
    st.covered = messages.map(({ id, h }) => ({ id, h }));
    const quotes = messages.map(m => ({ messageId: m.id, number: m.number, sentence: 2, text: '"Hello, sweetheart." (안녕, 여보.)', by: '카시안', to: null, recipientChecked: true }));
    quotes[44].to = '킬리안';
    st.scenes = [{ id: 'S1', start: 1, end: 45, messages: st.covered, present: ['카시안', '이리나', '킬리안'], events: [{ text: '인사를 했다', quotes }], recollections: [] }];
    um.saveScenes('chat-a', st);
    let calls = 0;
    f.model = async ({ messages }) => {
        if (!messages[0].content.includes('직접적인 수신자')) return JSON.stringify({ lines: JSON.parse(messages[1].content).lines.map(() => '한국어 번역') });
        calls++;
        assert.match(messages[0].content, /직접적인 수신자/);
        return JSON.stringify({ items: JSON.parse(messages[1].content).map(({ id }) => ({ id, to: '이리나', evidence: '이리나를 바라봤다' })) });
    };
    await um.processScenes('chat-a', { reason: 'resume' });
    assert.equal(um.sceneJobs.get('chat-a').state, 'done');
    assert.equal(calls, 3, JSON.stringify(f.state.modelCalls.map(c => c.messages[0].content)));
    const result = um.loadScenes('chat-a').scenes[0].events[0].quotes;
    assert.equal(result.filter(q => q.to === '이리나').length, 44);
    assert.equal(result[44].to, '킬리안');
});

test('semantic meal grouping uses host calls and preserves raw routines and prior display on failure', async () => {
    const { um, f } = await setup();
    const ledger = L.emptyLedger();
    ledger.routine = [
        { who: '이리나', what: 'meal', text: '계란 프라이와 토스트', at: '2025-11-17T08:20', number: 1 },
        { who: '이리나', what: 'meal', text: '달걀 프라이와 사과 주스', at: '2025-11-17T08:25', number: 2 },
    ];
    um.saveLedger('chat-a', ledger);
    const raw = JSON.stringify(ledger.routine);
    f.model = async ({ messages }) => JSON.stringify({ items: JSON.parse(messages[1].content).map(({ key }) => ({ key, groups: [{ parts: [0, 2], label: 2 }, { parts: [1], label: 1 }, { parts: [3], label: 3 }] })) });
    await um.processChat('chat-a', { reason: 'resume' });
    assert.equal(f.state.modelCalls.length, 1);
    assert.equal(JSON.stringify(um.loadLedger('chat-a').routine), raw);
    assert.equal(L.pendingMealDisplays(um.loadLedger('chat-a')).length, 0);
    // An unrelated pending meal fails: keep the previously checked meal's display.
    const next = structuredClone(um.loadLedger('chat-a'));
    const display = JSON.stringify(next.mealDisplays);
    next.routine.push(...ledger.routine.map(r => ({ ...r, who: '다른 사람' })));
    um.saveLedger('chat-a', next);
    f.model = async () => { throw Error('connection failed'); };
    await um.processChat('chat-a', { reason: 'resume' });
    assert.equal(JSON.stringify(um.loadLedger('chat-a').mealDisplays), display);
    assert.equal(um.jobStatus('chat-a').state, 'done');
});

test('upstream emotional continuity: failed staged chapter rebuild keeps the original chapters', async () => {
    const { um, f } = await setup();
    const st = S.emptyStore();
    st.scenes = Array.from({ length: 70 }, (_, i) => ({ id: `S${i + 1}`, start: i + 1, end: i + 1, title: '장면', summary: '이야기', events: [], recollections: [], later: [] }));
    st.chapters = [{ id: 'C1', scenes: ['S1', 'S2'], title: '기존 챕터', summary: '원래 요약', turns: [], keep: [] }];
    um.saveScenes('chat-a', st);
    const original = JSON.stringify(um.loadScenes('chat-a'));
    let calls = 0;
    f.model = async () => { if (++calls === 2) throw Error('모의 연결 오류'); return JSON.stringify({ end: 'S20', title: '새 챕터', summary: '새 요약', turns: [], keep: [] }); };
    await um.rebuildChapters('chat-a');
    assert.equal(calls, 2);
    assert.match(um.sceneJobs.get('chat-a').error, /모의 연결 오류/);
    assert.equal(JSON.stringify(um.loadScenes('chat-a')), original);
});

test('SIDE B and OOC Archive search recent scenes; default/unknown scope retains the recall window', async () => {
    const { um, rpc } = await setup();
    um.saveSettings({ ...um.settings(), embedding: { source: 'connection' } });
    const st = S.emptyStore();
    st.scenes = [{ id: 'S1', start: 1, end: 2, messages: [], title: '바다 약속', summary: '토요일에 바다에 가기로 약속했다.', events: [], recollections: [] }];
    st.window = { size: 30, firstInside: 1 };
    um.saveScenes('chat-a', st);
    await um.indexScenes('chat-a', st);
    const query = { queries: [{ query: '바다 약속 토요일' }] };
    const original = JSON.stringify(um.loadScenes('chat-a'));
    for (const scope of ['side-b', 'ooc-archive']) {
        const result = await rpc('POST', 'chats/chat-a/search', { ...query, scope });
        assert.equal(result.state, 'ok');
        assert.ok(result.results[0].hits.some(h => h.id === 'S1'), scope);
    }
    for (const scope of [undefined, 'unknown']) {
        const result = await rpc('POST', 'chats/chat-a/search', { ...query, scope });
        assert.deepEqual(result.results[0].hits, []);
    }
    assert.equal(JSON.stringify(um.loadScenes('chat-a')), original);
});

test('empty model output gives actionable guidance; connection errors are never retried as JSON-mode failures', async () => {
    const { um, f } = await setup();
    const model = await um.memoryModel();
    f.model = async () => '';
    await assert.rejects(um.askModel(model, [{ role: 'user', content: 'test' }]), /빈 답.*생각/);
    const count = f.state.modelCalls.length;
    f.model = async () => { throw Error('401 invalid API key'); };
    await assert.rejects(um.askModel(model, [{ role: 'user', content: 'test' }]), /401/);
    assert.equal(f.state.modelCalls.length, count + 1);
});
