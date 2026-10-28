// 기억 서재 service for Lumiverse: a rewrite of upstream memory-module/lib/service.cjs (marinara-memory-module by tlsiddl, MIT).
//
// Kept from the original (same logic, same order, same numbers): batching and retry/halving of the ledger reads, the tidy pass,
// scene folding, chapters / arcs / fact merges, the {{기억}} text (renderLedger), the recall (meaning search + model pick + fast
// pick), the hand-edit helpers, the job queues. The pure logic lives in ./core/*.cjs (byte-identical copies of the originals).
// Replaced: the Marinara engine (db / storage / provider-registry) by the host adapter, files by userStorage (src/common/store.js),
// Fastify routes by src/memory/routes.js, the preHandler/onResponse hooks by the interceptor and GENERATION_ENDED
// (src/backend.js), process.env knobs by `tunables` / settings, the game-state tracker clock by the date lines in the messages.
// Dropped: speaker-tag repair and generation instructions (Marinara only), tracker snapshots, the Marinara health/patch report.
// Added (upstream 74310e7): branch inheritance, driven by the host CHAT_FORKED event instead of the Fastify onSend hook (inheritBranch).
//
// Every public function works for ONE user (operator-scoped install): `service.forUser(userId)`.
// The sync parts of the original (renderLedger, settings) read in-memory caches; every async entry point first awaits
// ensureChat()/ready() so the caches are filled.
import L from './core/ledger.cjs';
import S from './core/scenes.cjs';
import R from './core/recall.cjs';
import V from './core/vectors.cjs';

export const VERSION = '0.2.0-lv.1';
export const RECALL_MODES = ['model', 'fast', 'off'];
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function safeChatId(chatId) {
    if (!CHAT_ID.test(String(chatId || ''))) throw Error('invalid chat id');
    return chatId;
}

const DEFAULTS = {
    REBUILD_BATCH_CHARS: 8000,
    TRIAL_MAX_MESSAGES: 40,
    CONTEXT_MESSAGES: 2,
    MODEL_TIMEOUT_MS: 5 * 60_000,
    DEFAULT_WINDOW: 30,
    SCENE_MIN_PENDING: 8,
    /** Interceptor time budget (host default 10 s, worker-host.ts / spindle-settings.service.ts:6): recall may use this much. */
    RECALL_BUDGET_MS: 6_000,
    /** Less than this left for the model's pick: do not start it, use the fast pick (upstream RECALL_MIN_MODEL_MS). */
    RECALL_MIN_MODEL_MS: 3_000,
    /** Embedding query cap (upstream 8 s; shortened so the whole recall fits the interceptor budget). */
    QUERY_TIMEOUT_MS: 4_000,
    RECALL_MIN_ABORT_MS: 1_000,
    EMBED_BATCH: 32,
    EMBED_MAX_PER_RUN: 800,
    EMBED_SOURCE_TTL_MS: 60_000,
    TIDY_EVERY_REPLIES: 15,
    TIDY_CHUNK: 60,
    MEMORY_MAX_CHARS: 40_000,
    MAX_RENDER_CHARS: 60_000,
};

const RECALL_STYLES = {
    quiet: {
        voice:
            'When a memory matters to this moment, let it show briefly and in character — a short line, a look, a choice — one passing touch, not a recap. ' +
            'Most memories should stay unspoken. ',
        end: 'A memory surfaces only as a brief, natural touch when the scene truly calls for it.',
    },
    natural: {
        voice:
            'When something from the past bears on this moment, characters bring it up on their own, without waiting to be asked, the way people who share a past do: ' +
            'a brief remark, a question, or a choice made differently because of what happened. Let shared knowledge remain implicit when it has already been expressed; no callback is required. ',
        end: 'Let what they remember show the way people show it: in what they say, notice and choose, on their own initiative when it fits.',
    },
    active: {
        voice:
            'Characters readily act on their shared past and may initiate a relevant question, follow through on a promise, or respond to changed circumstances without waiting to be asked. ' +
            'This can stay implicit in their choices and reactions; active remembering does not require spoken callbacks or another telling of an old incident. ',
        end: 'Let relevant shared history inform a fresh response or action; leave already expressed memories implicit unless there is a new reason to mention them.',
    },
};
export { RECALL_STYLES };

function memoryHeader(style) {
    return (
        '[Memory: what the characters remember from earlier in this story, beyond the recent messages. ' +
        'This is background the characters already carry, not material to retell: the reader has already read all of it. ' +
        'Let it shape what they know, feel, assume and react to. Do not summarize, explain or narrate past events or backstory from it, ' +
        'and do not copy its numbers, dates or details into the prose just because they are listed here. ' +
        (RECALL_STYLES[style] || RECALL_STYLES.natural).voice +
        'Remembering is not a requirement to mention a memory in every reply. Treat facts and anecdotes already expressed in the recent conversation as shared context: do not retell, paraphrase or re-explain them in narration, inner thoughts or dialogue merely because they remain relevant. ' +
        'Mention them again only to answer an explicit question or requested correction, address a new development that changes their meaning, or support a decision that directly needs that detail now; use only the necessary part. ' +
        'Scope a request to repeat or correct something to the specific answer the user asked to hear again. Correct or restate that answer only; do not replay its already explained background, origin story or supporting anecdote in narration, inner thoughts or dialogue. ' +
        'Unless the user explicitly asks to revisit that past event itself, respond to the present request without reconstructing the event to justify the answer. A connection to the past can remain implicit in tone, familiarity, choices and reactions. ' +
        'Do not repeatedly use the same remembered fact as the same rationale for similar advice or care. Keep continuity implicit in a new reaction or action instead. ' +
        'When recalling an established event, preserve its dates, elapsed time, counts and circumstances; do not reconstruct or embellish them. ' +
        'Quoted lines are verbatim from the story. ' +
        'A character marked as not remembering a scene does not know what happened in it; one marked as remembering it only dimly holds just what "남은 기억" says, ' +
        'even though "그때" records what they really said and did. Others may remind them. ' +
        'Each character knows only what they saw, heard or were told: "모름: X" or "자리에 없어 모름" means X does not know it — X must not mention it, hint at it or act on it until X learns it in the story, even while others who know it are in the same scene. "짐작만: X" means X suspects it without the details. ' +
        'Lines are quoted here in a short form for memory only; keep writing the story in its own usual format. ' +
        '"최근 생활" says when each person last ate, washed and slept: keep daily life believable, and do not repeat a meal or bath that just happened unless the story calls for it. ' +
        '"[지난 이야기 흐름]" starts with the oldest parts of the story (A1, A2 …, each covering many chapters) and goes on with chapters (C…); a line "… 줄임" stands for a stretch left out for length. ' +
        '"※" lines under a chapter are details that must stay exact (dates, deadlines, conditions). ' +
        'The weather by a scene is how that day was: a character may recall it naturally ("the night it rained") when that scene comes to mind, but do not bring weather up for its own sake.]'
    );
}
function memoryFooter(style) {
    return (
        '[End of memory. Write the next reply from inside the moment, not from these notes: no recaps or explanations of the past, no listing what a character remembers. ' +
        (RECALL_STYLES[style] || RECALL_STYLES.natural).end +
        ' Keep already expressed facts implicit unless the current turn needs them again; respond to what is new instead of restating the same memory in different words. A requested correction is not permission to retell its background.' +
        ']'
    );
}
/**
 * Branch inheritance (upstream 74310e7 service.cjs branchMemory, same logic). Copy only the common prefix. Identity and evidence
 * use chat-local message IDs / row numbers, so every pointer (including rollback snapshots) must follow the new messages.
 * Never edits the source.
 */
export function branchMemory(ledger, scenes, source, target, messageIds) {
    const prefix = [];
    const ids = new Map();
    const numbers = new Map();
    for (let i = 0; i < source.length && i < target.length; i++) {
        const a = source[i], b = target[i];
        if (messageIds.get(a.id) !== b.id || a.h !== b.h || a.role !== b.role || a.speaker !== b.speaker || L.trackerChanged(a, b)) break;
        prefix.push(a);
        ids.set(a.id, b.id);
        numbers.set(a.number, b.number);
    }
    const remap = value => {
        if (Array.isArray(value)) return value.map(remap);
        if (!value || typeof value !== 'object') return value;
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            if (key === 'number' && typeof val === 'number') {
                if (!numbers.has(val)) throw Error('기억의 원문 참조가 분기 범위를 벗어났습니다.');
                out[key] = numbers.get(val);
            } else if ((key === 'messageId' || key === 'id') && ids.has(val)) out[key] = ids.get(val);
            else out[key] = remap(val);
        }
        return out;
    };
    let nextLedger = ledger ? structuredClone(ledger) : null;
    let ledgerReset = false;
    if (nextLedger) {
        const change = L.reconcile(nextLedger, prefix);
        // An old fork can predate the bounded undo history. Re-read that ledger rather than inherit future events.
        if (change.rebuild) { nextLedger = L.emptyLedger(); ledgerReset = true; }
        delete nextLedger.needsRebuild;
        delete nextLedger.verifiedBefore;
        nextLedger = remap(nextLedger);
        nextLedger.lastNumber = numbers.get(nextLedger.lastNumber) ?? null;
        nextLedger.storyDate = L.storyDate(prefix.slice(0, nextLedger.processed.length)) || null;
        nextLedger.storyTime = L.storyTime(prefix.slice(0, nextLedger.processed.length)) || null;
    }
    let nextScenes = scenes ? structuredClone(scenes) : null;
    if (nextScenes) {
        S.reconcileScenes(nextScenes, prefix);
        const factIds = new Set(nextScenes.facts.map(f => f.id));
        for (const f of nextScenes.facts) if (f.replacedBy && !factIds.has(f.replacedBy)) delete f.replacedBy;
        // `start` is a message number on scenes/chapters, but an array offset on ledger snapshots.
        for (const x of [...nextScenes.scenes, ...(nextScenes.chapters || [])]) {
            if (!numbers.has(x.start) || !numbers.has(x.end)) throw Error('장면의 원문 범위를 분기에 연결하지 못했습니다.');
            x.start = numbers.get(x.start);
            x.end = numbers.get(x.end);
        }
        nextScenes.window = null;
        nextScenes = remap(nextScenes);
    }
    return { ledger: nextLedger, scenes: nextScenes, matched: prefix.length, ledgerReset };
}

export const MEMORY_MARKER = '[Memory: what the characters remember from earlier in this story';

const CHAPTER_LENGTHS = { short: 2000, normal: 4000, long: 8000, full: 16000 };
const RECALL_AMOUNTS = {
    less: { scenes: 2, sceneChars: 6000, near: 0, raw: 1 },
    normal: { scenes: 4, sceneChars: 10000, near: 3, raw: 2 },
    more: { scenes: 6, sceneChars: 16000, near: 6, raw: 2 },
};
export { CHAPTER_LENGTHS, RECALL_AMOUNTS };

/** Lines of a block, dropped from the top (the oldest) until it fits; the heading line stays. */
function fitBlock(text, max) {
    if (!text || text.length <= max) return text;
    if (max < 200) return '';
    const lines = text.split('\n');
    const head = /^\[[^\]]+\]$/.test(lines[0]) ? lines.shift() : null;
    while (lines.length > 1 && (head ? head.length + 1 : 0) + lines.join('\n').length > max) lines.shift();
    const body = lines.join('\n');
    if ((head ? head.length + 1 : 0) + body.length > max) return '';
    return head ? `${head}\n${body}` : body;
}

/** Memory text must never become new macros or prompt markup (upstream marinara-memory-runtime.cjs sanitize). */
export function sanitize(text, max = DEFAULTS.MAX_RENDER_CHARS) {
    let out = String(text).replace(/\{\{/g, '{​{').replace(/\}\}/g, '}​}');
    if (out.length > max) {
        const cut = out.lastIndexOf('\n', max);
        out = out.slice(0, cut > 0 ? cut : max);
    }
    return out.trim();
}

export function nameList(value) {
    const list = Array.isArray(value) ? value : String(value ?? '').split(/[,·、/]/);
    return [...new Set(list.map(n => String(n ?? '').trim().slice(0, 40)).filter(Boolean))];
}

export function summary(ledger) {
    const threads = ledger?.threads || [];
    const count = kind => threads.filter(t => t.kind === kind && t.status === 'open').length;
    return {
        processed: ledger?.processed?.length || 0,
        open: { promise: count('promise'), emotion: count('emotion'), state: count('state'), secret: count('secret'), pending: count('pending') },
        closed: threads.filter(t => t.status === 'closed').length,
        needsRebuild: Boolean(ledger?.needsRebuild),
        rebuildFrom: ledger?.needsRebuild?.number ?? null,
        lastTidy: ledger?.lastTidy || null,
        updatedAt: ledger?.updatedAt || null,
    };
}

const CLOCK_FIELD_NOTE = 'tracker clocks do not exist on Lumiverse (grep -il tracker finds none); only date lines in the text are read';
export { CLOCK_FIELD_NOTE };

const timeoutError = ms => Object.assign(new Error(`${Math.round(ms)}ms timeout`), { name: 'TimeoutError' });
/** Resolves with the promise, or rejects when `ms` pass / `signal` aborts, whichever is first (the host call may ignore the signal). */
function bounded(promise, ms, signal) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = fn => v => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn(v); };
        const onAbort = () => finish(reject)(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        const timer = Number.isFinite(ms) ? setTimeout(finish(reject), Math.max(0, ms), timeoutError(ms)) : null;
        if (signal?.aborted) return onAbort();
        signal?.addEventListener?.('abort', onAbort, { once: true });
        Promise.resolve(promise).then(finish(resolve), finish(reject));
    });
}
export { bounded };

export function createMemoryService({ host, store, log = () => {}, now = () => Date.now(), tunables = {} }) {
    const T = { ...DEFAULTS, ...tunables };
    const users = new Map();
    /** chatId -> the text {{memory_ledger}} returns (the macro handler is sync-ish and has no userId: it only reads this cache) */
    const renderedCache = new Map();
    const forUser = userId => {
        if (typeof userId !== 'string' || !userId) throw new Error('userId required');
        if (!users.has(userId)) users.set(userId, makeUser(userId));
        return users.get(userId);
    };
    const dropRendered = chatId => renderedCache.delete(chatId);
    return { forUser, renderedCache, dropRendered, T, store, host, VERSION, users };

    function makeUser(userId) {
        const keys = {
            settings: 'memory/settings.json',
            ledger: id => `memory/chats/${safeChatId(id)}.json`,
            scenes: id => `memory/chats/${safeChatId(id)}.scenes.json`,
            vectors: id => `memory/chats/${safeChatId(id)}.vectors.json`,
            sceneError: id => `memory/chats/${safeChatId(id)}.scene-error.txt`,
        };
        let settingsCache = null;
        const ledgerCache = new Map();
        const sceneCache = new Map();
        const vectorCache = new Map();
        const loading = new Map();
        const windows = new Map();
        const recalls = new Map();
        const turnQuery = new Map();
        const storyDays = new Map();
        const storyNow = new Map();
        const replyViews = new Map();
        const queues = new Map();
        const jobs = new Map();
        const sceneJobs = new Map();
        const trials = new Map();
        let lastSaveError = null;
        let embedSource = { key: '', at: 0, value: null, error: null };
        let connectionsCache = { at: 0, list: null };
        const noJson = new Set();

        /* ---------- persistence ---------- */

        async function ready() {
            if (settingsCache) return;
            settingsCache ??= await (loading.get('settings') ?? (async () => {
                const p = (async () => ({ connection: null, chats: {}, ...(await store.getJson(userId, keys.settings, {})) }))();
                loading.set('settings', p);
                try { return await p; } finally { loading.delete('settings'); }
            })());
        }
        function settings() {
            if (!settingsCache) throw Error('internal: settings not loaded');
            return settingsCache;
        }
        function persist(key, value, opts) {
            // store.setJson throws synchronously for a broken file (never overwritten); a failed write is remembered.
            const p = store.setJson(userId, key, value, opts);
            p.catch(error => { lastSaveError = { key, error: String(error?.message || error), at: new Date().toISOString() }; log(`save failed ${key}: ${error?.message || error}`); });
            return p;
        }
        function saveSettings(next) {
            persist(keys.settings, next);
            settingsCache = next;
        }
        async function ensureChat(chatId) {
            await ready();
            safeChatId(chatId);
            if (ledgerCache.has(chatId) && sceneCache.has(chatId)) return;
            const key = `chat:${chatId}`;
            if (!loading.has(key)) {
                loading.set(key, (async () => {
                    if (!ledgerCache.has(chatId)) ledgerCache.set(chatId, await store.supported(userId, keys.ledger(chatId), await store.getJson(userId, keys.ledger(chatId), null), L.LEDGER_VERSION));
                    if (!sceneCache.has(chatId)) sceneCache.set(chatId, await store.supported(userId, keys.scenes(chatId), await store.getJson(userId, keys.scenes(chatId), null), S.SCENES_VERSION));
                })().finally(() => loading.delete(key)));
            }
            await loading.get(key);
        }
        function loadLedger(chatId) {
            if (!ledgerCache.has(chatId)) throw Error('internal: chat not loaded');
            return ledgerCache.get(chatId);
        }
        function saveLedger(chatId, ledger) {
            ledger.updatedAt = new Date().toISOString();
            persist(keys.ledger(chatId), ledger);
            ledgerCache.set(chatId, ledger);
        }
        function loadScenes(chatId) {
            if (!sceneCache.has(chatId)) throw Error('internal: chat not loaded');
            return sceneCache.get(chatId);
        }
        function saveScenes(chatId, st) {
            st.updatedAt = new Date().toISOString();
            persist(keys.scenes(chatId), st);
            sceneCache.set(chatId, st);
        }
        function saveLastReply(chatId, error, reply) {
            try { void store.writeText(userId, keys.sceneError(chatId), `${new Date().toISOString()} ${error}\n길이: ${reply.length}자\n\n앞부분:\n${reply.slice(0, 1500)}\n\n끝부분:\n${reply.slice(-800)}\n`).catch(() => {}); } catch { /* optional */ }
        }
        /** Stop before any model call when this chat's memory files are broken: the work could not be saved anyway. */
        async function checkFiles(chatId) {
            await ensureChat(chatId);
            for (const key of [keys.ledger(chatId), keys.scenes(chatId), keys.settings]) {
                const broken = store.blocked(userId, key);
                if (broken) throw Error(`기억 파일(${key.split('/').pop()})을 ${broken.reason === 'version' ? '이 버전의 확장이 모르는 형식이라' : '손상되어'} 읽지 못해 정리를 멈췄습니다.${broken.backup ? ` 원본 복사본: ${broken.backup}.` : ''} 파일을 고치거나 지운 뒤 다시 시도해 주세요.`);
            }
        }
        const flush = () => store.flush(userId);

        const chatEnabled = chatId => settings().chats?.[chatId]?.enabled === true;
        function setChatEnabled(chatId, enabled) {
            const next = { ...settings() };
            next.chats = { ...next.chats, [chatId]: { ...(next.chats?.[chatId] || {}), enabled } };
            saveSettings(next);
            if (!enabled) {
                // Off means nothing of this chat's memory goes into a reply, including what was picked for the last turn.
                recalls.delete(chatId);
                replyViews.delete(chatId);
                renderedCache.delete(chatId);
            }
        }

        /* ---------- meaning search (embeddings) ---------- */

        const trimmed = v => String(v || '').trim();
        function embeddingMode() {
            const e = settings().embedding;
            if (e === null) return 'off';
            if (e?.model || e?.connectionId) return 'manual';
            return 'connection';
        }
        /**
         * Where vectors come from. settings().embedding:
         *   missing or { source: 'connection' } - the user's primary embedding connection of Lumiverse (Settings > Embeddings);
         *   { model, connectionId } - an embedding connection picked by name / id / model;
         *   null - off.
         * (Upstream read the embedding model off the memory connection; Lumiverse has separate embedding connections:
         * spindle.embeddings.listConnections / embed, `embeddings` permission - types/embeddings.d.ts.)
         */
        async function embeddingSource(force = false) {
            await ready();
            const mode = embeddingMode();
            const key = JSON.stringify([mode, settings().embedding]);
            if (!force && embedSource.key === key && now() - embedSource.at < T.EMBED_SOURCE_TTL_MS) return embedSource.value;
            let value = null, error = null;
            try {
                if (mode !== 'off') {
                    const list = (await host.embeddingConnections(userId)).filter(c => c.enabled !== false);
                    if (mode === 'manual') {
                        const want = settings().embedding;
                        const row = list.find(c => c.id === want.connectionId) || list.find(c => c.id === want.model || c.name === want.model || c.model === want.model);
                        if (!row) throw Error(`임베딩 연결 "${want.model || want.connectionId}"을(를) 찾지 못했습니다. 있는 임베딩 연결: ${list.map(c => c.name).join(', ') || '없음'}`);
                        value = { model: row.model, connectionId: row.id, label: `임베딩 연결 "${row.name}"` };
                    } else {
                        const row = list.find(c => c.is_primary) || list[0];
                        if (!row) throw Error('루미버스 설정 > 임베딩에 쓸 수 있는 연결이 없습니다.');
                        value = { model: row.model, connectionId: row.id, label: `임베딩 연결 "${row.name}"` };
                    }
                }
            } catch (e) {
                error = e?.code === 'permission' ? `임베딩(embeddings) 권한이 없거나 이 루미버스가 임베딩 API를 지원하지 않아 뜻으로 찾기는 꺼져 있습니다(기억 회상은 뜻 검색 없이 동작). 새 루미버스로 올리면 쓸 수 있습니다.` : String(e?.message || e);
            }
            embedSource = { key, at: now(), value, error };
            return value;
        }
        function embeddingModel() {
            const m = embeddingMode();
            return m === 'off' ? null : embedSource.value?.model || null;
        }
        /** Loads the vector index for a chat (needs embeddingSource() called first). */
        async function ensureVectors(chatId) {
            const model = embeddingModel();
            if (!model) return null;
            let index = vectorCache.get(chatId);
            if (!index) index = await store.getJson(userId, keys.vectors(chatId), null, { replaceable: true });
            if (!V.usable(index, model)) index = V.emptyIndex(model);
            vectorCache.set(chatId, index);
            return index;
        }
        function loadVectors(chatId) {
            const model = embeddingModel();
            if (!model) return null;
            return vectorCache.get(chatId) || null;
        }
        function saveVectors(chatId, index) {
            persist(keys.vectors(chatId), index);
            vectorCache.set(chatId, index);
        }
        /** Vectors for texts; kind 'query' or 'doc' picks the model's prefix (the host does not add e5/bge prefixes, embeddings.service.ts:2399-2410). */
        async function embedTexts(texts, kind, signal) {
            const src = await embeddingSource();
            if (!src) throw Error(embedSource.error || '임베딩 모델이 정해지지 않았습니다.');
            const prefix = V.prefixes(src.model)[kind === 'query' ? 'query' : 'doc'];
            const res = await host.embed(userId, { texts: texts.map(t => `${prefix}${t}`.slice(0, 8000)), connectionId: src.connectionId, inputType: kind === 'query' ? 'query' : 'passage', signal });
            const out = res?.embeddings;
            if (!Array.isArray(out) || out.length !== texts.length) throw Error('임베딩 응답의 개수가 맞지 않습니다.');
            return out;
        }
        /** Give new or changed scenes their vectors. A failure is logged and left for the next run. */
        async function indexScenes(chatId, st, job) {
            await embeddingSource();
            const index = await ensureVectors(chatId);
            if (!index || !st?.scenes.length) return 0;
            V.prune(index, st.scenes);
            const stale = V.staleDocs(index, st.scenes).slice(0, T.EMBED_MAX_PER_RUN);
            let done = 0;
            for (let i = 0; i < stale.length && !job?.cancel; i += T.EMBED_BATCH) {
                const part = stale.slice(i, i + T.EMBED_BATCH);
                if (job) job.stage = `뜻 찾기 색인 (${done + part.length}/${stale.length})`;
                try {
                    V.putVectors(index, part, await embedTexts(part.map(d => d.text), 'doc', job?.abort?.signal));
                    done += part.length;
                    saveVectors(chatId, index);
                } catch (error) {
                    log(`chat ${chatId}: embedding failed, will try again later (${error?.message || error})`);
                    break;
                }
            }
            if (done) log(`chat ${chatId}: indexed ${done} piece(s) for meaning search`);
            return done;
        }

        /* ---------- messages ---------- */

        /** The story clock from date lines in the messages themselves (upstream addTrackerClock without the tracker part). */
        function addOwnClock(messages) {
            let last = null;
            for (const m of messages) {
                const own = L.dateInText(L.htmlToText(m.content), last?.date || null);
                if (own) last = { date: own.date, time: own.time || null };
                if (last) m.clock = { ...last };
            }
        }
        /**
         * The chat as the memory model sees it: user / assistant messages (hidden ones too: they are still the story, SPEC 6.4;
         * Lumiverse has no narrator role), numbered by index_in_chat + 1. Each message keeps its host id, the ledger's reconcile
         * matches on id + content hash (core ledger.cjs reconcile), so deleted messages are detected without row ids.
         */
        async function chatMessages(chatId) {
            const rows = await host.allMessages(userId, chatId);
            const out = [];
            for (const row of rows) {
                if (!['user', 'assistant'].includes(row.role)) continue;
                if (!String(row.content || '').trim()) continue;
                out.push({ id: row.id, number: row.number, speaker: row.role === 'user' ? row.name || 'User' : row.name || 'Character', role: row.role, content: String(row.content) });
            }
            addOwnClock(out);
            return L.prepareMessages(out);
        }
        /** Messages the ledger may read: up to the user's latest message (a reroll of the newest reply never needs undoing). */
        const settled = messages => (messages.length && messages.at(-1).role !== 'user' ? messages.slice(0, -1) : messages);
        /** How many of the newest messages the reply model sees directly. Lumiverse has no per-chat message limit (it is token based): setting or default. */
        async function chatWindow() {
            await ready();
            const w = Number(settings().window);
            return Number.isInteger(w) && w > 0 ? w : T.DEFAULT_WINDOW;
        }
        async function chatCast(chatId) {
            try {
                const chat = await host.rawChat(userId, chatId);
                const ids = Array.isArray(chat.metadata?.character_ids) && chat.metadata.character_ids.length ? chat.metadata.character_ids : chat.character_id ? [chat.character_id] : [];
                const names = [];
                for (const id of ids) { const n = await host.characterName(userId, id); if (n) names.push(n); }
                return names;
            } catch { return []; }
        }

        /* ---------- memory model ---------- */

        async function connectionList() {
            if (connectionsCache.list && now() - connectionsCache.at < 15_000) return connectionsCache.list;
            const list = await host.connections(userId);
            connectionsCache = { at: now(), list };
            return list;
        }
        async function memoryModel() {
            await ready();
            const wanted = settings().connection;
            if (!wanted) throw Error('기억용 연결이 정해지지 않았습니다. 기억 서재 설정에서 정해 주세요.');
            const list = await connectionList();
            const row = list.find(c => c.id === wanted) || list.find(c => c.name === wanted);
            if (!row) throw Error(`연결 "${wanted}"을(를) 찾지 못했습니다.`);
            return { connectionId: row.id, model: row.model, name: row.name };
        }
        const abortable = (promise, signal) => bounded(promise, Infinity, signal);
        async function askModel(model, messages, { maxTokens = 4096 } = {}) {
            const timeout = AbortSignal.timeout(T.MODEL_TIMEOUT_MS);
            const signal = model.signal ? AbortSignal.any([timeout, model.signal]) : timeout;
            const ask = extraParameters => abortable(host.generate(userId, { connectionId: model.connectionId, messages, maxTokens, temperature: 0.2, signal, extraParameters }), signal);
            if (noJson.has(model.connectionId)) return ask({});
            try {
                return await ask({ response_format: { type: 'json_object' } });
            } catch (error) {
                // like upstream: a provider that refuses the JSON mode is asked again without it (and remembered)
                if (signal.aborted || error?.name === 'AbortError' || error?.code === 'permission') throw error;
                noJson.add(model.connectionId);
                log(`json mode refused by ${model.connectionId}: ${String(error?.message || error).slice(0, 120)}; asking without it`);
                return ask({});
            }
        }

        /** Read one batch; an unreadable reply is retried once, then the batch is halved. */
        async function readBatch(model, ledger, batch, context) {
            for (let attempt = 0; attempt < 2; attempt++) {
                const reply = await askModel(model, L.buildPrompt(ledger, batch, context));
                const parsed = L.parseJsonObject(reply);
                if (parsed) return [{ batch, parsed }];
            }
            if (batch.length < 2) throw Error(`메시지 ${batch[0].number}번의 정리 결과를 읽지 못했습니다.`);
            const half = Math.ceil(batch.length / 2);
            const first = await readBatch(model, ledger, batch.slice(0, half), context);
            return [...first, ...(await readBatch(model, ledger, batch.slice(half), batch.slice(half - T.CONTEXT_MESSAGES, half)))];
        }

        /** Close finished threads and fold duplicates. Open threads are checked in chunks of TIDY_CHUNK. */
        async function tidyLedger(model, ledger, messages) {
            const recent = messages.slice(-4);
            const total = { closed: 0, merged: 0, calls: 0 };
            const open = ledger.threads.filter(t => t.status === 'open');
            for (const kind of L.KINDS) {
                const ofKind = open.filter(t => t.kind === kind);
                for (let i = 0; i < ofKind.length; i += T.TIDY_CHUNK) {
                    const view = { threads: ofKind.slice(i, i + T.TIDY_CHUNK) };
                    const parsed = L.parseJsonObject(await askModel(model, L.buildTidyPrompt(view, recent)));
                    total.calls++;
                    if (!parsed) continue;
                    const stats = L.applyTidy(ledger, parsed);
                    total.closed += stats.closed;
                    total.merged += stats.merged;
                }
            }
            total.feelingsResolved = 0;
            total.feelingsMoved = 0;
            for (const feeling of ledger.threads.filter(t => t.status === 'open' && t.kind === 'emotion')) {
                const review = L.buildFeelingPrompt(ledger, messages, feeling);
                const parsed = L.parseJsonObject(await askModel(model, review.messages, { maxTokens: 1024 }));
                total.calls++;
                if (!parsed) continue;
                const stats = L.applyFeelingReview(ledger, parsed, review.window);
                total.closed += stats.closed;
                total.feelingsResolved += stats.closed;
                total.feelingsMoved += stats.moved || 0;
            }
            ledger.repliesSinceTidy = 0;
            ledger.lastTidy = { at: new Date().toISOString(), ...total };
            return total;
        }

        /** Fold messages that are leaving the window into scenes, one slice per call, until caught up. */
        async function foldScenes(chatId, st, messages, window, model, job, { minPending = 1 } = {}) {
            let calls = 0;
            for (;;) {
                const next = S.nextSlice(st, messages, window, { minPending: calls ? 1 : minPending });
                if (!next) break;
                if (job?.cancel) throw Error('중단했습니다. 다시 시작하면 이어서 정리합니다.');
                if (job) job.stage = `장면 정리 (${next.slice[0].number}번부터)`;
                let applied = null, lastError = '', lastParsed = null, lastReply = '';
                for (let attempt = 0; attempt < 2 && !applied; attempt++) {
                    const reply = await askModel(model, S.buildScenePrompt(st, next.slice, next.required, lastError || null), { maxTokens: 8192 });
                    calls++;
                    lastReply = String(reply || '');
                    const { result: parsed, truncated } = S.parseScenesReply(reply);
                    if (parsed) lastParsed = parsed;
                    if (truncated) {
                        const part = parsed ? S.applyScenes(st, parsed, next.slice, next.required, undefined, { partial: true }) : { error: '응답이 너무 길어서 잘렸습니다' };
                        if (!part.error) { applied = part; log(`chat ${chatId}: reply was cut off, kept ${part.scenes.length} whole scene(s)`); } else lastError = part.error;
                        continue;
                    }
                    const result = parsed ? S.applyScenes(st, parsed, next.slice, next.required) : { error: '응답을 읽지 못했습니다' };
                    if (result.error) lastError = result.error; else applied = result;
                }
                if (!applied) saveLastReply(chatId, lastError, lastReply);
                if (!applied && lastParsed) {
                    const part = S.applyScenes(st, lastParsed, next.slice, next.required, undefined, { partial: true });
                    if (!part.error) { applied = part; log(`chat ${chatId}: kept ${part.scenes.length} good scene(s), reading the rest again (${lastError})`); }
                }
                if (job?.cancel) throw Error('중단했습니다. 다시 시작하면 이어서 정리합니다.');
                if (!applied) throw Error(`${next.slice[0].number}번부터 장면 정리에 실패했습니다: ${lastError}`);
                S.commitScenes(st, applied);
                st.window = { size: window, firstInside: S.firstInsideWindow(messages, window) };
                saveScenes(chatId, st);
                log(`chat ${chatId}: ${applied.scenes.length} scene(s) through message ${applied.scenes.at(-1).end}, ${applied.facts.length} fact(s)`);
            }
            return calls;
        }

        /** Chapters and fact merges. A failure here is logged and left for next time: it never blocks the scenes. */
        async function condense(chatId, st, model, job, { maxCalls = 6, chaptersOnly = false } = {}) {
            let calls = 0;
            while (calls < maxCalls && !job?.cancel) {
                const redo = S.nextRedo(st);
                if (!redo) break;
                if (redo.kind.startsWith('drop')) { S.applyRedo(st, redo); saveScenes(chatId, st); continue; }
                const label = redo.kind === 'chapter' ? '챕터' : '큰 흐름';
                if (job) job.stage = `고친 내용으로 ${label} 다시 요약 (${redo.target.id})`;
                calls++;
                try {
                    const prompt = redo.kind === 'chapter' ? S.buildChapterPrompt(st, redo.parts) : S.buildArcPrompt(st, redo.parts);
                    const parsed = L.parseJsonObject(await askModel(model, prompt, { maxTokens: 2000 }));
                    const made = S.applyRedo(st, redo, parsed);
                    if (made.error) throw Error(made.error);
                    saveScenes(chatId, st);
                    log(`chat ${chatId}: ${redo.kind} ${redo.target.id} summarized again after a hand edit`);
                } catch (error) { log(`chat ${chatId}: summarizing ${redo.target.id} again failed, will try again later (${error?.message || error})`); break; }
            }
            while (calls < maxCalls && !job?.cancel) {
                const scenes = S.nextChapter(st);
                if (!scenes) break;
                if (job) job.stage = `챕터 묶기 (${scenes[0].id}~${scenes.at(-1).id})`;
                calls++;
                try {
                    const parsed = L.parseJsonObject(await askModel(model, S.buildChapterPrompt(st, scenes), { maxTokens: 2000 }));
                    const made = S.applyChapter(st, parsed, scenes);
                    if (made.error) throw Error(made.error);
                    S.commitChapter(st, made.chapter);
                    saveScenes(chatId, st);
                    log(`chat ${chatId}: chapter ${made.chapter.id} (${scenes[0].id}~${scenes.at(-1).id}) ${made.chapter.title}`);
                } catch (error) { log(`chat ${chatId}: chapter failed, will try again later (${error?.message || error})`); break; }
            }
            while (calls < maxCalls && !job?.cancel) {
                const chapters = S.nextArc(st);
                if (!chapters) break;
                if (job) job.stage = `큰 흐름 묶기 (${chapters[0].id}~${chapters.at(-1).id})`;
                calls++;
                try {
                    const parsed = L.parseJsonObject(await askModel(model, S.buildArcPrompt(st, chapters), { maxTokens: 1500 }));
                    const made = S.applyArc(st, parsed, chapters);
                    if (made.error) throw Error(made.error);
                    S.commitArc(st, made.arc);
                    saveScenes(chatId, st);
                    log(`chat ${chatId}: arc ${made.arc.id} (${made.arc.chapters[0]}~${made.arc.chapters.at(-1)}) ${made.arc.title}`);
                } catch (error) { log(`chat ${chatId}: arc failed, will try again later (${error?.message || error})`); break; }
            }
            while (!chaptersOnly && calls < maxCalls && !job?.cancel) {
                const next = S.nextFactMerge(st);
                if (!next) break;
                if (job) job.stage = `사실 합치기 (${next.about})`;
                calls++;
                try {
                    const parsed = L.parseJsonObject(await askModel(model, S.buildFactMergePrompt(st, next.about, next.facts), { maxTokens: 3000 }));
                    if (!parsed) throw Error('응답을 읽지 못했습니다');
                    const made = S.applyFactMerge(st, next.about, next.facts, parsed);
                    saveScenes(chatId, st);
                    log(`chat ${chatId}: merged ${next.about}'s facts (${next.facts.length} → ${S.liveFacts(st).filter(f => (f.about || '기타') === next.about).length})${made ? '' : ', nothing to merge'}`);
                } catch (error) { log(`chat ${chatId}: fact merge failed, will try again later (${error?.message || error})`); break; }
            }
            return calls;
        }

        /* ---------- jobs ---------- */

        function enqueue(key, task) {
            const previous = queues.get(key) || Promise.resolve();
            const next = previous.catch(() => {}).then(task);
            queues.set(key, next);
            next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {});
            return next;
        }
        const jobStatus = chatId => jobs.get(chatId) || { state: 'idle' };
        function changedNumber(ledger, messages, index) {
            const n = messages[index]?.number;
            return typeof n === 'number' ? n : null;
        }

        /**
         * Bring the ledger up to date with the chat. mode "rebuild" starts from an empty ledger.
         * Progress is saved after every batch, so a stopped or failed run continues where it left off.
         */
        function processChat(chatId, { rebuild = false, reason = 'auto' } = {}) {
            const run = enqueue(chatId, async () => {
                await ensureChat(chatId);
                if (!rebuild && !chatEnabled(chatId)) return;
                const job = { state: 'running', reason, done: 0, total: 0, startedAt: new Date().toISOString(), error: null, cancel: false, abort: new AbortController() };
                jobs.set(chatId, job);
                try {
                    await checkFiles(chatId);
                    const messages = settled(await chatMessages(chatId));
                    let ledger = rebuild ? L.emptyLedger() : structuredClone(loadLedger(chatId) || L.emptyLedger());
                    ledger.cast = await chatCast(chatId);
                    L.tidyKnowledge(ledger);
                    const state = L.reconcile(ledger, messages);
                    if (state.rebuild) {
                        ledger.needsRebuild = { at: new Date().toISOString(), changedAt: state.changedAt, number: changedNumber(ledger, messages, state.changedAt) };
                        saveLedger(chatId, ledger);
                        throw Error('예전 메시지가 수정·삭제되어 장부를 처음부터 다시 정리해야 합니다. 기억 서재의 ‘처음부터 다시 정리’로 다시 정리해 주세요.');
                    }
                    if (ledger.needsRebuild) { delete ledger.needsRebuild; saveLedger(chatId, ledger); }
                    if (state.rolledBack) log(`chat ${chatId}: message ${state.changedAt + 1} changed, rolled back and re-reading`);
                    const remaining = messages.slice(state.from);
                    const batches = remaining.length ? L.planBatches(remaining, T.REBUILD_BATCH_CHARS) : [];
                    job.total = batches.length;
                    if (!batches.length) {
                        if (state.rolledBack) saveLedger(chatId, ledger);
                        job.state = 'done';
                        return;
                    }
                    const model = { ...(await memoryModel()), signal: job.abort.signal };
                    for (const batch of batches) {
                        if (job.cancel) throw Error('중단했습니다. 다시 시작하면 이어서 정리합니다.');
                        const at = messages.indexOf(batch[0]);
                        const context = messages.slice(Math.max(0, at - T.CONTEXT_MESSAGES), at);
                        const parts = await readBatch(model, ledger, batch, context);
                        if (job.cancel) throw Error('중단했습니다. 다시 시작하면 이어서 정리합니다.');
                        for (const part of parts) {
                            L.beginBatch(ledger, messages.indexOf(part.batch[0]));
                            const stats = L.applyResult(ledger, part.parsed, part.batch);
                            L.commitBatch(ledger, part.batch);
                            if (stats.dropped) log(`chat ${chatId}: dropped ${stats.dropped} ungrounded item(s)`);
                        }
                        delete ledger.needsRebuild;
                        job.done++;
                        if (batches.length > 1 && job.done % 20 === 0 && job.done < batches.length) {
                            job.stage = '장부 점검';
                            await tidyLedger(model, ledger, messages.slice(0, messages.indexOf(batch.at(-1)) + 1));
                            job.stage = null;
                        }
                        saveLedger(chatId, ledger);
                    }
                    if (batches.length) {
                        ledger.repliesSinceTidy = (ledger.repliesSinceTidy || 0) + (reason === 'reply' ? 1 : 0);
                        if (batches.length > 1 || ledger.repliesSinceTidy >= T.TIDY_EVERY_REPLIES) {
                            job.stage = '장부 점검';
                            const tidy = await tidyLedger(model, ledger, messages);
                            log(`chat ${chatId}: tidy closed ${tidy.closed}, merged ${tidy.merged} (${tidy.calls} call(s))`);
                        }
                        saveLedger(chatId, ledger);
                    }
                    job.stage = null;
                    job.state = 'done';
                    log(`chat ${chatId}: ledger up to date (${reason}, ${job.total} call(s))`);
                } catch (error) {
                    job.state = job.cancel ? 'idle' : 'error';
                    job.error = job.cancel ? null : error?.message || String(error);
                    log(`chat ${chatId}: ${job.cancel ? `stopped (${job.cancelReason || 'stop'})` : job.error}`);
                } finally {
                    job.finishedAt = new Date().toISOString();
                    await rendered(chatId).catch(() => renderedCache.delete(chatId));
                    await flush().catch(() => {});
                }
            });
            // Scenes are folded on their own queue: a slow scene call must never hold up the next reply.
            return run.then(() => { if (rebuild || (settingsCache && chatEnabled(chatId))) return processScenes(chatId, { rebuild, reason }); });
        }

        function processScenes(chatId, { rebuild = false, reason = 'auto' } = {}) {
            const key = `scenes:${chatId}`;
            if (sceneJobs.get(chatId)?.state === 'running' && !rebuild) {
                sceneJobs.get(chatId).again = true;
                return queues.get(key);
            }
            return enqueue(key, async () => {
                await ensureChat(chatId);
                const job = { state: 'running', reason, calls: 0, startedAt: new Date().toISOString(), error: null, cancel: false, abort: new AbortController(), again: false };
                sceneJobs.set(chatId, job);
                try {
                    await checkFiles(chatId);
                    let fresh = rebuild;
                    do {
                        job.again = false;
                        const messages = await chatMessages(chatId);
                        const window = await chatWindow();
                        const st = fresh ? S.emptyStore() : structuredClone(loadScenes(chatId) || S.emptyStore());
                        fresh = false;
                        const change = S.reconcileScenes(st, messages);
                        if (change.dropped) {
                            log(`chat ${chatId}: ${change.dropped} scene(s) changed underneath, folding again${change.lostEdits ? ` (${change.lostEdits} hand edit(s) lost)` : ''}`);
                            saveScenes(chatId, st);
                        }
                        if (rebuild && !st.scenes.length) saveScenes(chatId, st);
                        const translated = S.attachTranslations(st, messages) + S.tidyKnowledge(st);
                        const personas = L.personaNames(messages);
                        const cast = await chatCast(chatId);
                        const personasChanged = JSON.stringify(personas) !== JSON.stringify(st.personas || []) || JSON.stringify(cast) !== JSON.stringify(st.cast || []);
                        if (personasChanged) { st.personas = personas; st.cast = cast; }
                        if (translated || personasChanged) {
                            saveScenes(chatId, st);
                            log(`chat ${chatId}: added the translation to ${translated} saved line(s)`);
                        }
                        let model = null;
                        const getModel = async () => (model ||= { ...(await memoryModel()), signal: job.abort.signal });
                        const minPending = rebuild ? 1 : T.SCENE_MIN_PENDING;
                        if (S.nextSlice(st, messages, window, { minPending })) job.calls += await foldScenes(chatId, st, messages, window, await getModel(), job, { minPending });
                        if (S.nextRedo(st) || S.nextChapter(st) || S.nextArc(st) || S.nextFactMerge(st)) job.calls += await condense(chatId, st, await getModel(), job);
                        await indexScenes(chatId, st, job);
                    } while (job.again && !job.cancel);
                    job.state = 'done';
                } catch (error) {
                    job.state = job.cancel ? 'idle' : 'error';
                    job.error = job.cancel ? null : error?.message || String(error);
                    log(`chat ${chatId}: scenes ${job.cancel ? 'stopped' : job.error}`);
                } finally {
                    job.stage = null;
                    job.finishedAt = new Date().toISOString();
                    await rendered(chatId).catch(() => renderedCache.delete(chatId));
                    await flush().catch(() => {});
                }
            });
        }

        /** Throw away the chapters and make them again from the saved scenes. Scenes, facts and the ledger stay. */
        function rebuildChapters(chatId) {
            return enqueue(`scenes:${chatId}`, async () => {
                const job = { state: 'running', reason: 'chapters', calls: 0, startedAt: new Date().toISOString(), error: null, cancel: false, abort: new AbortController(), stage: '챕터 다시 묶기' };
                sceneJobs.set(chatId, job);
                try {
                    await checkFiles(chatId);
                    const st = structuredClone(loadScenes(chatId) || S.emptyStore());
                    const before = (st.chapters || []).length;
                    st.chapters = []; st.nextChapter = 1; st.arcs = []; st.nextArc = 1;
                    saveScenes(chatId, st);
                    const model = { ...(await memoryModel()), signal: job.abort.signal };
                    job.calls = await condense(chatId, st, model, job, { maxCalls: Infinity, chaptersOnly: true });
                    if (job.cancel) throw Error('중단했습니다.');
                    log(`chat ${chatId}: chapters rebuilt (${before} → ${(st.chapters || []).length})`);
                    job.state = 'done';
                } catch (error) {
                    job.state = job.cancel ? 'idle' : 'error';
                    job.error = job.cancel ? null : error?.message || String(error);
                } finally {
                    job.stage = null;
                    job.finishedAt = new Date().toISOString();
                    await rendered(chatId).catch(() => renderedCache.delete(chatId));
                    await flush().catch(() => {});
                }
            });
        }

        /** Run only the tidy pass on the saved ledger. */
        function tidyChat(chatId) {
            return enqueue(chatId, async () => {
                const job = { state: 'running', reason: 'tidy', stage: '장부 점검', done: 0, total: 1, startedAt: new Date().toISOString(), error: null };
                jobs.set(chatId, job);
                try {
                    await checkFiles(chatId);
                    const cached = loadLedger(chatId);
                    if (!cached) throw Error('아직 장부가 없습니다. 먼저 정리를 시작해 주세요.');
                    const ledger = structuredClone(cached);
                    const before = ledger.threads.filter(t => t.status === 'open').length;
                    const tidy = await tidyLedger(await memoryModel(), ledger, await chatMessages(chatId));
                    saveLedger(chatId, ledger);
                    job.result = { before, after: ledger.threads.filter(t => t.status === 'open').length, ...tidy };
                    job.done = 1;
                    job.state = 'done';
                    log(`chat ${chatId}: tidy ${before} → ${job.result.after} open (${tidy.calls} call(s))`);
                } catch (error) {
                    job.state = 'error';
                    job.error = error?.message || String(error);
                } finally {
                    job.stage = null;
                    job.finishedAt = new Date().toISOString();
                    await rendered(chatId).catch(() => renderedCache.delete(chatId));
                    await flush().catch(() => {});
                }
            });
        }

        /** Read messages from..to on a throwaway empty ledger, in the background. Nothing is saved to the chat's ledger. */
        async function startTrial(chatId, from, to) {
            await ready();
            if (trials.get(chatId)?.state === 'running') throw Error('이 방은 이미 구간 시험 중입니다. 끝날 때까지 기다려 주세요.');
            const messages = await chatMessages(chatId);
            const slice = messages.filter(m => m.number >= from && m.number <= to);
            if (!slice.length) throw Error(`${from}~${to}번 사이에 읽을 메시지가 없습니다.`);
            if (slice.length > T.TRIAL_MAX_MESSAGES) throw Error(`구간 시험은 메시지 ${T.TRIAL_MAX_MESSAGES}개까지만 할 수 있습니다. 범위를 줄여 주세요.`);
            const model = await memoryModel();
            const batches = L.planBatches(slice, T.REBUILD_BATCH_CHARS);
            const trial = { state: 'running', from, to, messages: slice.length, done: 0, total: batches.length, startedAt: new Date().toISOString(), result: null, error: null };
            trials.set(chatId, trial);
            trial.promise = (async () => {
                const ledger = L.emptyLedger();
                let dropped = 0;
                try {
                    for (const batch of batches) {
                        const at = messages.indexOf(batch[0]);
                        for (const part of await readBatch(model, ledger, batch, messages.slice(Math.max(0, at - T.CONTEXT_MESSAGES), at))) dropped += L.applyResult(ledger, part.parsed, part.batch).dropped;
                        trial.done++;
                    }
                    const before = ledger.threads.filter(t => t.status === 'open').length;
                    trial.stage = '장부 점검';
                    const tidy = await tidyLedger(model, ledger, slice);
                    trial.stage = '장면 정리';
                    const scenes = S.emptyStore();
                    for (;;) {
                        const next = S.nextSlice(scenes, slice, 0, { lead: 0, minVisible: 0 });
                        if (!next) break;
                        let applied = null;
                        for (let attempt = 0; attempt < 2 && !applied; attempt++) {
                            const parsed = L.parseJsonObject(await askModel(model, S.buildScenePrompt(scenes, next.slice, next.required), { maxTokens: 8192 }));
                            const result = parsed ? S.applyScenes(scenes, parsed, next.slice, next.required) : { error: '응답을 읽지 못했습니다' };
                            if (!result.error) applied = result; else trial.sceneError = result.error;
                        }
                        if (!applied) break;
                        S.commitScenes(scenes, applied);
                    }
                    trial.stage = null;
                    const memory = [S.renderScenes(scenes, null, { expand: 99, maxChars: 100000 }), `[아직 끝나지 않은 일]\n${L.renderCompact(ledger)}`].filter(Boolean).join('\n\n');
                    trial.result = { dropped, tidy: { before, after: ledger.threads.filter(t => t.status === 'open').length, ...tidy }, threads: ledger.threads, rendered: L.render(ledger), scenes: scenes.scenes, facts: scenes.facts, memory };
                    trial.state = 'done';
                    log(`chat ${chatId}: trial ${from}~${to} done (${batches.length} call(s), ${ledger.threads.length} thread(s))`);
                } catch (error) {
                    trial.state = 'error';
                    trial.error = error?.message || String(error);
                    trial.result = { dropped, threads: ledger.threads, rendered: L.render(ledger) };
                    log(`chat ${chatId}: trial ${from}~${to} failed: ${trial.error}`);
                } finally { trial.finishedAt = new Date().toISOString(); }
            })();
            return { started: true, messages: slice.length, total: batches.length };
        }

        /* ---------- prompt ---------- */

        function ledgerForReply(chatId) {
            const stored = loadLedger(chatId);
            return stored?.needsRebuild ? L.verifiedBefore(stored, stored.needsRebuild.number) : stored;
        }
        function scenesForReply(chatId) {
            const stored = loadScenes(chatId);
            const view = replyViews.get(chatId);
            return view && view.base === stored ? view.store : stored;
        }
        function checkScenesBeforeReply(chatId, view) {
            const stored = loadScenes(chatId);
            if (!stored || S.changedAt(stored, view) === -1) return replyViews.delete(chatId);
            const st = structuredClone(stored);
            const change = S.reconcileScenes(st, view);
            replyViews.set(chatId, { base: stored, store: st });
            log(`chat ${chatId}: ${change.dropped} scene(s) no longer match the chat; left out of this reply until folded again`);
        }
        /** The story's "today": the latest date the chat itself shows as of the last reply, else what the ledger has read. */
        function storyToday(chatId, ledger) {
            const day = storyDays.get(chatId) || null;
            const read = ledger?.storyDate || null;
            return day && (!read || day >= read) ? day : read;
        }

        /**
         * What {{memory_ledger}} becomes for a chat. Synchronous (needs ensureChat first). Nothing for a chat whose memory is off.
         * Within the size limit, in this order of need: the guidance before and after, what is still open, daily life, the story so
         * far, the recalled scenes, the close events, the original passages.
         */
        function renderLedger(chatId) {
            if (!chatEnabled(chatId)) return '';
            const ledger = ledgerForReply(chatId);
            const scenes = scenesForReply(chatId);
            const query = turnQuery.get(chatId) || '';
            const today = storyToday(chatId, ledger);
            const open = ledger ? L.renderCompact(ledger, { query, today }) : '';
            const routine = ledger ? L.renderRoutine(ledger, storyNow.get(chatId) || ledger.storyTime || null) : '';
            const fixed = [open ? `[아직 끝나지 않은 일]\n${open}` : '', routine].filter(Boolean);
            const style = settings().recallStyle;
            const header = memoryHeader(style);
            const footer = memoryFooter(style);
            let room = T.MEMORY_MAX_CHARS - header.length - footer.length - 40;
            for (let i = 0; i < fixed.length; i++) {
                fixed[i] = fitBlock(fixed[i], Math.max(0, Math.floor(room / (fixed.length - i))));
                room -= fixed[i].length + 2;
            }
            const story = [];
            if (scenes && room > 500) {
                const firstInside = windows.get(chatId) ?? scenes.window?.firstInside ?? null;
                const amount = RECALL_AMOUNTS[settings().recallAmount] || RECALL_AMOUNTS.normal;
                const recall = recalls.get(chatId);
                const picks = R.shownPicks(recall?.picks || [], amount.scenes);
                const chapterChars = CHAPTER_LENGTHS[settings().chapterLength] || CHAPTER_LENGTHS.normal;
                const total = 9000 + 4500 + chapterChars;
                const overviewMax = Math.min(total, Math.floor(room * (chapterChars > CHAPTER_LENGTHS.normal ? 0.65 : 0.5)));
                const scale = Math.min(1, overviewMax / total);
                const overview = S.renderScenes(scenes, firstInside, { maxChars: Math.floor(9000 * scale), factChars: Math.floor(4500 * scale), chapterChars: Math.floor(chapterChars * scale), query, today });
                if (overview) { story.push(overview); room -= overview.length + 2; }
                const recalled = room > 500 ? R.renderRecalled(scenes, picks, { maxChars: Math.min(amount.sceneChars, room) }) : '';
                if (recalled) { story.push(recalled); room -= recalled.length + 2; }
                const near = amount.near && room > 500 ? R.renderNearEvents(scenes, recall?.semantic || [], picks, { max: amount.near, maxChars: Math.min(5000, room) }) : '';
                if (near) { story.push(near); room -= near.length + 2; }
                const raw = room > 300 ? fitBlock(R.renderRaw((recall?.raw || []).slice(0, amount.raw)), room) : '';
                if (raw) story.push(raw);
            }
            const parts = [...story, ...fixed].filter(Boolean);
            return parts.length ? `${header}\n\n${parts.join('\n\n')}\n\n${footer}` : '';
        }
        /** renderLedger + sanitize (as upstream's {{기억}} render did), refreshing the macro cache. */
        async function rendered(chatId) {
            await ensureChat(chatId);
            const text = sanitize(renderLedger(chatId), T.MAX_RENDER_CHARS);
            renderedCache.set(chatId, text);
            return text;
        }

        /* ---------- before a reply ---------- */

        /**
         * Right before a reply is generated: if an already-read message was deleted or edited, undo what it put in the ledger
         * (snapshots only, no model call), then pick the scenes to recall. The newest reply was never read, so rerolling it needs
         * nothing undone. `regenerateMessageId`: the message being replaced (and everything after it) does not count.
         * `budgetMs`/`signal`: the interceptor time budget (see computeRecall).
         */
        async function syncBeforeReply(chatId, { regenerateMessageId, userMessage, budgetMs, signal } = {}) {
            await ensureChat(chatId);
            let view = await chatMessages(chatId);
            const replaced = typeof regenerateMessageId === 'string' ? view.findIndex(m => m.id === regenerateMessageId) : -1;
            if (replaced >= 0) view = view.slice(0, replaced);
            const running = jobs.get(chatId);
            if (running?.state === 'running') {
                log(`chat ${chatId}: ledger is still reading earlier messages, prompt uses the current ledger`);
            } else {
                await enqueue(chatId, async () => {
                    const stored = loadLedger(chatId);
                    if (!stored && store.blocked(userId, keys.ledger(chatId))) return;
                    const ledger = structuredClone(stored || L.emptyLedger());
                    const state = L.reconcile(ledger, settled(view));
                    if (state.rebuild) {
                        const number = changedNumber(ledger, settled(view), state.changedAt);
                        if (!ledger.needsRebuild || ledger.needsRebuild.number !== number) {
                            ledger.needsRebuild = { at: new Date().toISOString(), changedAt: state.changedAt, number };
                            saveLedger(chatId, ledger);
                        }
                    } else if (ledger.needsRebuild) {
                        delete ledger.needsRebuild;
                        saveLedger(chatId, ledger);
                    } else if (state.rolledBack) {
                        saveLedger(chatId, ledger);
                        log(`chat ${chatId}: undid message ${state.changedAt + 1} before the reply`);
                    }
                });
            }
            const nowTime = L.storyTime(view.slice(-4));
            if (nowTime) storyNow.set(chatId, nowTime);
            const day = L.storyDate(view);
            if (day) storyDays.set(chatId, day);
            const window = await chatWindow();
            windows.set(chatId, S.firstInsideWindow(view, Math.max(1, window - (userMessage ? 1 : 0))));
            checkScenesBeforeReply(chatId, view);
            await recallBeforeReply(chatId, view, userMessage, { budgetMs, signal });
            return rendered(chatId);
        }

        /* ---------- recall ---------- */

        function recallFingerprint(s) {
            return L.hashText(JSON.stringify([s.id, s.editedAt || null, s.title, s.time, s.place, s.weather || null, s.summary, s.events, s.loose || null, s.recollections, s.later || null, s.learned || null, s.heardLater || null]));
        }
        async function recallBeforeReply(chatId, view, userMessage, opts = {}) {
            turnQuery.set(chatId, [...view.slice(-3).map(m => m.content), userMessage || ''].join('\n').slice(-4000));
            const mode = RECALL_MODES.includes(settings().recall) ? settings().recall : 'model';
            const st = scenesForReply(chatId);
            if (mode === 'off' || !st) return recalls.delete(chatId);
            const firstInside = windows.get(chatId) ?? null;
            const list = R.candidates(st, firstInside);
            const tail = [...view.map(m => m.h), ...(userMessage ? [L.hashText(userMessage)] : [])].slice(-5);
            const key = L.hashText(JSON.stringify([mode, list.map(recallFingerprint), tail]));
            if (recalls.get(chatId)?.key === key) return;
            const entry = await computeRecall(chatId, st, view, userMessage, { mode, firstInside, list, ...opts });
            entry.key = key;
            recalls.set(chatId, entry);
            if (entry.picks.length || entry.error) log(`chat ${chatId}: recall ${entry.used} → ${entry.picks.map(p => p.id).join(', ') || 'none'} (${entry.ms} ms)${entry.error ? `; ${entry.error}` : ''}`);
        }

        /**
         * The recall itself: which old scenes come up for this turn, and why. Used before a reply and by the test.
         * Time budget (configurable: settings().recallBudgetMs, else tunables.RECALL_BUDGET_MS, default 6 s, because the host's
         * interceptor limit is 10 s by default): the meaning search query is capped at QUERY_TIMEOUT_MS (4 s) and the model pick
         * is only started with RECALL_MIN_MODEL_MS (3 s) left; every awaited step is also hard-bounded so the function returns
         * within the budget (plus a small margin) with the fast pick when the model was too slow.
         */
        async function computeRecall(chatId, st, view, userMessage, { mode, firstInside, list, budgetMs, signal }) {
            const recent = view.slice(-6);
            const budget = Number(budgetMs) > 0 ? Number(budgetMs) : Number(settings().recallBudgetMs) > 0 ? Number(settings().recallBudgetMs) : T.RECALL_BUDGET_MS;
            const entry = { mode, picks: [], ms: 0, at: new Date().toISOString(), error: null, used: mode, budgetMs: budget };
            const started = now();
            const left = () => budget - (now() - started);
            if (list.length) {
                const ledger = ledgerForReply(chatId);
                try { await bounded(embeddingSource(), Math.min(T.QUERY_TIMEOUT_MS, left()), signal); } catch { /* the pick goes on without meaning search */ }
                const index = await ensureVectors(chatId);
                if (index && Object.keys(index.items).length && left() > 1000) {
                    try {
                        const texts = V.queryTexts(recent, userMessage);
                        const cap = Math.min(T.QUERY_TIMEOUT_MS, left());
                        const queries = await bounded(embedTexts(texts, 'query', signal), cap, signal);
                        entry.semantic = V.nearest(index, queries, list, 6);
                        entry.pointed = [];
                        texts.forEach((t, i) => {
                            if (i === 0 && texts.length > 1) return;
                            if (!V.POINTS_BACK.test(t)) return;
                            const top = V.nearest(index, [queries[i]], list, 1)[0];
                            if (top && !entry.pointed.some(x => x.id === top.id)) entry.pointed.push({ id: top.id, piece: top.piece, text: t });
                        });
                    } catch (error) {
                        entry.semanticError = String(error?.message || error);
                    }
                }
                if (mode === 'model' && left() < T.RECALL_MIN_MODEL_MS) {
                    entry.error = '뜻 찾기가 오래 걸려 이번에는 빠른 방식으로 골랐습니다';
                    entry.used = 'fast';
                } else if (mode === 'model') {
                    try {
                        const model = await bounded(memoryModel(), Math.max(1, left()), signal);
                        const ms = Math.max(T.RECALL_MIN_ABORT_MS, left());
                        const ctl = new AbortController();
                        const stop = () => ctl.abort();
                        const timer = setTimeout(stop, ms);
                        signal?.addEventListener?.('abort', stop, { once: true });
                        model.signal = ctl.signal;
                        try {
                            const reply = await bounded(askModel(model, R.buildRecallPrompt(list, ledger, recent, userMessage, st.chapters || [], entry.semantic || []), { maxTokens: 600 }), ms, ctl.signal);
                            const parsed = L.parseJsonObject(reply);
                            if (!parsed) throw Error('기억 모델의 답을 읽지 못했습니다');
                            entry.picks = R.applyRecall(parsed, list, st.chapters || [], [...recent.map(m => m.content), userMessage || ''].join(' '));
                        } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); ctl.abort(); }
                    } catch (error) {
                        entry.error = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? `${Math.round(budget / 100) / 10}초 안에 회상이 끝나지 않아 빠른 방식으로 골랐습니다` : String(error?.message || error);
                        entry.used = 'fast';
                    }
                }
                if (entry.used === 'fast') entry.picks = R.fastRecall(list, ledger, recent, userMessage);
                const strong = (entry.semantic || []).find(x => x.strong && !entry.picks.some(p => p.id === x.id));
                if (strong && entry.picks.length < R.MAX_PICKS) entry.picks.push({ id: strong.id, why: '뜻이 가까움(임베딩)' });
                const latest = R.latestUser(recent, userMessage).text;
                for (const x of [...(entry.pointed || [])].reverse()) {
                    entry.picks = [{ id: x.id, why: `예전 일을 가리키는 말: "${x.text.slice(0, 40)}${x.text.length > 40 ? '…' : ''}"` }, ...entry.picks.filter(p => p.id !== x.id)].slice(0, R.MAX_PICKS);
                }
                const wordHit = R.directHit(list, latest);
                if (wordHit && entry.picks.length < R.MAX_PICKS && !entry.picks.some(p => p.id === wordHit.id)) entry.picks.push({ id: wordHit.id, why: `방금 메시지의 낱말(${wordHit.hits.slice(0, 3).join(', ')})이 이 장면에 있음` });
                entry.raw = R.rawHits(view.filter(m => firstInside != null && m.number < firstInside), latest);
                if (wordHit) entry.direct = { id: wordHit.id, hits: wordHit.hits.slice(0, 5) };
                entry.picks = R.withFollowUps(st, entry.picks, list);
            }
            entry.ms = now() - started;
            return entry;
        }

        /* ---------- chat branches ---------- */

        /**
         * A chat was branched (Lumiverse CHAT_FORKED): copy the source chat's memory for the common prefix into the new chat
         * (upstream inheritBranch). `idMap`: source message id -> new message id (the host sends it with the event). Never touches
         * the source, never overwrites an existing destination file or setting, so a repeated event is harmless.
         */
        async function inheritBranch(sourceId, targetId, idMap = null) {
            safeChatId(sourceId); safeChatId(targetId);
            if (sourceId === targetId) throw Error('원본 방에 분기 기억을 쓸 수 없습니다.');
            await ready();
            return enqueue(targetId, async () => {
                const files = [keys.ledger(targetId), keys.scenes(targetId), keys.vectors(targetId)];
                // This also protects an existing/broken destination file.
                for (const key of files) if ((await store.readText(userId, key)) !== null) return { skipped: true };
                if (settings().chats?.[targetId]) return { skipped: true };
                await checkFiles(sourceId);
                await checkFiles(targetId);
                const source = await chatMessages(sourceId);
                const target = await chatMessages(targetId);
                const ids = new Map(idMap instanceof Map ? idMap : Object.entries(idMap || {}));
                if (!ids.size) for (let i = 0; i < target.length && i < source.length; i++) if (source[i].number === target[i].number) ids.set(source[i].id, target[i].id);
                const result = branchMemory(loadLedger(sourceId), loadScenes(sourceId), source, target, ids);
                const sourceSettings = settings().chats?.[sourceId];
                const vectors = vectorCache.get(sourceId) || await store.getJson(userId, keys.vectors(sourceId), null, { replaceable: true });
                let copiedVectors = null;
                if (result.scenes && vectors?.v === V.INDEX_VERSION && vectors.items) {
                    copiedVectors = structuredClone(vectors);
                    V.prune(copiedVectors, result.scenes.scenes);
                }
                try {
                    if (result.ledger) saveLedger(targetId, result.ledger);
                    if (result.scenes) saveScenes(targetId, result.scenes);
                    if (copiedVectors) saveVectors(targetId, copiedVectors);
                    if (sourceSettings) saveSettings({ ...settings(), chats: { ...settings().chats, [targetId]: structuredClone(sourceSettings) } });
                    await flush();
                } catch (error) {
                    for (const key of files) await store.remove(userId, key);
                    ledgerCache.delete(targetId); sceneCache.delete(targetId); vectorCache.delete(targetId);
                    throw error;
                }
                log(`branch ${sourceId} -> ${targetId}: inherited ${result.matched} message(s), ${result.scenes?.scenes.length || 0} scene(s)${result.ledgerReset ? '; old fork: ledger will be read again' : ''}`);
                return result;
            });
        }
        /** The event hook: failures are shown on the new room's job line, never thrown into the host. */
        async function branchCreated(sourceId, targetId, idMap) {
            try { return await inheritBranch(sourceId, targetId, idMap); } catch (error) {
                log(`branch inheritance failed: ${error?.message || error}`);
                if (CHAT_ID.test(String(targetId))) jobs.set(targetId, { state: 'error', error: `분기 기억을 넘기지 못했습니다: ${error?.message || error}. 기억 서재에서 정리해 주세요.` });
                return { error: String(error?.message || error) };
            }
        }

        /* ---------- admin helpers used by the routes ---------- */

        function health() {
            const broken = store.brokenList(userId).filter(b => !b.replaceable).map(b => ({ file: b.key.split('/').pop(), backup: b.backup, reason: b.reason, error: b.error, at: b.at }));
            return { marinara: null, tested: null, patches: {}, failed: [], broken, host: 'lumiverse', lastSaveError };
        }

        return {
            userId, ready, ensureChat, ensureVectors, settings, saveSettings, chatEnabled, setChatEnabled, loadLedger, saveLedger, loadScenes, saveScenes,
            loadVectors, embeddingMode, embeddingSource, embeddingModel, embedTexts, indexScenes, chatMessages, settled, chatWindow, chatCast,
            memoryModel, askModel, enqueue, jobStatus, jobs, sceneJobs, trials, processChat, processScenes, rebuildChapters, tidyChat, startTrial,
            renderLedger, rendered, syncBeforeReply, recallBeforeReply, computeRecall, health, storyToday, storyNow, windows, recalls, replyViews,
            connectionList, checkFiles, flush, getEmbedError: () => embedSource.error, clearVectors: () => vectorCache.clear(), clearRecalls: () => recalls.clear(),
            clearRecall: chatId => { recalls.delete(chatId); }, clearConnectionsCache: () => { connectionsCache = { at: 0, list: null }; },
            keys, persist, saveLastReply, inheritBranch, branchCreated,
        };
    }
}
