// QA backend: the real backend entry (src/backend.js) on the in-memory fake Spindle host (tests/fake.js), seeded with a story,
// a finished memory (ledger / scenes / facts / chapters). Runs in the QA script's node process; the
// harness page talks to it over the stand-in channel (/__rpc, /__poll). No model, no network: the "model" is tests/fake-model.js.
import { fake } from '../tests/fake.js';
import { start } from '../src/backend.js';

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
    f.addMessages('chat-a', storyRows(messages));
    f.chats.get('chat-a').character_id = 'char-haru';
    f.chats.get('chat-a').metadata = { loom_summary: '하루와 서아는 가을 축제를 준비하며 가까워졌다.' };
    f.state.userRequired = true;
    start({ ...f.api, log: { info() {} } }, { tunables: { SCENE_MIN_PENDING: 1 }, store: { debounceMs: 0 }, afterReplyMs: 20 });
    const U = 'qa-user';
    const call = (m, p, b) => f.rpc(m, p, b, U);
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
