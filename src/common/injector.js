// The interceptor. A Spindle extension owns ONE interceptor (a second registerInterceptor() releases the first,
// src/spindle/worker-host.ts:3052 `this.interceptorUnregister?.()`); this one handler keeps the order, the de-duplication and
// the time budget of the memory block in one place.
//
// Host facts (Lumiverse HEAD 11a66b75):
//  - interceptor time limit: user setting, default 10 s (src/services/spindle-settings.service.ts:6), the manifest's
//    interceptorTimeoutMs is only a hint (worker-host.ts:3048); on timeout (required:false) generation goes on with the previous
//    prompt (src/spindle/interceptor-pipeline.ts:125-160)
//  - chat turns arrive flagged __isChatHistory with sourceMessageId (worker-host.ts:3076-3083, types/api.d.ts:74-82)
//  - generate.quiet/raw do not run interceptors (so asking the memory model from here cannot recurse; AGENTS 2)
//  - the macro {{memory_ledger}} is resolved BEFORE the interceptors run (prompt assembly), so a block it produced is already
//    in `messages`; this handler replaces such a block with the fresh one instead of adding a second (marker below).
//    (the same replacement also swaps a block that another extension's {{memory_ledger}} put there: see README on running only one)
//  - ctx.generationType: normal | continue | regenerate | swipe | impersonate | quiet (types/api.d.ts); ctx.excludeMessageId is
//    the message being replaced on regenerate/swipe; ctx.signal is aborted when the host gives up.
//  - types declare ctx.interceptorDeadlineAt (types/api.d.ts) but the staging host source never sets it (grep finds only the
//    type) -> used when present, otherwise the budget below applies.
import { MEMORY_MARKER, sanitize } from '../memory/service.js';

const MEMORY_BLOCK = /\[Memory: what the characters remember from earlier in this story[\s\S]*?\[End of memory\.[^\]]*\]/;
const ACTIVE_TYPES = new Set(['normal', 'continue', 'regenerate', 'swipe']);
const REPLAY_TYPES = new Set(['regenerate', 'swipe']);

export function createInjector({ service, log = () => {}, now = () => Date.now() }) {
    const T = service.T;
    const text = m => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map(p => p?.text || '').join('') : '');

    /** Total wall-clock budget the handler allows itself (ms). settings().interceptorBudgetMs > tunables > 6000. */
    function budgetOf(um, ctx) {
        const set = Number(um.settings().interceptorBudgetMs);
        let b = Number.isFinite(set) && set > 0 ? set : Number(T.INTERCEPTOR_BUDGET_MS) > 0 ? Number(T.INTERCEPTOR_BUDGET_MS) : 6000;
        const deadline = Number(ctx?.interceptorDeadlineAt);
        if (Number.isFinite(deadline) && deadline > 0) b = Math.min(b, Math.max(500, deadline - now() - 1500));
        return b;
    }

    async function handler(messages, ctx) {
        const started = now();
        const untouched = () => messages;
        try {
            const userId = ctx?.userId, chatId = ctx?.chatId, type = ctx?.generationType;
            if (typeof userId !== 'string' || !userId || typeof chatId !== 'string' || !chatId) return untouched();
            if (!ACTIVE_TYPES.has(type)) return untouched();     // quiet / impersonate are left alone
            const um = service.forUser(userId);
            await um.ready();
            const budget = budgetOf(um, ctx);
            const out = messages.map(m => ({ ...m }));
            const breakdown = [];
            let memoryText = '';
            let memoryOn = false;

            // ---- 1) memory block ----
            const injectOn = um.settings().autoInject !== false && um.settings().moduleMemory !== false;
            try {
                await um.ensureChat(chatId);
                memoryOn = um.chatEnabled(chatId) && um.settings().moduleMemory !== false;
                if (memoryOn) {
                    if (ctx.isDryRun) memoryText = um.cachedRendered(chatId) ?? await um.rendered(chatId);            // preview: no model call, nothing written
                    else {
                        const sync = um.syncBeforeReply(chatId, { regenerateMessageId: REPLAY_TYPES.has(type) ? ctx.excludeMessageId : undefined, budgetMs: Math.max(500, budget - (now() - started) - 300), signal: ctx.signal });
                        memoryText = await raceBudget(sync, budget - (now() - started), ctx.signal);
                    }
                }
            } catch (error) {
                log(`memory block skipped: ${error?.message || error}`);
                memoryText = memoryOn ? um.cachedRendered(chatId) || '' : '';   // the last known text beats none
            }
            if (memoryOn || out.some(m => MEMORY_BLOCK.test(text(m)))) {
                const existing = out.findIndex(m => MEMORY_BLOCK.test(text(m)));
                if (existing >= 0) {
                    // {{memory_ledger}} in the preset was already resolved with last turn's cache: swap in the fresh text
                    const fresh = memoryText ? sanitize(memoryText) : '';
                    out[existing] = { ...out[existing], content: text(out[existing]).replace(MEMORY_BLOCK, () => fresh).replace(/\n{3,}/g, '\n\n') };
                    breakdown.push({ messageIndex: existing, name: '기억' });
                } else if (injectOn && memoryText) {
                    const at = historyStart(out);
                    out.splice(at, 0, { role: 'system', content: memoryText });
                    breakdown.push({ messageIndex: at, name: '기억' });
                }
            }

            if (!breakdown.length && out.length === messages.length && out.every((m, i) => m.content === messages[i].content)) return untouched();
            log(`interceptor ${type} ${chatId}: ${now() - started} ms (${breakdown.map(b => b.name).join(', ') || 'no change'})`);
            return { messages: out, breakdown: breakdown.sort((a, b) => a.messageIndex - b.messageIndex) };
        } catch (error) {
            log(`interceptor failed, prompt left as it was: ${error?.message || error}`);
            return untouched();      // never throw: with required:false the host would continue anyway, but a thrown error is noise
        }
    }

    /** Index of the first chat-history turn (the block goes right before it); else before the last message; else the end. */
    function historyStart(list) {
        const i = list.findIndex(m => m.__isChatHistory === true);
        if (i >= 0) return i;
        return Math.max(0, list.length - 1);
    }
    /** The sync may not take longer than what is left of the budget; then the last known text is used. */
    async function raceBudget(promise, ms, signal) {
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('시간 예산을 넘었습니다'), { name: 'TimeoutError' })), Math.max(1, ms) + 400); });
        try { return await Promise.race([promise, limit]); } finally { clearTimeout(timer); }
    }

    return { handler, budgetOf, MEMORY_MARKER };
}
