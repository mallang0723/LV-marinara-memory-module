// Multi-file userStorage replacement: durable, verified safety snapshot before the first mutation.
// No filesystem/global storage access. A failed rollback leaves the snapshot available after restart.
import B from './core/backup.generated.cjs';
import { changeRoom, roomBusy } from './room-features.js';

export const BACKUP_ROUTES = [
    ['GET', 'chats/:id/backup'], ...['preview', 'apply', 'undo'].map(p => ['POST', `chats/:id/restore/${p}`]),
    ['GET', 'orphans'], ['DELETE', 'orphans/:id'], ['POST', 'orphans/delete-all'],
];
export function createRoomBackup({ um, store, host, version }) {
    const user = um.userId;
    const path = (id, key) => `memory/chats/${id}${B.FILES[key]}`;
    const previousPath = id => `memory/restore-undo/${id}/snapshot.prev.json`;
    const safetyPath = id => `memory/restore-undo/${id}/snapshot.json`;
    async function snapshot(id) {
        await um.flush();
        const texts = {};
        for (const key of B.KEYS) { const text = await store.readText(user, path(id, key)); if (text !== null) texts[key] = text; }
        const entry = um.settings().chats?.[id];
        return { version: 1, chatId: id, at: new Date().toISOString(), texts, files: Object.keys(texts), hadSettings: entry !== undefined, settings: entry ?? null };
    }
    async function read(id, tolerant = false) {
        const snap = await snapshot(id), files = {};
        for (const [key, text] of Object.entries(snap.texts)) {
            try { files[key] = JSON.parse(text); } catch { if (!tolerant) throw Error(`${key} 파일이 손상되어 백업할 수 없습니다.`); }
        }
        return files;
    }
    async function safety(id) {
        const text = await store.readText(user, safetyPath(id));
        if (text === null) return null;
        const snap = JSON.parse(text);
        if (snap.version !== 1 || snap.chatId !== id || !snap.texts || Object.entries(snap.texts).some(([k, v]) => !B.KEYS.includes(k) || typeof v !== 'string')) throw Error('안전 사본 형식이 올바르지 않습니다.');
        return snap;
    }
    async function replace(id, snap) {
        let failed;
        for (const key of B.KEYS) {
            try { await store.replaceRaw(user, path(id, key), snap.texts[key] ?? null); } catch (e) { failed ||= e; }
        }
        try {
            await um.saveRoomSettings(id, snap.hadSettings ? snap.settings : undefined);
        } catch (e) { failed ||= e; }
        um.invalidateRoom(id);
        if (failed) throw failed;
    }
    async function matchesSnapshot(id, snap) {
        try {
            for (const key of B.KEYS) if (await store.readStoredText(user, path(id, key)) !== (snap.texts[key] ?? null)) return false;
            const settings = JSON.parse(await store.readStoredText(user, um.keys.settings));
            return JSON.stringify(settings?.chats?.[id]) === JSON.stringify(snap.hadSettings ? snap.settings : undefined);
        } catch { return false; }
    }
    async function transact(id, next, before) {
        const release = um.holdRoom(id);
        try {
            try { await replace(id, next); }
            catch (error) {
                try { await replace(id, before); }
                catch { if (!await matchesSnapshot(id, before)) throw Error(`불러오기와 이전 상태 복구에 실패했습니다. 안전 사본: ${safetyPath(id)}. ${error.message}`); }
                throw Error(`불러오지 못했습니다. 이전 상태로 되돌렸습니다. ${error.message}`);
            }
        } finally { release(); }
    }
    function uploaded(body) {
        const doc = body?.backup;
        if (!doc || Buffer.byteLength(JSON.stringify(doc)) > B.MAX_BYTES) throw Error('백업 파일 내용이나 크기를 확인해 주세요.');
        return B.validate(structuredClone(doc));
    }
    async function backup(id, vectors) {
        const files = await read(id);
        if (!vectors) delete files.vectors;
        if (!Object.keys(files).length) throw Error('이 방에는 백업할 기억이 없습니다.');
        const chatName = (await host.rawChat(user, id)).name || '';
        return { fileName: B.fileName(chatName), backup: B.build({ chatId: id, chatName, moduleVersion: version, files, settingsEntry: um.settings().chats?.[id], jobRunning: roomBusy(um, id) }) };
    }
    async function preview(id, body) {
        const doc = uploaded(body), current = await read(id, true), existing = await snapshot(id);
        return { source: { ...doc.header }, sameRoom: doc.header.chatId === id, crossRoomRequired: doc.header.chatId !== id,
            backup: B.counts(doc.files), current: B.counts(current), vectors: { inBackup: 'vectors' in doc.files, willClear: !('vectors' in doc.files) && 'vectors' in current },
            removes: B.KEYS.filter(k => !(k in doc.files) && k in existing.texts), busy: roomBusy(um, id), undoAvailable: !!await safety(id) };
    }
    async function apply(id, body) {
        const doc = uploaded(body);
        if (doc.header.chatId !== id && body.crossRoom !== true) throw Error('다른 방의 백업을 이 방에 적용할지 확인해 주세요.');
        return changeRoom(um, id, async () => {
            const before = await snapshot(id);
            before.from = { chatId: doc.header.chatId, chatName: doc.header.chatName, createdAt: doc.header.createdAt };
            const text = JSON.stringify(before);
            const previous = await store.readText(user, safetyPath(id));
            if (previous !== null) {
                await store.replaceRaw(user, previousPath(id), previous);
                if (await store.readText(user, previousPath(id)) !== previous) throw Error('이전 안전 사본 검증에 실패하여 불러오지 않았습니다.');
            }
            await store.replaceRaw(user, safetyPath(id), text);
            if (await store.readText(user, safetyPath(id)) !== text) throw Error('안전 사본 검증에 실패하여 불러오지 않았습니다.');
            const entry = doc.settings ? { ...doc.settings } : before.settings;
            if (entry && doc.settings) { if (before.settings && 'enabled' in before.settings) entry.enabled = before.settings.enabled; else delete entry.enabled; }
            const next = { texts: Object.fromEntries(Object.entries(doc.files).map(([k, v]) => [k, JSON.stringify(v)])), hadSettings: entry != null, settings: entry };
            await transact(id, next, before);
            return { restored: Object.keys(doc.files), counts: B.counts(doc.files), undoAvailable: true, vectorsCleared: !('vectors' in doc.files) };
        }, { check: false });
    }
    async function undo(id) {
        return changeRoom(um, id, async () => {
            const old = await safety(id);
            if (!old) throw Error('되돌릴 불러오기가 없습니다.');
            const before = await snapshot(id);
            await transact(id, old, before);
            await store.replaceRaw(user, safetyPath(id), await store.readText(user, previousPath(id)));
            await store.replaceRaw(user, previousPath(id), null);
            return { undone: true, restoredFiles: Object.keys(old.texts) };
        }, { check: false });
    }
    // Only records physically in the requesting user's storage can become candidates. Access/list failures
    // are never interpreted as deletion. Check both the complete user chat list and the scoped get endpoint.
    async function orphans() {
        const live = new Set((await host.chatsList(user)).map(c => c.id));
        const names = (await store.list(user, 'memory/chats/')).map(x => typeof x === 'string' ? x : x.path || x.name || '');
        const grouped = new Map();
        for (const name of names) {
            const base = name.split('/').at(-1), match = /^([A-Za-z0-9_-]{1,128})(\..+)$/.exec(base);
            if (!match || !Object.values(B.FILES).some(suffix => match[2] === suffix || match[2].startsWith(suffix + '.broken-'))) continue;
            if (!grouped.has(match[1])) grouped.set(match[1], []);
            grouped.get(match[1]).push(`memory/chats/${base}`);
        }
        for (const id of Object.keys(um.settings().chats || {})) if (/^[A-Za-z0-9_-]{1,128}$/.test(id) && !grouped.has(id)) grouped.set(id, []);
        const out = [];
        for (const [id, files] of grouped) {
            if (live.has(id)) continue;
            try { await host.rawChat(user, id); continue; } catch (e) { if (e.status !== 404) throw e; }
            let bytes = 0, scenes = 0, updatedAt = null;
            for (const key of files) {
                const text = await store.readText(user, key); bytes += Buffer.byteLength(text || '');
                try { const data = JSON.parse(text); if (key.endsWith('.scenes.json')) scenes = data.scenes?.length || 0; if (data.updatedAt > (updatedAt || '')) updatedAt = data.updatedAt; } catch { /* list broken files too */ }
            }
            out.push({ id, files: files.length, bytes, scenes, updatedAt, settingsOnly: !files.length, paths: files });
        }
        return out;
    }
    async function removeOrphan(id) {
        return changeRoom(um, id, async () => {
            const entry = (await orphans()).find(o => o.id === id);
            if (!entry) throw Error('삭제된 방의 기억만 지울 수 있습니다.');
            await um.flush();
            for (const key of entry.paths) await store.replaceRaw(user, key, null);
            await store.replaceRaw(user, safetyPath(id), null);
            await store.replaceRaw(user, previousPath(id), null);
            await store.replaceRaw(user, um.keys.sceneError(id), null);
            await um.saveRoomSettings(id, undefined);
            um.invalidateRoom(id);
            return { deleted: true, id };
        }, { check: false });
    }
    return { backup, preview, apply, undo, safety, orphans, removeOrphan };
}
export function registerBackupRoutes(add, chatOf) {
    add('GET', 'chats/:id/backup', ctx => ctx.um.backup.backup(chatOf(ctx), ['1', 'true'].includes(ctx.query.vectors)));
    for (const op of ['preview', 'apply', 'undo']) add('POST', `chats/:id/restore/${op}`, ctx => ctx.um.backup[op](chatOf(ctx), ctx.body));
    add('GET', 'orphans', async ctx => ({ orphans: (await ctx.um.backup.orphans()).map(({ paths, ...o }) => o) }));
    const confirmed = ctx => { if (ctx.body.confirm !== true) throw Error('삭제를 명시적으로 확인해 주세요.'); };
    add('DELETE', 'orphans/:id', ctx => { confirmed(ctx); return ctx.um.backup.removeOrphan(chatOf(ctx)); });
    add('POST', 'orphans/delete-all', async ctx => {
        confirmed(ctx);
        const list = await ctx.um.backup.orphans(); let deleted = 0;
        for (const entry of list) { await ctx.um.backup.removeOrphan(entry.id); deleted++; }
        return { deleted };
    });
}
