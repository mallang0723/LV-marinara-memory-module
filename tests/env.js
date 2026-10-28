// Test environment: fake Spindle host + store + adapter + memory service, all in memory.
import { fake } from './fake.js';
import { createStore } from '../src/common/store.js';
import { createHostAdapter } from '../src/common/host-adapter.js';
import { createMemoryService } from '../src/memory/service.js';

export const U = 'u1';
export function makeEnv({ tunables = {}, fakeOpts = {}, debounceMs = 0 } = {}) {
    const f = fake(fakeOpts);
    const logs = [];
    const log = m => logs.push(String(m));
    const store = createStore(f.api, { debounceMs });
    const host = createHostAdapter(f.api, { log });
    const svc = createMemoryService({ host, store, log, tunables });
    const um = svc.forUser(U);
    return { f, store, host, svc, um, logs, U };
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
