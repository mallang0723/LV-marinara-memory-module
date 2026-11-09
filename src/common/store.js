// userStorage wrapper. Every call needs a userId (operator-scoped install: worker-host-storage-api.ts:250-256 rejects a call
// without it), keeps broken files from being overwritten (the upstream service.cjs readJson / markBroken / supported idea),
// and debounces writes per key.
//
// Host facts this relies on (Lumiverse ~/Lumiverse, HEAD 11a66b75):
//  - userStorage.read(path, userId) throws "File not found" for a missing file (worker-host-storage-api.ts:264-270);
//  - userStorage.getJson(path, {fallback}) swallows EVERY error (missing file AND broken JSON) and returns the fallback
//    (worker-runtime.ts:2148-2160) -> it cannot tell "no file" from "corrupt file", so this wrapper uses exists()+read()+JSON.parse;
//  - setJson indents with 2 spaces by default (worker-runtime.ts:2162-2174) -> this wrapper writes compact JSON with write();
//  - nested paths ("memory/chats/<id>.json") are created on write (worker-host-storage-api.ts:272-279), path traversal is refused (:128-135);
//  - the write is a plain writeFileSync, not temp+rename (:272-279): a crash in the middle can truncate a file, hence the
//    "broken -> copy aside, never overwrite" protection below.

export const BROKEN_SUFFIX = '.broken-';

export function permissionError(message) {
    return Object.assign(new Error(message), { code: 'permission' });
}

/** Turns a host "PERMISSION_DENIED: x" error into an error with code 'permission' and a Korean hint. */
export function wrapHostError(error) {
    const text = String(error?.message || error || '');
    const m = text.match(/PERMISSION_DENIED:\s*([a-z_]+)/i);
    if (m) return Object.assign(new Error(`권한 "${m[1]}"을(를) 허용해 주세요. (확장 설정 > 권한)`), { code: 'permission', permission: m[1] });
    return error instanceof Error ? error : new Error(text);
}

export function createStore(api, { debounceMs = 500, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), now = () => new Date() } = {}) {
    const need = userId => { if (typeof userId !== 'string' || !userId) throw new Error('userId required'); return userId; };
    const id = (userId, key) => `${userId}\u0000${key}`;
    /** key -> {backup, reason, error, replaceable} for files that exist but could not be read. */
    const broken = new Map();
    /** key -> {value, timer, waiters[]} writes waiting for their debounce. */
    const pending = new Map();
    const active = new Map();
    const failures = new Map();
    const stamp = () => now().toISOString().replace(/[:.]/g, '-');

    async function readText(userId, key) {
        need(userId);
        const p = pending.get(id(userId, key));
        if (p) return typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
        if (!(await api.userStorage.exists(key, userId))) return null;
        return api.userStorage.read(key, userId);
    }

    async function markBroken(userId, key, error, { raw = null, reason = 'broken', replaceable = false } = {}) {
        const k = id(userId, key);
        if (broken.has(k)) return broken.get(k);
        let backup = null;
        if (raw !== null) {
            backup = `${key}${BROKEN_SUFFIX}${stamp()}`;
            try { await api.userStorage.write(backup, raw, userId); } catch { backup = null; }
        }
        const info = { key, backup, reason, error: String(error?.message || error).slice(0, 200), at: now().toISOString(), replaceable };
        broken.set(k, info);
        return info;
    }

    /** Reads JSON. A file that exists but cannot be parsed is copied aside once and reported as broken (never overwritten). */
    async function getJson(userId, key, fallback = null, { replaceable = false } = {}) {
        need(userId);
        const p = pending.get(id(userId, key));
        if (p) return structuredClone(p.value);
        let raw;
        try {
            if (!(await api.userStorage.exists(key, userId))) { broken.delete(id(userId, key)); return fallback; }
            raw = await api.userStorage.read(key, userId);
        } catch (error) {
            await markBroken(userId, key, error, { replaceable });
            return fallback;
        }
        try {
            const value = JSON.parse(raw);
            broken.delete(id(userId, key));
            return value;
        } catch (error) {
            await markBroken(userId, key, error, { raw, replaceable });
            return fallback;
        }
    }

    /** A stored object in a data format this version does not know: not "empty", kept and not overwritten. */
    async function supported(userId, key, stored, version) {
        if (!stored) return null;
        if (stored.version === version) return stored;
        await markBroken(userId, key, Error(`지원하지 않는 데이터 버전(${stored.version ?? '없음'}, 이 확장은 ${version})`), { raw: JSON.stringify(stored), reason: 'version' });
        return null;
    }

    const blocked = (userId, key) => { const b = broken.get(id(userId, key)); return b && !b.replaceable ? b : null; };

    function guard(userId, key) {
        const b = blocked(userId, key);
        if (b) {
            throw Object.assign(new Error(`기억 파일(${key.split('/').pop()})을 ${b.reason === 'version' ? '이 버전의 확장이 모르는 형식이라' : '손상되어'} 읽지 못했습니다. 덮어쓰지 않도록 저장을 멈췄습니다.${b.backup ? ` 원본 복사본: ${b.backup}.` : ''} 파일을 고치거나 지운 뒤 다시 시도해 주세요.`), { code: 'broken', key });
        }
    }

    async function writeNow(userId, key, value) {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        await api.userStorage.write(key, text, userId);
        broken.delete(id(userId, key));
    }

    /** Debounced write: several writes of one key within debounceMs become one (the last). `immediate` flushes now. */
    function setJson(userId, key, value, { immediate = false } = {}) {
        need(userId);
        guard(userId, key);
        const k = id(userId, key);
        let p = pending.get(k);
        if (!p) { p = { value, timer: null, waiters: [] }; pending.set(k, p); }
        p.value = value;
        const promise = new Promise((resolve, reject) => p.waiters.push({ resolve, reject }));
        if (p.timer) { clearTimer(p.timer); p.timer = null; }
        const perform = async () => {
            pending.delete(k);
            p.timer = null;
            try { await writeNow(userId, key, p.value); failures.delete(k); for (const w of p.waiters) w.resolve(true); } catch (e) { failures.set(k, wrapHostError(e)); for (const w of p.waiters) w.reject(wrapHostError(e)); }
        };
        const run = () => { const job = perform(); active.set(job, userId); job.finally(() => active.delete(job)); return job; };
        if (immediate || debounceMs <= 0) void run(); else p.timer = setTimer(run, debounceMs);
        p._run = run;
        return promise;
    }

    /** Writes everything waiting (shutdown, end of a job). */
    async function flush(userId = null) {
        const jobs = [];
        for (const [k, p] of [...pending]) {
            if (userId && !k.startsWith(`${userId}\u0000`)) continue;
            if (p.timer) { clearTimer(p.timer); p.timer = null; }
            jobs.push(p._run());
        }
        await Promise.allSettled([...jobs, ...[...active].filter(([, owner]) => !userId || owner === userId).map(([job]) => job)]);
        for (const [key, error] of failures) if (!userId || key.startsWith(`${userId}\u0000`)) throw error;
    }

    async function remove(userId, key) {
        need(userId);
        const p = pending.get(id(userId, key));
        if (p?.timer) clearTimer(p.timer);
        pending.delete(id(userId, key));
        broken.delete(id(userId, key)); failures.delete(id(userId, key));
        for (const w of p?.waiters || []) w.resolve(false);
        try { if (await api.userStorage.exists(key, userId)) await api.userStorage.delete(key, userId); } catch { /* nothing to delete */ }
    }

    // Used only after a complete durable safety copy. Unlike remove(), errors must reach rollback.
    async function replaceRaw(userId, key, text) {
        need(userId);
        if (pending.has(id(userId, key))) throw Error('저장 중인 파일은 교체할 수 없습니다.');
        if (text == null) { if (await api.userStorage.exists(key, userId)) await api.userStorage.delete(key, userId); }
        else await api.userStorage.write(key, text, userId);
        broken.delete(id(userId, key)); failures.delete(id(userId, key));
    }
    const list = async (userId, prefix) => api.userStorage.list(prefix, need(userId));
    const writeText = (userId, key, text) => setJson(userId, key, String(text), { immediate: true });

    return {
        replaceRaw, getJson, setJson, readText, writeText, remove, list, flush, supported, markBroken, blocked, guard,
        brokenList: userId => [...broken.entries()].filter(([k]) => k.startsWith(`${userId}\u0000`)).map(([, v]) => v),
        hasPending: () => pending.size > 0,
    };
}
