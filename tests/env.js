// Test environment: fake Spindle host + the extension's manager (pinned upstream service per user), all in memory.
import { fake } from './fake.js';
import { createManager } from '../src/adapter/manager.js';
import { inRoom } from '../src/common/meter.js';

export const U = 'u1';
export function makeEnv({ tunables = {}, fakeOpts = {}, debounceMs = 0 } = {}) {
    const f = fake(fakeOpts);
    const logs = [];
    const log = m => logs.push(String(m));
    const manager = createManager({ api: f.api, log, tunables, debounceMs, afterReplyMs: 5 });
    const inst = manager.forUser(U);
    // Test conveniences over the instance (all sync reads work once a room's files are loaded).
    const um = Object.assign(Object.create(inst), {
        saveSettings: next => inst.X.saveSettings(next),
        setChatEnabled: (id, on) => { const s = inst.settings(); inst.X.saveSettings({ ...s, chats: { ...(s.chats || {}), [id]: { ...(s.chats?.[id] || {}), enabled: on } } }); },
        loadLedger: id => inst.X.loadLedger(id),
        jobStatus: id => inst.X.jobs.get(id) || { state: 'idle' },
        recalls: inst.X.recalls,
        processChat: async (id, o) => { await inst.preloadRoom(id); const r = await inRoom.run({ chatId: id }, () => inst.u.run(() => inst.svc.processChat(id, o))); await inst.u.run(() => inst.X.enqueue(`scenes:${id}`, async () => {})); await inst.rendered(id); return r; },
    });
    /** A request through the same path the screen uses (router -> instance routes). */
    const rpc = (method, path, body) => manager.forUser(U).ready().then(() => manager.forUser(U).handle({ method, path: 'memory-module/' + path.replace(/^\/+/, ''), body }));
    return { f, manager, um, inst, logs, U, rpc, svc: manager };
}

/** A story with numbered sentences the scripted model reads (promise lines get ledger threads). */
export function story(f, chatId = 'chat-a', n = 7, { promiseAt = 1 } = {}) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const user = i % 2 === 0;
        rows.push({ role: user ? 'user' : 'assistant', name: user ? '서아' : '하루', content: i === promiseAt ? '"내일 같이 달빛호수 가자, 약속할게." 하루가 웃었다.' : user ? `서아가 하루에게 말을 걸었다. ${i}번째 이야기.` : `하루가 대답했다. 그래, 그렇게 하자. ${i}번째 대답.` });
    }
    return f.addMessages(chatId, rows);
}

export async function waitUntil(fn, ms = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 2)); }
    throw new Error('waitUntil timed out');
}
