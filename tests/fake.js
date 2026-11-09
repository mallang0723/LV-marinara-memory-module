// Synthetic Spindle backend API for the tests and the browser harness. No host, no provider, no network.
// Behaviour follows the Lumiverse source (see src/common/host-adapter.js header) where it matters:
//  - everything takes the user id (operator-scoped install); a call without it fails like the host,
//  - gated calls fail with "PERMISSION_DENIED: <perm>" (chat.getMessages needs chat_mutation, connections.list needs generation ...),
//  - lists are paged (max 200), chat.getMessages returns every message (hidden ones too),
//  - userStorage.read of a missing file throws, getJson swallows every error (the real one does), write creates directories,
//  - the model (generate.quiet) is scripted: tests/fake-model.js by default, or f.model = async ({messages, parameters, signal}) => text.
import { replyFor } from './fake-model.js';

export function fake(opts = {}) {
    const files = new Map();                  // `${user}:${path}` -> string
    const calls = [], sent = [], toasts = [];
    const interceptors = [], macros = new Map(), commands = { list: [], onInvoked: null };
    const handlers = new Map();
    const frontendHandlers = new Set();
    let seq = 0;
    const nextId = p => `${p}-${++seq}`;
    const clone = v => JSON.parse(JSON.stringify(v ?? null));
    const state = { denied: [...(opts.denied || [])], modelCalls: [], modelCounts: {}, modelDelayMs: 0, modelHang: false, modelFail: null, userRequired: true, quietParamsSeen: [], embedFail: null };
    const need = (perm, user) => {
        if (perm && state.denied.includes(perm)) throw new Error(`PERMISSION_DENIED: ${perm} — ${perm} permission not granted`);
        if (user !== undefined && state.userRequired && !user) throw new Error('userId is required for operator-scoped extensions');
    };
    const log = (name, ...args) => calls.push({ name, args: clone(args) });
    const now = () => Math.floor(Date.now() / 1000);

    const chats = new Map([['chat-a', { id: 'chat-a', character_id: 'char-haru', name: '하루방', metadata: { chat_world_book_ids: ['wb-town'] }, created_at: 1, updated_at: 2 }]]);
    const messages = new Map([['chat-a', []]]);
    const characters = new Map([
        ['char-haru', { id: 'char-haru', name: '하루', description: '빵집 사장', personality: '무뚝뚝', scenario: '가을', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', tags: [], alternate_greetings: [], creator: '', image_id: null, world_book_ids: ['wb-haru'], extensions: {}, created_at: 1, updated_at: 1 }],
        ['char-seoa', { id: 'char-seoa', name: '서아', description: '이웃', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', tags: [], alternate_greetings: [], creator: '', image_id: null, world_book_ids: [], extensions: {}, created_at: 1, updated_at: 1 }],
    ]);
    const personas = new Map([['p-user', { id: 'p-user', name: '서아', title: '', description: '나', image_id: null, attached_world_book_id: 'wb-persona', folder: '', is_default: true, metadata: {}, created_at: 1, updated_at: 1 }]]);
    const books = new Map([['wb-town', { id: 'wb-town', name: '동네', description: '', metadata: {}, created_at: 1, updated_at: 1 }], ['wb-haru', { id: 'wb-haru', name: '하루 설정', description: '', metadata: {}, created_at: 1, updated_at: 1 }], ['wb-persona', { id: 'wb-persona', name: '서아 설정', description: '', metadata: {}, created_at: 1, updated_at: 1 }], ['wb-global', { id: 'wb-global', name: '공통', description: '', metadata: {}, created_at: 1, updated_at: 1 }], ['wb-other', { id: 'wb-other', name: '관계없음', description: '', metadata: {}, created_at: 1, updated_at: 1 }]]);
    const entries = new Map([['wb-town', [{ id: 'e1', world_book_id: 'wb-town', uid: '1', key: ['빵집'], keysecondary: [], content: '30년 된 빵집.', comment: '빵집', order_value: 20, selective: false, constant: false, disabled: false, extensions: {}, updated_at: 1 }]]]);
    if (opts.manyBooks) for (let i = 0; i < opts.manyBooks; i++) books.set(`wb-bulk-${i}`, { id: `wb-bulk-${i}`, name: `대량 ${i}`, description: '', metadata: {}, created_at: 1, updated_at: 1 });
    if (opts.manyChats) for (let i = 0; i < opts.manyChats; i++) chats.set(`chat-bulk-${i}`, { id: `chat-bulk-${i}`, character_id: 'char-haru', name: `대량 ${i}`, metadata: {}, created_at: 1, updated_at: 3 });
    const connections = [{ id: 'conn-a', name: '연결 A', provider: 'fake', api_url: '', model: 'm-a', preset_id: null, is_default: true, has_api_key: true, metadata: {}, reasoning_bindings: null, created_at: 1, updated_at: 1 }, { id: 'conn-b', name: '연결 B', provider: 'fake', api_url: '', model: 'm-b', preset_id: null, is_default: false, has_api_key: true, metadata: {}, reasoning_bindings: null, created_at: 1, updated_at: 1 }];
    const page = (list, o = {}) => {
        if (o.limit > 200) throw new Error('limit over 200');
        const limit = Math.min(o.limit || 50, 200), offset = o.offset || 0;
        return { data: clone(list.slice(offset, offset + limit)), total: list.length };
    };
    const emit = (event, payload, user) => { for (const h of [...(handlers.get(event) || [])]) h(clone(payload), user); };

    const api = {
        permissions: { has: p => !state.denied.includes(p), onChanged: fn => { api._onPerm = fn; return () => { api._onPerm = null; }; }, onDenied: () => () => {}, getGranted: async () => [] },
        frontendCapabilities: { declare: () => () => {} },
        userStorage: {
            exists: async (path, user) => { need(null, user); return files.has(`${user}:${path}`); },
            read: async (path, user) => { need(null, user); if (!files.has(`${user}:${path}`)) throw new Error('File not found'); return files.get(`${user}:${path}`); },
            write: async (path, data, user) => { need(null, user); if (path.includes('..')) throw new Error('Path traversal detected'); files.set(`${user}:${path}`, String(data)); },
            delete: async (path, user) => { need(null, user); files.delete(`${user}:${path}`); },
            list: async (prefix = '', user) => { need(null, user); return [...files.keys()].filter(k => k.startsWith(`${user}:${prefix}`)).map(k => k.slice(user.length + 1)); },
            getJson: async (path, o = {}) => { try { return JSON.parse(files.get(`${o.userId}:${path}`)); } catch { if ('fallback' in o) return o.fallback; throw new Error(`Failed to parse JSON from ${path}`); } },
            setJson: async (path, v, o = {}) => { need(null, o.userId); files.set(`${o.userId}:${path}`, JSON.stringify(v, null, o.indent ?? 2)); },
        },
        on(event, handler) {
            if (/^GENERATION_|^STREAM_/.test(event) && state.denied.includes('generation')) return () => {};
            if (!handlers.has(event)) handlers.set(event, new Set());
            handlers.get(event).add(handler);
            return () => handlers.get(event).delete(handler);
        },
        registerInterceptor(handler, priority) {
            if (state.denied.includes('interceptor')) return () => {};
            interceptors.splice(0, interceptors.length);   // a second registration replaces the first (worker-host.ts:3052)
            const rec = { handler, priority };
            interceptors.push(rec);
            return () => { const i = interceptors.indexOf(rec); if (i >= 0) interceptors.splice(i, 1); };
        },
        registerMacro(def) { macros.set(def.name.toLowerCase(), def); },
        unregisterMacro(name) { macros.delete(String(name).toLowerCase()); },
        commands: { register(list) { commands.list = clone(list); if (list.length > 20) throw new Error('Max 20 commands'); }, unregister() { commands.list = []; }, onInvoked(fn) { commands.onInvoked = fn; return () => { commands.onInvoked = null; }; } },
        chats: {
            list: async o => { need('chats', o?.userId); return page([...chats.values()], o); },
            get: async (id, user) => { need('chats', user); return chats.has(id) ? clone(chats.get(id)) : null; },
            getActive: async user => { need('chats', user); return clone(chats.get('chat-a')); },
            getMemories: async (id, o) => { need('chats', o?.userId); return { chunks: [{ content: '예전에 빵집에서 있었던 일', score: 0.9 }], formatted: '', count: 1, enabled: true }; },
        },
        chat: {
            getMessages: async id => { need('chat_mutation'); return clone(messages.get(id) || []); },
        },
        characters: { get: async (id, user) => { need('characters', user); return characters.has(id) ? clone(characters.get(id)) : null; }, list: async o => { need('characters', o?.userId); return page([...characters.values()], o); } },
        personas: {
            get: async (id, user) => { need('personas', user); return personas.has(id) ? clone(personas.get(id)) : null; },
            getActive: async user => { need('personas', user); return clone(personas.get('p-user')); },
        },
        world_books: {
            list: async o => { need('world_books', o?.userId); return page([...books.values()], o); },
            get: async (id, user) => { need('world_books', user); return books.has(id) ? clone(books.get(id)) : null; },
            getGlobal: async user => { need('world_books', user); return ['wb-global']; },
            entries: {
                list: async (bookId, o) => { need('world_books', o?.userId); return page(entries.get(bookId) || [], o); },
                create: async (bookId, input, user) => {
                    need('world_books', user); log('entries.create', bookId, input);
                    const e = { id: nextId('entry'), world_book_id: bookId, uid: nextId('uid'), key: [], keysecondary: [], content: '', comment: '', order_value: 100, selective: false, constant: false, disabled: false, extensions: {}, ...clone(input), updated_at: now() };
                    if (!entries.has(bookId)) entries.set(bookId, []);
                    entries.get(bookId).push(e); return clone(e);
                },
                update: async (entryId, input, user) => {
                    need('world_books', user); log('entries.update', entryId, input);
                    for (const list of entries.values()) { const e = list.find(x => x.id === entryId); if (e) { const { extensions, ...rest } = clone(input); Object.assign(e, rest); if (extensions) e.extensions = { ...e.extensions, ...extensions }; return clone(e); } }
                    throw new Error('World book entry not found');
                },
                setExtension: async (entryId, ns, value, user) => {
                    need('world_books', user); log('entries.setExtension', entryId, ns, value);
                    for (const list of entries.values()) { const e = list.find(x => x.id === entryId); if (e) { e.extensions = { ...e.extensions, [ns]: clone(value) }; return clone(e); } }
                    throw new Error('World book entry not found');
                },
            },
        },
        connections: { list: async user => { need('generation', user); return clone(connections); }, get: async (id, user) => { need('generation', user); return clone(connections.find(c => c.id === id) || null); } },
        generate: {
            quiet: async input => {
                need('generation', input?.userId);
                state.modelCalls.push({ messages: clone(input.messages), connection_id: input.connection_id, parameters: clone(input.parameters) });
                state.quietParamsSeen.push(clone(input.parameters));
                if (state.modelFail) throw new Error(typeof state.modelFail === 'function' ? state.modelFail(input) : state.modelFail);
                if (state.modelHang) return new Promise((_, reject) => { const err = Object.assign(new Error('Aborted'), { name: 'AbortError' }); if (input.signal?.aborted) reject(err); input.signal?.addEventListener('abort', () => reject(err), { once: true }); });
                if (state.modelDelayMs) await new Promise((res, rej) => { const t = setTimeout(res, state.modelDelayMs); input.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true }); });
                const content = f.model ? await f.model({ messages: input.messages, parameters: input.parameters, signal: input.signal }) : replyFor(input.messages, state.modelCounts);
                return { content, finish_reason: 'stop' };
            },
        },
        embeddings: {
            listConnections: async o => { need('embeddings', o?.userId); return [{ id: 'emb-a', name: '임베딩 A', provider: 'fake', model: 'fake-embed', dimensions: 64, enabled: true, is_primary: true, has_api_key: true }]; },
            embed: async (input, o) => {
                need('embeddings', input?.userId); state.embedCalls = (state.embedCalls || 0) + 1;
                if (state.embedFail) throw new Error(state.embedFail);
                const vec = text => { const v = new Array(64).fill(0); const t = String(text).replace(/\s+/g, ''); for (let i = 0; i + 2 <= t.length; i++) { let h = 0; for (const ch of t.slice(i, i + 2)) h = (h * 31 + ch.codePointAt(0)) >>> 0; v[h % 64] += 1; } return v; };
                return { embeddings: input.texts.map(vec), connection_id: input.connection_id || 'emb-a', model: 'fake-embed', dimensions: 64 };
            },
        },
        onFrontendMessage(fn) {
            frontendHandlers.add(fn);
            f.frontendHandler = (...args) => { for (const handler of frontendHandlers) handler(...args); };
            return () => { frontendHandlers.delete(fn); if (!frontendHandlers.size) f.frontendHandler = null; };
        },
        sendToFrontend(msg, user, o) {
            sent.push({ msg: clone(msg), user, o }); opts.onSend?.(clone(msg), user, o);
            if (msg.event === 'memory-read-summarization' && !opts.noSettingsFrontend) queueMicrotask(() => {
                const value = state.summarization ?? null;
                f.frontendHandler?.({ type: 'memory-summarization-result', id: msg.id, ok: value !== null, value }, user);
            });
        },
    };
    const f = {
        api, state, files, calls, sent, interceptors, macros, commands, chats, characters, personas, books, entries, messages, connections, handlers,
        frontendHandler: null, model: null, toasts,
        emit,
        /** Appends messages [{role, name, content, hidden?, personaId?}] to a chat, numbering them like the host (index_in_chat). */
        addMessages(chatId, list) {
            if (!chats.has(chatId)) chats.set(chatId, { id: chatId, name: chatId, metadata: {} });
            if (!messages.has(chatId)) messages.set(chatId, []);
            const arr = messages.get(chatId);
            for (const m of list) {
                const extra = { ...(m.hidden ? { hidden: true } : {}), ...(m.personaId ? { persona_id: m.personaId } : {}) };
                const user = m.role === 'user';
                arr.push({ id: m.id || nextId('m'), chat_id: chatId, index_in_chat: arr.length, is_user: user, name: m.name || (user ? '서아' : '하루'), role: user ? 'user' : 'assistant', content: m.content, send_date: now(), extra, swipe_id: 0, swipes: [m.content], swipe_dates: [now()], parent_message_id: null, branch_id: null, created_at: now() });
            }
            return arr;
        },
        /** Runs the registered interceptor like the host: handler(messages, ctx) -> array or {messages, breakdown}. */
        async intercept(prompt, ctx = {}) {
            let cur = prompt, breakdown = [];
            for (const { handler } of [...interceptors].sort((a, b) => a.priority - b.priority)) {
                const r = await handler(clone(cur), { userId: 'u1', chatId: 'chat-a', generationId: 'g1', generationType: 'normal', isDryRun: false, signal: new AbortController().signal, ...ctx });
                cur = Array.isArray(r) ? r : r.messages;
                if (r?.breakdown) breakdown = r.breakdown;
            }
            return { messages: cur, breakdown };
        },
        /** Sends an api frame through the registered frontend handler and returns the reply. */
        async rpc(method, path, body, user = 'u1') {
            return new Promise(resolve => {
                const before = sent.length;
                const requestId = nextId('req');
                const orig = opts.onSend;
                const check = () => { const hit = sent.slice(before).find(s => s.msg.requestId === requestId); if (hit) resolve(hit.msg); else setTimeout(check, 1); };
                f.frontendHandler({ requestId, type: 'api', method, path, body }, user, 'sess');
                check();
            });
        },
        invokeCommand(id, ctx = {}) { return commands.onInvoked?.(id, { route: '/chat/chat-a', chatId: 'chat-a', ...ctx }); },
    };
    return f;
}

/** A chat history prompt as the host hands it to the interceptor: system..., then chat turns flagged __isChatHistory. */
export function promptFor(turns, { system = ['당신은 롤플레이 어시스턴트입니다.'], idPrefix = 'm' } = {}) {
    return [
        ...system.map(content => ({ role: 'system', content })),
        ...turns.map((t, i) => ({ role: t.role, content: t.content, __isChatHistory: true, sourceMessageId: t.id || `${idPrefix}-${i}`, sourceIndexInChat: i })),
    ];
}
