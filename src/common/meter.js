// The token meter: numbers only, never message text (not in storage, not in logs).
//  - injection: the exact block the interceptor put into the prompt, counted by the host's tokenizer
//    (spindle.tokens.countText, a free-tier helper: no permission; modelSource 'main'; `approximate` when the host fell back to char/4)
//  - memory-model calls (정리 organize / 회상 recall / 점검 check) and embeddings: the usage the host returned on generate.quiet
//    (prompt_tokens / completion_tokens, cost when provider_raw carries it); no usage -> the same helper counts prompt and answer
//    and the row is marked estimated. The embeddings API returns no usage, so its tokens are always an estimate.
// Room: an AsyncLocalStorage set around the entries into a room (manager.js); a call outside any room is not recorded.
import { AsyncLocalStorage } from 'node:async_hooks';

export const inRoom = new AsyncLocalStorage();
export const KINDS = ['organize', 'recall', 'check', 'embed'];
const FILE = 'meter/totals.json';
const COUNT_MS = 3000;
const approx = text => ({ tokens: Math.ceil(String(text || '').length / 4), tokenizer: 'approximate', approximate: true });
const num = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const blank = () => ({ n: 0, input: 0, output: 0, cost: 0, costKnown: 0, estimated: 0 });

/** The cost a provider reported, if it did (OpenRouter style usage.cost); null otherwise. */
export function costOf(usage) {
    const raw = usage?.provider_raw;
    for (const v of [usage?.cost, raw?.cost, raw?.usage?.cost, raw?.total_cost]) { const n = num(v); if (n != null) return n; }
    return null;
}

export function createMeter({ api, userId, log = () => {}, debounceMs = 2000 }) {
    let data = null, loading = null, timer = null, dirty = false;
    const pending = new Set();
    const storage = api?.userStorage;

    async function load() {
        if (data) return data;
        loading ??= (async () => {
            let v = null;
            try { v = storage?.getJson ? await storage.getJson(FILE, { userId, fallback: null }) : null; } catch { v = null; }
            data = v && typeof v === 'object' && v.rooms && typeof v.rooms === 'object' ? v : { rooms: {} };
        })();
        await loading;
        return data;
    }
    const room = (d, chatId) => (d.rooms[chatId] ??= { since: Date.now(), last: null, calls: {} });
    function save() {
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(() => { flush().catch(e => log(`meter save: ${e?.message || e}`)); }, debounceMs);
        timer.unref?.();
    }
    async function flush() {
        clearTimeout(timer);
        await Promise.allSettled([...pending]);
        if (!dirty || !data || !storage?.setJson) return;
        dirty = false;
        await storage.setJson(FILE, data, { userId, indent: 0 });
    }

    /** Host token count of one text; the approximation (flagged) when the helper is missing, fails or is slow. */
    async function count(text) {
        const s = String(text ?? '');
        if (!s) return { tokens: 0, tokenizer: '', approximate: false };
        if (typeof api?.tokens?.countText !== 'function') return approx(s);
        let timer;
        try {
            const r = await Promise.race([api.tokens.countText(s, { modelSource: 'main', userId }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), COUNT_MS); })]);
            const t = num(r?.total_tokens);
            if (t == null) return approx(s);
            return { tokens: t, tokenizer: String(r.tokenizer_name || r.model || ''), approximate: r.approximate === true };
        } catch { return approx(s); } finally { clearTimeout(timer); }
    }
    const track = p => { pending.add(p); p.finally(() => pending.delete(p)); return p; };

    /** The exact injected text of this room's last reply. Resolves when stored; never rejects. */
    function recordInjection(chatId, text, { dryRun = false } = {}) {
        if (!chatId) return Promise.resolve();
        return track((async () => {
            try {
                const c = await count(text);
                const d = await load();
                room(d, chatId).last = { chars: String(text).length, tokens: c.tokens, tokenizer: c.tokenizer, approximate: c.approximate, dryRun: !!dryRun, at: Date.now() };
                save();
            } catch (e) { log(`meter injection: ${e?.message || e}`); }
        })());
    }

    /**
     * One memory-model or embedding call. `usage` is what the host returned; `promptText` / `answerText` are used (counted, not kept)
     * only when it returned none. Resolves when stored; never rejects.
     */
    function recordCall(chatId, kind, { usage = null, promptText = '', answerText = '' } = {}) {
        if (!chatId || !KINDS.includes(kind)) return Promise.resolve();
        return track((async () => {
            try {
                let input = num(usage?.prompt_tokens ?? usage?.input_tokens), output = num(usage?.completion_tokens ?? usage?.output_tokens);
                let estimated = false;
                if (input == null || output == null) {
                    estimated = true;
                    if (input == null) input = (await count(promptText)).tokens;
                    if (output == null) output = answerText ? (await count(answerText)).tokens : 0;
                }
                const cost = costOf(usage);
                const d = await load();
                const row = (room(d, chatId).calls[kind] ??= blank());
                row.n++; row.input += input; row.output += output;
                if (cost != null) { row.cost += cost; row.costKnown++; }
                if (estimated) row.estimated++;
                save();
            } catch (e) { log(`meter call: ${e?.message || e}`); }
        })());
    }

    async function get(chatId) {
        const d = await load();
        const r = d.rooms[chatId] || { since: null, last: null, calls: {} };
        const total = blank();
        const calls = {};
        for (const k of KINDS) { const c = { ...blank(), ...(r.calls[k] || {}) }; calls[k] = c; for (const f of Object.keys(total)) total[f] += c[f]; }
        return { last: r.last, calls, total, since: r.since };
    }
    /** Clears the room's call totals (the last injection is a fact about the last reply and stays). */
    async function reset(chatId) {
        const d = await load();
        if (d.rooms[chatId]) { d.rooms[chatId].calls = {}; d.rooms[chatId].since = Date.now(); save(); }
        await flush();
        return get(chatId);
    }
    return { count, recordInjection, recordCall, get, reset, flush, idle: () => Promise.allSettled([...pending]) };
}
