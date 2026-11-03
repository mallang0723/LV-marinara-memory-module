// 기억 서재 (Lumiverse) — backend entry. The Spindle worker exposes the API as global `spindle`.
// Wires: store, host adapter, memory service, the router (frontend RPC), the interceptor, the {{memory_ledger}} macro,
// GENERATION_ENDED -> ledger update, the Ctrl+K commands, and permission changes (a permission granted later is picked up).
import { createStore } from './common/store.js';
import { createHostAdapter } from './common/host-adapter.js';
import { createRouter } from './common/router.js';
import { createInjector } from './common/injector.js';
import { registerHostRoutes } from './common/host-routes.js';
import { createMemoryService } from './memory/service.js';
import { registerMemoryRoutes } from './memory/routes.js';

export const MACRO_NAME = 'memory_ledger';   // the macro lexer only knows [a-zA-Z0-9_-] names (src/macros/MacroLexer.ts:136), so no {{기억}}
export const COMMANDS = [
    { id: 'open-memory', label: '기억 서재 열기', description: '장면·사실·장부를 보고 고칩니다', keywords: ['기억', '서재', '장부', 'memory', 'ledger'], scope: 'global' },
    { id: 'memory-continue', label: '이 방 기억 이어서 정리', description: '지금 열린 채팅의 기억을 이어서 정리합니다', keywords: ['기억', '정리', 'memory'], scope: 'chat' },
    { id: 'memory-toggle', label: '이 방 기억 켜기/끄기', description: '지금 열린 채팅에서 기억 주입을 켜거나 끕니다', keywords: ['기억', '끄기', '켜기', 'memory'], scope: 'chat' },
];

export function start(api, options = {}) {
    const log = m => { try { api.log?.info?.(`[memory-library] ${m}`); } catch { /* optional */ } };
    const store = createStore(api, options.store);
    const host = createHostAdapter(api, { log });
    const service = createMemoryService({ host, store, log, tunables: options.tunables || {} });
    const router = createRouter();
    const disposers = [];
    const timers = new Set();

    registerHostRoutes(router, host);
    registerMemoryRoutes(router, service);
    router.add('GET', 'ext/info', async ({ userId }) => ({ version: service.VERSION, permissions: Object.fromEntries(['generation', 'chats', 'chat_mutation', 'characters', 'interceptor'].map(p => [p, api.permissions?.has ? api.permissions.has(p) : true])), userId: !!userId}));
    router.add('POST', 'ext/settings', async ({ userId, body }) => {
        const um = service.forUser(userId);
        await um.ready();
        const allowed = ['moduleMemory', 'autoInject', 'interceptorBudgetMs', 'window'];
        const next = { ...um.settings() };
        for (const k of allowed) if (k in (body || {})) next[k] = body[k];
        um.saveSettings(next);
        await um.flush();
        return { settings: Object.fromEntries(allowed.map(k => [k, next[k]])) };
    });
    router.add('GET', 'ext/settings', async ({ userId }) => {
        const um = service.forUser(userId);
        await um.ready();
        const s = um.settings();
        return { moduleMemory: s.moduleMemory !== false, autoInject: s.autoInject !== false, interceptorBudgetMs: s.interceptorBudgetMs || 6000, window: s.window || service.T.DEFAULT_WINDOW, windowInfo: await um.chatWindowInfo() };
    });
    disposers.push(router.attach(api));

    const injector = createInjector({ service, log });
    let offInterceptor = null, offEnded = null, offForked = null, macroOn = false, offPerm = null, offCommands = null;

    function wire() {
        // the interceptor needs the `interceptor` permission; it can be granted after the extension started
        if (!offInterceptor && (!api.permissions?.has || api.permissions.has('interceptor'))) {
            try { offInterceptor = api.registerInterceptor(injector.handler, 100); } catch (e) { log(`registerInterceptor: ${e?.message || e}`); }
        }
        if (!macroOn) {
            try {
                api.registerMacro({
                    name: MACRO_NAME, category: 'extension:anon_memory_lv', description: '기억 서재가 정리한 기억 본문(켜 둔 채팅만). 프리셋에 넣으면 자동 주입과 겹치지 않고 갱신된 본문으로 바뀝니다.', returnType: 'string', volatile: true, args: [],
                    // pull handler: only the in-memory cache, answered at once (the host waits 5 s at most, worker-host.ts:2915-2925);
                    // never updateMacroValue (that cache is global per macro name, worker-host.ts:3019, not per chat)
                    handler: ctx => service.renderedCache.get(ctx?.chatId || ctx?.env?.chat?.id || '') || '',
                });
                macroOn = true;
            } catch (e) { log(`registerMacro: ${e?.message || e}`); }
            // NOTE: if another extension (e.g. LV-AnonMemory) already owns {{memory_ledger}}, the host refuses the second owner by returning
            // false inside the host (MacroRegistry.registerMacro); the worker gets no error, so this cannot be detected from here.
        }
        // GENERATION_ENDED is refused silently without `generation`; wire it again when that is granted
        if (!offEnded && (!api.permissions?.has || api.permissions.has('generation'))) {
            offEnded = api.on('GENERATION_ENDED', (payload, userId) => {
                try {
                    if (!payload || typeof payload.chatId !== 'string' || !userId) return;
                    if (payload.error) return;
                    if (payload.generationType === 'impersonate' || payload.generationType === 'quiet') return;
                    const um = service.forUser(userId);
                    const t = setTimeout(async () => {
                        timers.delete(t);
                        try { await um.ready(); await um.ensureChat(payload.chatId); if (um.settings().moduleMemory !== false && um.chatEnabled(payload.chatId)) await um.processChat(payload.chatId, { reason: 'reply' }); } catch (e) { log(`reply hook: ${e?.message || e}`); }
                    }, options.afterReplyMs ?? 1500);
                    timers.add(t);
                } catch (e) { log(`GENERATION_ENDED: ${e?.message || e}`); }
            });
        }
    }
    // CHAT_FORKED needs no permission: a new branch inherits the source chat's memory (before the user's first message there)
    try {
        offForked = api.on('CHAT_FORKED', async (payload, userId) => {
            try {
                if (!payload || typeof payload.sourceChatId !== 'string' || typeof payload.forkedChatId !== 'string' || !userId) return;
                const um = service.forUser(userId);
                await um.ready();
                if (um.settings().moduleMemory === false) return;
                await um.branchCreated(payload.sourceChatId, payload.forkedChatId, payload.messageIdMap || {});
            } catch (e) { log(`CHAT_FORKED: ${e?.message || e}`); }
        });
    } catch (e) { log(`CHAT_FORKED: ${e?.message || e}`); }
    wire();
    try { offPerm = api.permissions?.onChanged?.(detail => { if (detail?.permission === 'embeddings') for (const um of service.users?.values?.() || []) um.embeddingSource?.(true); wire(); }); } catch { /* optional */ }

    // Ctrl+K: the host passes the invoking user to the worker message but not to the handler (worker-runtime.ts:5195-5200),
    // so the backend only broadcasts "command X in chat Y" and each frontend acts if it is looking at that chat.
    try {
        api.commands.register(COMMANDS);
        offCommands = api.commands.onInvoked((id, context) => {
            try { api.sendToFrontend({ event: 'command', id, chatId: context?.chatId || null }); } catch (e) { log(`command ${id}: ${e?.message || e}`); }
        });
    } catch (e) { log(`commands: ${e?.message || e}`); }

    return async () => {
        host.dispose();
        for (const t of timers) clearTimeout(t);
        for (const d of [offInterceptor, offEnded, offForked, offPerm, offCommands, ...disposers]) { try { d?.(); } catch { /* ignore */ } }
        try { api.unregisterMacro?.(MACRO_NAME); } catch { /* ignore */ }
        try { await store.flush(); } catch { /* ignore */ }
    };
}

if (typeof spindle !== 'undefined') start(spindle);
