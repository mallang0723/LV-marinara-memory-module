// Per-user instances of the pinned upstream service, the router entry for its routes, and the host hooks the
// extension needs around a reply (before: the interceptor, after: GENERATION_ENDED, branch: CHAT_FORKED, message events keep
// the message snapshot current). This file is the only place that knows both sides.
import { createRouter, normalizePath } from '../common/router.js';
import { createUserService } from './upstream.js';
import { running } from './dispatch.js';
import { createHostAdapter } from '../common/host-adapter.js';

export const MEMORY_MARKER = '[Memory: what the characters remember from earlier in this story';
export const RECALL_BUDGET_MS = 6000;
const LV_KEYS = ['moduleMemory', 'autoInject', 'interceptorBudgetMs', 'window'];   // Lumiverse-only settings kept in the same settings.json

export function sanitize(text, max = 60000) {
    let out = String(text).replace(/\{\{/g, '{​{').replace(/\}\}/g, '}​}');
    if (out.length > max) { const cut = out.lastIndexOf('\n', max); out = out.slice(0, cut > 0 ? cut : max); }
    return out.trim();
}

const replyShim = () => ({ code: 200, payload: undefined, status(n) { this.code = n; return this; }, send(x) { this.payload = x; return x; }, header() { return this; }, get statusCode() { return this.code; } });

export function createManager({ api, log = () => {}, tunables = {}, version = '0', host = createHostAdapter(api, { log }), afterReplyMs = 1500, debounceMs } = {}) {
    const users = new Map();
    const timers = new Set();

    function build(userId) {
        const env = { ...(tunables.env || {}) };
        env.MEMORY_MODULE_RECALL_TIMEOUT_MS ??= String(tunables.recallBudgetMs ?? RECALL_BUDGET_MS);
        const u = createUserService({ api, userId, log, env, version, debounceMs, getMessageLimit: () => host.contextMessageLimit(userId) });
        const router = createRouter();
        for (const r of u.routes) {
            const pattern = r.path.replace(/^\/api\//, '');
            router.add(r.method, pattern, async ctx => invoke(r, ctx));
        }
        const rendered = new Map();
        const settings = () => u.X.settings();
        const chatEnabled = chatId => settings().chats?.[chatId]?.enabled === true;
        const preloadRoom = (chatId, ...more) => u.vfs.preload(...[chatId, ...more].filter(Boolean).map(id => `chats/${id}.`));
        async function invoke(route, ctx) {
            const chatId = ctx.params?.id;
            if (chatId) await preloadRoom(chatId);
            const req = { params: ctx.params || {}, body: ctx.body || {}, query: ctx.query || {}, method: route.method, raw: { url: '/api/' + ctx.path }, mmTiming: {} };
            const reply = replyShim();
            const out = await u.run(() => route.handler(req, reply));
            if (reply.code >= 400) throw Object.assign(new Error(String(out?.error || reply.payload?.error || '요청을 처리하지 못했습니다.')), { status: reply.code });
            return out;
        }
        const inst = {
            userId, u, router, X: u.X, svc: u.svc,
            ready: () => u.vfs.init(),
            settings, chatEnabled, preloadRoom,
            handle: frame => router.handle(frame, userId),
            /** Settings of the extension itself (Lumiverse-only keys) next to the upstream ones, in the same file. */
            lvSettings: () => { const s = settings(); return { moduleMemory: s.moduleMemory !== false, autoInject: s.autoInject !== false, interceptorBudgetMs: s.interceptorBudgetMs || RECALL_BUDGET_MS, window: s.window || 30 }; },
            saveLvSettings(body) { return u.run(() => { const next = { ...settings() }; for (const k of LV_KEYS) if (k in (body || {})) next[k] = body[k]; u.X.saveSettings(next); return Object.fromEntries(LV_KEYS.filter(k => next[k] !== undefined).map(k => [k, next[k]])); }); },
            /** The memory text for the next reply (called by the interceptor after the sync). */
            async syncBeforeReply(chatId, body) {
                await preloadRoom(chatId);
                await u.run(() => u.X.syncBeforeReply(chatId, body || {}));
                return inst.rendered(chatId);
            },
            async rendered(chatId) {
                await preloadRoom(chatId);
                const text = await u.run(() => u.svc.renderLedger(chatId));
                rendered.set(chatId, text || '');
                return text || '';
            },
            /** Sync, from files already in memory (the macro must answer at once). A room not loaded yet gives the last known text. */
            cachedRendered: chatId => { try { const t = running.run(u.owner, () => u.svc.renderLedger(chatId)); if (typeof t === 'string') { rendered.set(chatId, t); return t; } } catch { /* not loaded: last known */ } return rendered.get(chatId); },
            async processChat(chatId, opts) { await preloadRoom(chatId); const r = await u.run(() => u.svc.processChat(chatId, opts)); await inst.rendered(chatId).catch(() => {}); return r; },
            async inherit(source, target) { await preloadRoom(target, source); return u.run(() => u.X.inheritBranch(source, target)); },
            flush: () => u.vfs.flush(),
            refreshTail: chatId => u.eng.refreshTail(chatId),
            resetEmbeddings: () => { u.eng.resetEmbeddings(); u.run(() => u.X.clearConnectionsCache?.()); },
            async windowInfo() {
                const limit = await host.contextMessageLimit(userId).catch(() => null);
                const s = inst.lvSettings();
                return limit ? { source: 'lumiverse', limit, label: `루미버스 메시지 제한 ${limit}개를 따릅니다.` } : { source: 'extension', limit: s.window, label: `기억 서재 창 크기 ${s.window}개를 씁니다(루미버스 메시지 제한이 꺼져 있음).` };
            },
            onMessage: (type, payload) => u.eng.onMessage(type, payload),
        };
        return inst;
    }
    function forUser(userId) {
        if (typeof userId !== 'string' || !userId) throw Object.assign(new Error('userId required'), { status: 401 });
        let inst = users.get(userId);
        if (!inst) { inst = build(userId); users.set(userId, inst); }
        return inst;
    }
    /** Everything under memory-module/ goes to the user's own instance. */
    function mount(router) {
        router.fallback('memory-module/', ({ userId, method, path, query, body }) => forUser(userId).ready().then(() => forUser(userId).handle({ method, path: Object.keys(query || {}).length ? `${path}?${new URLSearchParams(query)}` : path, body: body ?? {} })));
        return router;
    }
    async function dispose() {
        for (const t of timers) clearTimeout(t);
        for (const inst of users.values()) { try { await inst.flush(); } catch { /* reported by flush callers */ } inst.u.dispose(); }
        host.dispose?.();
    }
    return { forUser, users, mount, host, dispose, timers, afterReplyMs, MEMORY_MARKER, normalizePath, running };
}
