// Synchronous `fs` stand-in for the pinned upstream service.cjs (which reads and writes its data folder with node:fs, sync).
// Lumiverse extensions only have async userStorage, so every user gets an in-memory file tree that mirrors
// `memory/…` in that user's storage:
//   reads   are synchronous and answered from memory; a stored file that is not loaded yet raises code LV_NOT_LOADED
//           (never ENOENT: "missing" and "not loaded yet" must not be confused) and is recorded in `misses`;
//           entry points call preload() first, and run() loads whatever a handler missed and runs it again;
//   writes  go to memory at once; a debounced, per-file serialized async write follows. A failed write is kept (not
//           hidden) and reported by flush(). Temp names (`*.tmp`, `*.tmp-<pid>`) never reach storage, so the
//           upstream "write temp, rename" pattern ends as one write of the final file.
// Host facts: userStorage.list(prefix) returns entries RELATIVE to the prefix directory, recursive, files only
// (src/spindle/worker-host-storage-api.ts:137-149); write creates parent folders; the write is not atomic.
import { Buffer } from 'node:buffer';

export const ROOT = '/lv/memory-module';
const KEY_ROOT = 'memory';
export const NOT_LOADED = 'LV_NOT_LOADED';
const norm = p => String(p).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
const errno = (code, msg, path) => Object.assign(new Error(`${code}: ${msg}, '${path}'`), { code, path, errno: code === 'ENOENT' ? -2 : -1, syscall: 'fs' });
const ephemeral = p => /\.tmp$/.test(p) || /\.tmp-[^/]*(\/|$)/.test(p);

export function createVfs({ storage, userId, debounceMs = 400, log = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    const files = new Map();      // path -> {text, ver} | {error, ver}
    const known = new Set();      // paths that exist in storage but are not loaded
    const dirs = new Set([ROOT]);
    const stored = new Set();     // paths believed to exist in storage (known + written)
    const dirty = new Set();
    const failures = new Map();
    const tails = new Map();
    const misses = new Set();
    let ver = 0, writes = 0, timer = null, ready = null, loading = new Map();

    const keyOf = p => {
        const n = norm(p);
        if (!n.startsWith(ROOT + '/')) throw errno('EACCES', 'outside the data folder', p);
        return `${KEY_ROOT}/${n.slice(ROOT.length + 1)}`;
    };
    const pathOf = key => `${ROOT}/${key.slice(KEY_ROOT.length + 1)}`;
    const isDirPath = p => { const n = norm(p); if (dirs.has(n)) return true; const pre = n + '/'; for (const f of files.keys()) if (f.startsWith(pre)) return true; for (const f of known) if (f.startsWith(pre)) return true; return false; };
    const parentsOf = p => { let d = norm(p); const out = []; while ((d = d.slice(0, d.lastIndexOf('/'))) && d.length >= ROOT.length) out.push(d); return out; };
    const touch = p => { for (const d of parentsOf(p)) dirs.add(d); };

    // ---- the fs surface ----
    function existsSync(p) { const n = norm(p); return files.has(n) || known.has(n) || isDirPath(n); }
    function readFileSync(p, enc) {
        const n = norm(p);
        const f = files.get(n);
        if (f) {
            if (f.error) throw Object.assign(new Error(`EIO: ${f.error}, read '${n}'`), { code: 'EIO', path: n });
            return enc ? f.text : Buffer.from(f.text, 'utf8');
        }
        if (known.has(n)) { misses.add(n); throw Object.assign(new Error(`${NOT_LOADED}: ${n} is stored but not loaded yet`), { code: NOT_LOADED, path: n }); }
        if (isDirPath(n)) throw errno('EISDIR', 'illegal operation on a directory, read', n);
        throw errno('ENOENT', 'no such file or directory, open', n);
    }
    function mark(n) { dirty.add(n); writes++; schedule(); }
    function writeFileSync(p, data) {
        const n = norm(p);
        keyOf(n);
        if (isDirPath(n) && !files.has(n)) throw errno('EISDIR', 'illegal operation on a directory, open', n);
        files.set(n, { text: typeof data === 'string' ? data : Buffer.from(data).toString('utf8'), ver: ++ver });
        known.delete(n); touch(n);
        mark(n);
    }
    function copyFileSync(src, dst) {
        const s = norm(src);
        const f = files.get(s);
        if (!f) { if (known.has(s)) { misses.add(s); throw Object.assign(new Error(`${NOT_LOADED}: ${s}`), { code: NOT_LOADED, path: s }); } throw errno('ENOENT', 'no such file or directory, copyfile', s); }
        if (f.error) throw Object.assign(new Error(`EIO: ${f.error}, copyfile '${s}'`), { code: 'EIO', path: s });
        writeFileSync(dst, f.text);
    }
    function treeUnder(n) { const pre = n + '/'; return [...files.keys(), ...known].filter(f => f.startsWith(pre)); }
    function renameSync(a, b) {
        const from = norm(a), to = norm(b);
        keyOf(to);
        if (files.has(from) || known.has(from)) {
            if (known.has(from)) { misses.add(from); throw Object.assign(new Error(`${NOT_LOADED}: ${from}`), { code: NOT_LOADED, path: from }); }
            files.set(to, { ...files.get(from), ver: ++ver }); files.delete(from); known.delete(to); touch(to);
            mark(from); mark(to);
            return;
        }
        if (!isDirPath(from)) throw errno('ENOENT', 'no such file or directory, rename', from);
        const moving = treeUnder(from);
        for (const f of moving) if (known.has(f)) { misses.add(f); throw Object.assign(new Error(`${NOT_LOADED}: ${f}`), { code: NOT_LOADED, path: f }); }
        // a directory replaced by a directory: the old target tree goes first (POSIX rename of an empty dir; upstream removes it before)
        for (const old of treeUnder(to)) { files.delete(old); known.delete(old); mark(old); }
        for (const f of moving) { const dest = to + f.slice(from.length); files.set(dest, { ...files.get(f), ver: ++ver }); files.delete(f); touch(dest); mark(f); mark(dest); }
        dirs.delete(from); dirs.add(to); touch(to);
    }
    function rmSync(p, o = {}) {
        const n = norm(p);
        if (files.has(n) || known.has(n)) { files.delete(n); known.delete(n); mark(n); return; }
        if (isDirPath(n)) {
            if (!o.recursive) throw errno('ERR_FS_EISDIR', 'Path is a directory', n);
            for (const f of treeUnder(n)) { files.delete(f); known.delete(f); mark(f); }
            for (const d of [...dirs]) if (d === n || d.startsWith(n + '/')) dirs.delete(d);
            return;
        }
        if (!o.force) throw errno('ENOENT', 'no such file or directory, rm', n);
    }
    function mkdirSync(p) { const n = norm(p); keyOf(n + '/x'); dirs.add(n); touch(n); }
    function readdirSync(p) {
        const n = norm(p);
        if (!isDirPath(n)) throw errno('ENOENT', 'no such file or directory, scandir', n);
        const pre = n + '/', out = new Set();
        for (const f of [...files.keys(), ...known, ...dirs]) if (f.startsWith(pre)) out.add(f.slice(pre.length).split('/')[0]);
        return [...out].filter(Boolean).sort();
    }
    function statSync(p, o = {}) {
        const n = norm(p);
        const f = files.get(n);
        const isFile = !!f || known.has(n);
        if (!isFile && !isDirPath(n)) throw errno('ENOENT', 'no such file or directory, stat', n);
        const v = f ? f.ver : 0;
        const size = f && f.text != null ? Buffer.byteLength(f.text) : 0;
        const base = { isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false, size, mtimeMs: v };
        return o.bigint ? { ...base, size: BigInt(size), mtimeNs: BigInt(v), mtimeMs: BigInt(v) } : { ...base, mtime: new Date(v) };
    }
    const fs = { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, mkdirSync, readdirSync, statSync, lstatSync: statSync };

    // ---- persistence ----
    function schedule() { if (!timer) timer = setTimer(() => { timer = null; void settle(); }, debounceMs); }
    const serial = (k, fn) => { const job = (tails.get(k) || Promise.resolve()).catch(() => {}).then(fn); tails.set(k, job); job.finally(() => { if (tails.get(k) === job) tails.delete(k); }).catch(() => {}); return job; };
    async function persist(n) {
        if (ephemeral(n)) return;
        const f = files.get(n);
        const snapshot = f && !f.error ? f.text : null;
        const v = f ? f.ver : 0;
        await serial(n, async () => {
            try {
                if (snapshot !== null) { await storage.write(keyOf(n), snapshot, userId); stored.add(n); }
                else if (stored.has(n)) { await storage.delete(keyOf(n), userId); stored.delete(n); }
                if ((files.get(n)?.ver || 0) === v) failures.delete(n);
            } catch (error) { failures.set(n, error); dirty.add(n); log(`저장 실패 ${n}: ${error?.message || error}`); }
        });
    }
    async function settle() {
        if (timer) { clearTimer(timer); timer = null; }
        const batch = [...dirty]; dirty.clear();
        await Promise.all(batch.map(persist));
    }
    /** Writes everything waiting. Resolves with the files that still could not be saved (never hides them). */
    async function flush() {
        for (let i = 0; i < 4 && (dirty.size || tails.size); i++) { await settle(); await Promise.all([...tails.values()].map(t => t.catch(() => {}))); }
        return { failed: [...failures.keys()].map(p => p.slice(ROOT.length + 1)), errors: [...failures.values()].map(e => String(e?.message || e)) };
    }

    // ---- loading ----
    async function loadOne(n) {
        if (files.has(n) || !known.has(n)) return;
        if (!loading.has(n)) loading.set(n, (async () => {
            try {
                const text = await storage.read(keyOf(n), userId);
                if (!files.has(n)) files.set(n, { text: typeof text === 'string' ? text : String(text), ver: ++ver });
            } catch (error) {
                if (!files.has(n)) files.set(n, { error: String(error?.message || error), ver: ++ver });
            } finally { known.delete(n); loading.delete(n); }
        })());
        await loading.get(n);
    }
    /** The listing of this user's memory folder (names only). Call once; later calls share it. */
    function init() {
        ready ??= (async () => {
            let list = [];
            try { list = await storage.list(KEY_ROOT, userId); } catch (error) { if (!/not found/i.test(String(error?.message))) throw error; }
            for (const rel of list || []) {
                const n = `${ROOT}/${String(rel).replace(/^\/+/, '')}`;
                if (!files.has(n)) { known.add(n); stored.add(n); touch(n); }
            }
            await loadOne(`${ROOT}/settings.json`);
        })().catch(error => { ready = null; throw error; });
        return ready;
    }
    /** Loads the stored files whose path (below the data folder) starts with one of the prefixes, e.g. `chats/<id>.`. */
    async function preload(...prefixes) {
        await init();
        const want = [...known].filter(n => prefixes.some(p => n.startsWith(`${ROOT}/${p}`)));
        await Promise.all(want.map(loadOne));
    }
    async function loadMisses() { const m = [...misses]; misses.clear(); await Promise.all(m.map(loadOne)); return m.length; }
    /**
     * Runs fn (which may read synchronously); a file it needed but had not loaded is loaded and fn runs again, up to 4 times.
     * A run that already changed files is not repeated (the misses are loaded and reported instead).
     */
    async function run(fn) {
        await init();
        for (let attempt = 0; ; attempt++) {
            misses.clear();
            const w = writes;
            let value, error;
            try { value = await fn(); } catch (e) { error = e; }
            if (!misses.size) { if (error) throw error; return value; }
            const loaded = await loadMisses();
            if (writes !== w || attempt >= 3) { log(`읽다 만 파일 ${loaded}개를 불러왔지만 이미 저장이 있어 다시 실행하지 않았습니다.`); if (error) throw error; return value; }
        }
    }
    return { fs, init, preload, run, flush, loadMisses, failures: () => new Map(failures), misses, stats: () => ({ files: files.size, known: known.size, dirty: dirty.size, writes }), pathOf, keyOf, ROOT };
}
