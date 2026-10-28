// The frontend's link to the backend, and the `marinara` compatible host object the original screen expects.
// Everything the originals sent to Marinara's REST API ('/api/...') becomes a frame on Spindle's frontend <-> backend channel
// (ctx.sendToBackend / ctx.onBackendMessage, types/dom.d.ts:1270-1271), answered by the router in the backend worker.
// Nothing here touches the network: the originals' own fetch fallbacks are closed (see `fetch` below).

/** Unique id without relying on crypto.randomUUID (missing on a phone's plain-http origin: not a secure context). */
export function uid() {
    try { const c = globalThis.crypto; if (c && typeof c.randomUUID === 'function') return c.randomUUID(); } catch { /* insecure origin */ }
    try {
        const c = globalThis.crypto;
        if (c && typeof c.getRandomValues === 'function') {
            const b = c.getRandomValues(new Uint8Array(16));
            b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
            const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
            return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        }
    } catch { /* fall through */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A fetch Response look-alike (the originals read ok / status / json() / text() / clone()). */
export function responseLike(status, data) {
    const text = data === undefined ? '' : JSON.stringify(data);
    const res = { ok: status >= 200 && status < 300, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => JSON.parse(text || 'null'), text: async () => text, clone: () => responseLike(status, data) };
    return res;
}

const SLOW = /^\/?(?:api\/)?generate\/raw$/;

export function createLink(ctx, { timeoutMs = 60_000, slowTimeoutMs = 330_000, now = () => Date.now() } = {}) {
    const pending = new Map();
    const listeners = new Set();
    let alive = true;
    const off = ctx.onBackendMessage(msg => {
        if (!alive || !msg || typeof msg !== 'object') return;
        if (msg.event) { for (const fn of [...listeners]) { try { fn(msg); } catch { /* a listener must not break the channel */ } } return; }
        const p = pending.get(msg.requestId);
        if (!p) return;
        pending.delete(msg.requestId);
        clearTimeout(p.timer);
        p.resolve(msg);
    });
    /** Resolves with the backend's reply frame {ok, data|error, code?, status?}; rejects only when the channel itself fails. */
    function request(method, path, body, { timeout, signal } = {}) {
        if (!alive) return Promise.reject(new Error('확장이 종료됐어요'));
        const requestId = `${uid()}:${now()}`;
        return new Promise((resolve, reject) => {
            const limit = timeout ?? (SLOW.test(path) ? slowTimeoutMs : timeoutMs);
            const timer = setTimeout(() => { pending.delete(requestId); reject(Object.assign(new Error('서버 응답이 없어요. 잠시 뒤 다시 시도해 주세요.'), { timeout: true })); }, limit);
            pending.set(requestId, { resolve, reject, timer });
            if (signal) {
                const abort = () => { if (pending.delete(requestId)) { clearTimeout(timer); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); } };
                if (signal.aborted) return abort();
                signal.addEventListener('abort', abort, { once: true });
            }
            try { ctx.sendToBackend({ requestId, type: 'api', method, path, body }); } catch (e) { pending.delete(requestId); clearTimeout(timer); reject(e); }
        });
    }
    return {
        request,
        /** request() that throws on {ok:false} with the backend's message (and code) */
        async call(method, path, body, o) {
            const r = await request(method, path, body, o);
            if (!r.ok) throw Object.assign(new Error(r.error || '요청을 처리하지 못했습니다.'), { code: r.code, status: r.status });
            return r.data;
        },
        onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        dispose() { alive = false; try { off?.(); } catch { /* ignore */ } for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('확장이 종료됐어요')); } pending.clear(); listeners.clear(); },
    };
}

/** Marinara-style request -> Response look-alike; errors come back as an HTTP-like status so the originals never fall back to the network. */
export function createFetch(link) {
    return async function shimFetch(input, init = {}) {
        const method = String(init?.method || 'GET').toUpperCase();
        let body;
        if (typeof init?.body === 'string' && init.body) { try { body = JSON.parse(init.body); } catch { body = undefined; } }
        const path = typeof input === 'string' ? input : String(input?.url || input);
        try {
            const r = await link.request(method, path, body, { signal: init?.signal });
            if (r.ok) return responseLike(200, r.data ?? null);
            return responseLike(r.status && r.status >= 400 ? r.status : r.code === 'permission' ? 403 : 400, { error: r.error || '요청을 처리하지 못했습니다.', ...(r.code ? { code: r.code } : {}) });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            return responseLike(503, { error: error?.message || '서버에 연결하지 못했어요.' });
        }
    };
}

/** The `marinara` object the original screen is handed: apiFetch / log / onCleanup / setTimeout. */
export function createMarinara(link, { onCleanup } = {}) {
    const fetcher = createFetch(link);
    const cleanups = [];
    const api = {
        apiFetch: (path, init) => fetcher(path, init),
        // the original falls back to fetch('/api/...') for a GET when apiFetch throws: closed on purpose, nothing leaves the page
        fetch: () => Promise.reject(Object.assign(new Error('network disabled'), { status: 0 })),
        log: { warn: (...a) => console.warn(...a), info: (...a) => console.info(...a) },
        onCleanup: fn => { cleanups.push(fn); onCleanup?.(fn); },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: id => clearTimeout(id),
    };
    return { marinara: api, runCleanups: () => { for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } } } };
}
