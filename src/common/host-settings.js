// SpindleAPI has no backend settings getter. Read the authenticated user's fixed REST
// setting through our frontend, using the free sendToFrontend/onFrontendMessage channel.
// Never persist a snapshot: each job/reply gets a fresh read; only concurrent reads coalesce.
export function createSummarizationReader(api, { timeoutMs = 1000 } = {}) {
    const pending = new Map();
    let sequence = 0;
    const prefix = `${Date.now()}-${Math.random()}`;
    const off = api.onFrontendMessage?.((msg, userId) => {
        if (msg?.type !== 'memory-summarization-result') return;
        const entry = pending.get(userId);
        if (!entry || entry.id !== msg.id) return;
        entry.finish(msg.ok ? msg.value : null);
    });
    return {
        read(userId) {
            if (pending.has(userId)) return pending.get(userId).promise;
            if (!off || !api.sendToFrontend) return Promise.resolve(null);
            const id = `${prefix}-${++sequence}`;
            let resolve;
            const promise = new Promise(r => { resolve = r; });
            const finish = value => { clearTimeout(timer); pending.delete(userId); resolve(value); };
            const timer = setTimeout(() => finish(null), timeoutMs);
            pending.set(userId, { id, promise, finish });
            try { api.sendToFrontend({ event: 'memory-read-summarization', id }, userId); }
            catch { finish(null); }
            return promise;
        },
        dispose() {
            off?.();
            for (const entry of pending.values()) entry.finish(null);
        },
    };
}

// Fixed same-origin read only. No tokens, arbitrary URLs, or other settings cross the bridge.
export function attachSummarizationFrontend(ctx, { fetch: fetchSetting = globalThis.fetch, timeoutMs = 750 } = {}) {
    const controllers = new Set();
    let alive = true;
    const off = ctx.onBackendMessage(async msg => {
        if (msg?.event !== 'memory-read-summarization' || typeof msg.id !== 'string') return;
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let value = null;
        try {
            const response = await fetchSetting('/api/v1/settings/summarization', {
                method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
            });
            if (response.ok) {
                const setting = (await response.json())?.value;
                if (setting && typeof setting === 'object') value = {
                    messageLimitEnabled: setting.messageLimitEnabled,
                    messageLimitCount: setting.messageLimitCount,
                };
            }
        } catch { /* denial, unavailable host, or timeout: backend selects the fallback */ }
        finally { clearTimeout(timer); controllers.delete(controller); }
        if (alive) {
            try { ctx.sendToBackend({ type: 'memory-summarization-result', id: msg.id, ok: value !== null, value }); }
            catch { /* backend disconnected */ }
        }
    });
    return () => { alive = false; off?.(); for (const c of controllers) c.abort(); controllers.clear(); };
}
