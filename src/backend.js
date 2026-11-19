// 기억 서재 (Lumiverse) — backend entry. The Spindle worker exposes the API as global `spindle`.
// Wires: store, host adapter, memory service, the router (frontend RPC), the interceptor, the {{memory_ledger}} macro,
// GENERATION_ENDED -> ledger update, the Ctrl+K commands, and permission changes (a permission granted later is picked up).
import { createHostAdapter } from './common/host-adapter.js';
import { createRouter } from './common/router.js';
import { createInjector } from './common/injector.js';
import { registerHostRoutes } from './common/host-routes.js';
import { createManager, MEMORY_MARKER } from './adapter/manager.js';
import { createReference } from './adapter/reference.js';
import { VERSION } from './version.js';

export const MACRO_NAME = 'memory_ledger';   // the macro lexer only knows [a-zA-Z0-9_-] names (src/macros/MacroLexer.ts:136), so no {{기억}}
export const COMMANDS = [
    { id: 'open-memory', label: '기억 서재 열기', description: '장면·사실·장부를 보고 고칩니다', keywords: ['기억', '서재', '장부', 'memory', 'ledger'], scope: 'global' },
    { id: 'memory-continue', label: '이 방 기억 이어서 정리', description: '지금 열린 채팅의 기억을 이어서 정리합니다', keywords: ['기억', '정리', 'memory'], scope: 'chat' },
    { id: 'memory-toggle', label: '이 방 기억 켜기/끄기', description: '지금 열린 채팅에서 기억 주입을 켜거나 끕니다', keywords: ['기억', '끄기', '켜기', 'memory'], scope: 'chat' },
];

export function start(api, options = {}) {
    const log = m => { try { api.log?.info?.(`[memory-library] ${m}`); } catch { /* optional */ } };
    const host = createHostAdapter(api, { log });
    const manager = createManager({ api, log, host, version: VERSION, tunables: options.tunables || {}, afterReplyMs: options.afterReplyMs, debounceMs: options.store?.debounceMs });
    manager.translator.publish();   // LV-TX v1 handshake: { requires: [] }, silently skipped on a host without rpcPool
    const router = createRouter();
    const disposers = [];
    const reference = createReference({ api, manager, host, log });
    reference.publish();   // `anon_memory_lv.rendered`: the ledger text for the anonymous community (see adapter/reference.js)
    disposers.push(() => reference.dispose());
    const timers = manager.timers;

    registerHostRoutes(router, host);
    manager.mount(router);
    router.add('GET', 'ext/info', async ({ userId }) => ({ version: VERSION, permissions: Object.fromEntries(['generation', 'chats', 'chat_mutation', 'characters', 'interceptor'].map(p => [p, api.permissions?.has ? api.permissions.has(p) : true])), userId: !!userId, saveFailures: userId && manager.users.has(userId) ? manager.users.get(userId).saveFailures() : [] }));
    router.add('POST', 'ext/settings', async ({ userId, body }) => {
        const um = manager.forUser(userId);
        await um.ready();
        const next = await um.saveLvSettings(body);
        await um.flush();
        return { settings: next };
    });
    router.add('POST', 'ext/hide-blocks', async ({ userId, body }) => {
        const um = manager.forUser(userId);
        await um.ready();
        const tags = await um.saveHideBlocks(body?.chatId, body);
        await um.flush();
        return { tags };
    });
    // The translator's glossary of a chat (the screen asks when it opens a room). Always answers: absent or incompatible = nothing applied.
    router.add('POST', 'ext/translator/sync', async ({ userId, body }) => {
        const chatId = typeof body?.chatId === 'string' ? body.chatId : '';
        if (!chatId) return { applied: false };
        const um = manager.forUser(userId);
        await um.ready();
        try { return await um.syncTranslatorGlossary(chatId); } catch (e) { log(`translator glossary: ${e?.message || e}`); return { applied: false }; }
    });
    router.add('GET', 'ext/settings', async ({ userId }) => {
        const um = manager.forUser(userId);
        await um.ready();
        const s = um.lvSettings();
        return { ...s, windowInfo: await um.windowInfo() };
    });
    disposers.push(router.attach(api));

    const injector = createInjector({ manager, log });
    let offInterceptor = null, offEnded = null, offForked = null, macroOn = false, offPerm = null, offCommands = null, offChat = null;

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
                    handler: ctx => {
                        const id = ctx?.chatId || ctx?.env?.chat?.id;
                        if (!id) return '';
                        // Older hosts omit userId here. The user-scoped interceptor replaces this marker.
                        if (!ctx?.userId) return `${MEMORY_MARKER}]\n[End of memory.]`;
                        return manager.users.get(ctx.userId)?.cachedRendered(id) || '';
                    },
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
                    const um = manager.forUser(userId);
                    const t = setTimeout(async () => {
                        timers.delete(t);
                        try {
                            await um.ready();
                            if (um.settings().moduleMemory === false || !um.chatEnabled(payload.chatId)) return;
                            await um.refreshTail(payload.chatId);     // only the last messages are read again
                            await um.processChat(payload.chatId, { reason: 'reply' });
                        } catch (e) { log(`reply hook: ${e?.message || e}`); }
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
                const um = manager.forUser(userId);
                await um.ready();
                if (um.settings().moduleMemory === false) return;
                await um.inherit(payload.sourceChatId, payload.forkedChatId);
            } catch (e) { log(`CHAT_FORKED: ${e?.message || e}`); }
        });
    } catch (e) { log(`CHAT_FORKED: ${e?.message || e}`); }
    // The translator wrote a new glossary into the chat's metadata: pass it on for rooms that keep memory (no polling; the screen asks too).
    try {
        offChat = api.on('CHAT_CHANGED', (payload, userId) => {
            try {
                const id = payload?.chat?.id;
                if (!userId || typeof id !== 'string' || !Array.isArray(payload.changedFields) || !payload.changedFields.includes('metadata.st_translator')) return;
                const um = manager.users.get(userId);
                if (!um || um.settings().moduleMemory === false || !um.chatEnabled(id)) return;
                um.ready().then(() => um.syncTranslatorGlossary(id)).catch(() => {});
            } catch (e) { log(`CHAT_CHANGED: ${e?.message || e}`); }
        });
    } catch (e) { log(`CHAT_CHANGED: ${e?.message || e}`); }
    // The message snapshot follows the host's message events (no re-read of the chat): payloads carry the changed message.
    const offMessages = [];
    for (const type of ['MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'SWIPE_EDITED']) {
        try { offMessages.push(api.on(type, (payload, userId) => { try { if (userId && manager.users.has(userId)) manager.users.get(userId).onMessage(type, payload); } catch (e) { log(`${type}: ${e?.message || e}`); } })); } catch (e) { log(`${type}: ${e?.message || e}`); }
    }
    wire();
    try { offPerm = api.permissions?.onChanged?.(detail => { if (detail?.permission === 'embeddings') for (const um of manager.users.values()) um.resetEmbeddings?.(); wire(); }); } catch { /* optional */ }

    // Ctrl+K: the host passes the invoking user to the worker message but not to the handler (worker-runtime.ts:5195-5200),
    // so the backend only broadcasts "command X in chat Y" and each frontend acts if it is looking at that chat.
    try {
        api.commands.register(COMMANDS);
        offCommands = api.commands.onInvoked((id, context) => {
            try { api.sendToFrontend({ event: 'command', id, chatId: context?.chatId || null }); } catch (e) { log(`command ${id}: ${e?.message || e}`); }
        });
    } catch (e) { log(`commands: ${e?.message || e}`); }

    return async () => {
        for (const d of [offInterceptor, offEnded, offForked, offChat, offPerm, offCommands, ...offMessages, ...disposers]) { try { d?.(); } catch { /* ignore */ } }
        try { api.unregisterMacro?.(MACRO_NAME); } catch { /* ignore */ }
        try { await manager.dispose(); } catch { /* ignore */ }
    };
}

if (typeof spindle !== 'undefined') start(spindle);
