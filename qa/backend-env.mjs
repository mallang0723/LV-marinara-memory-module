// QA backend: the real backend entry (src/backend.js) on the in-memory fake Spindle host (tests/fake.js), seeded with a story,
// a finished memory (ledger / scenes / facts / chapters). Runs in the QA script's node process; the
// harness page talks to it over the stand-in channel (/__rpc, /__poll). No model, no network: the "model" is tests/fake-model.js.
import { fake } from '../tests/fake.js';
import { start } from '../src/backend.js';
import { replyFor } from '../tests/fake-model.js';

const NAMES = ['하루', '서아'];
function storyRows(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const user = i % 2 === 0;
        const base = user ? `서아가 하루에게 말했다. "오늘은 빵집 앞에서 ${i}번째로 마주쳤네요. 날씨가 꽤 쌀쌀해졌어요."` : `하루가 앞치마를 털며 대답했다. "그러게. 안 추워? 들어와서 뜨거운 걸 마셔. ${i}번째 손님이니까 서비스야."`;
        rows.push({ role: user ? 'user' : 'assistant', name: user ? NAMES[1] : NAMES[0], content: i === 1 ? '"내일 같이 달빛호수 가자, 약속할게." 하루가 웃었다.' : i === 4 ? '서아가 화가 났다. "왜 말도 없이 가게를 닫았어요? 서운해요."' : i === 7 ? '"미안해, 사과할게." 하루가 사과했다. 둘은 화해했다.' : base });
    }
    return rows;
}

export async function createQaEnv({ messages = 44 } = {}) {
    const outbox = [];
    const f = fake({ onSend: (m, user) => outbox.push({ m, user }) });
    f.chats.set('chat-none', { id: 'chat-none', name: '빈 방', metadata: {} });
    f.messages.set('chat-none', []);
    f.addMessages('chat-a', storyRows(messages));
    f.addMessages('chat-a', [{ id: 'qa-selected-message', role: 'user', content: '하루가 서아에게 편지를 건넸다.' }]);
    f.chats.get('chat-a').character_id = 'char-haru';
    f.chats.get('chat-a').metadata = { loom_summary: '하루와 서아는 가을 축제를 준비하며 가까워졌다.' };
    f.state.userRequired = true;
    // every scene also states a fact (the stock fake model only does for the first), so the 알게 된 사실 tab has several cards
    const counts = {};
    f.model = async ({ messages }) => {
        if (messages[0]?.content?.startsWith('선택한 원문만')) return JSON.stringify({ title: '편지 전달', summary: '하루가 서아에게 편지를 건넸다.' });
        const raw = replyFor(messages, counts);
        let reply; try { reply = JSON.parse(raw); } catch { return raw; }
        for (const scene of reply.scenes || []) if (!scene.facts?.length) scene.facts = [{ about: '서아', text: `서아는 ${scene.end}번 즈음 빵집에 들렀다.`, evidence: [{ n: `${scene.end}.1`, q: '' }] }];
        return JSON.stringify(reply);
    };
    start({ ...f.api, log: { info() {} } }, { tunables: { SCENE_MIN_PENDING: 1 }, store: { debounceMs: 0 }, afterReplyMs: 20 });
    const U = 'qa-user';
    const call = async (m, p, b) => { const r = await f.rpc(m, p, b, U); if (!r.ok) throw Error(`QA seed ${m} ${p}: ${r.error}`); return r; };
    await call('POST', 'ext/settings', { window: 8 });
    await call('POST', 'memory-module/settings', { connection: 'conn-a' });
    await call('POST', 'memory-module/settings/recall', { mode: 'fast' });
    await call('POST', 'memory-module/chats/chat-a/start', {});
    const t0 = Date.now();
    for (;;) {
        const r = (await call('GET', 'memory-module/chats/chat-a')).data;
        if (r.job.state !== 'running' && r.sceneJob.state === 'done' && r.job.state === 'done') break;
        if (Date.now() - t0 > 30000) throw new Error('QA memory seed did not finish');
        await new Promise(r => setTimeout(r, 25));
    }
    // who knows what: the 아는 사람 / 모르는 사람 chips of the facts tab (hand edits, so they are kept as written)
    const facts = (await call('GET', 'memory-module/chats/chat-a/scenes')).data.facts || [];
    for (const [i, fact] of facts.entries()) await call('PATCH', `memory-module/chats/chat-a/facts/${fact.id}`, i % 2 === 0 ? { knownBy: ['하루', '서아'] } : { knownBy: ['하루'], unaware: ['서아'] });
    if (facts.length < 2) throw Error('QA needs two facts for conflicts');
    await call('PATCH', `memory-module/chats/chat-a/facts/${facts[0].id}`, { about: '하루', text: '하루는 커피를 즐겨 마신다' });
    await call('PATCH', `memory-module/chats/chat-a/facts/${facts[1].id}`, { about: '하루', text: '하루는 커피를 즐겨 마시지 않는다' });
    for (const key of ['characterState', 'places', 'keepsakes', 'trackers']) await call('POST', 'memory-module/chats/chat-a/feature-mode', { key, mode: 'on' });
    await call('POST', 'memory-module/chats/chat-a/state', { action: 'set', name: '하루', field: 'outfit', value: '앞치마' });
    await call('POST', 'memory-module/chats/chat-a/places', { action: 'add', name: '달빛 빵집' });
    await call('POST', 'memory-module/chats/chat-a/keepsakes', { action: 'add', name: '서아의 편지', owner: '하루' });
    await call('POST', 'memory-module/chats/chat-a/trackers', { action: 'add', item: { type: 'count', label: '만난 지', clock: 'real', scope: 'room', count: { start: '2026-11-01' } } });
    if (facts.length) await call('POST', 'memory-module/chats/chat-a/recall-prefs', { id: facts[0].id, action: 'pin' });
    await call('POST', 'memory-module/chats/chat-a/selected-memory', { parts: [{ sourceId: 'qa-selected-message', text: '하루가 서아에게 편지를 건넸다.' }] });
    f.files.set(`${U}:memory/chats/deleted-qa.json`, JSON.stringify({ version: 1, threads: [] }));
    outbox.length = 0;
    return {
        f,
        /** one frame from the harness page -> replies (+ anything the backend pushed meanwhile) */
        async handle(frame, user = U) {
            const before = f.sent.length;
            const out = [];
            const orig = outbox.length;
            f.frontendHandler(frame, user, 'qa-session');
            const t0 = Date.now();
            while (Date.now() - t0 < 20000) {
                const hit = f.sent.slice(before).find(s => s.msg.requestId === frame.requestId);
                if (hit) { out.push(hit.msg); break; }
                await new Promise(r => setTimeout(r, 1));
            }
            return out;
        },
        /** backend -> frontend events not tied to a request (commands) */
        drain() { const list = outbox.splice(0).map(x => x.m).filter(m => m.event); return list; },
    };
}
