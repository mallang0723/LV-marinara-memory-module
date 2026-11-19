// One instance of the pinned upstream service (src/memory/core/service.cjs, wrapped by core-patch.mjs patchService) per user:
// its `fs` is the synchronous in-memory tree of this user's storage (vfs.js), its engine is Lumiverse (engine.js), its routes
// are collected from a fake Fastify app so they can be mounted on the extension's router.
import path from 'node:path';
import makeService from '../memory/core/service.generated.cjs';
import cores from './cores.cjs';
import hideBlocks from './hide-blocks.cjs';
import { createVfs, ROOT } from './vfs.js';
import { createEngine } from './engine.js';
import { aliasesFor, scenesFor, release, running } from './dispatch.js';

// Lumiverse-only switch "하단 블록 빼고 읽기" joins the live feature registry (the pinned features.cjs is not edited; the upstream test harness never loads this file).
hideBlocks.install(cores['./features.cjs']);

export const DATA_ROOT = '/lv';   // DATA_DIR of the instance; the service appends /memory-module (= vfs ROOT)

/** A minimal Fastify look-alike that only records routes and hooks. */
export function collectRoutes(register) {
    const routes = [], hooks = [];
    const make = prefix => {
        const app = {
            register(fn, opts = {}) { const r = fn(make(prefix + (opts.prefix || ''))); return r; },
            addHook(name, fn) { hooks.push({ name, fn }); },
        };
        for (const method of ['get', 'post', 'put', 'patch', 'delete']) app[method] = (p, ...rest) => routes.push({ method: method.toUpperCase(), path: prefix + p, handler: rest.at(-1) });   // (path, handler) or (path, options, handler)
        return app;
    };
    register(make(''));
    return { routes, hooks };
}

export function createUserService({ api, userId, log = () => {}, env = {}, version = '0', vfs: injectedVfs, fs: realFs, engine: injectedEngine, debounceMs, getMessageLimit, translator, meter = null }) {
    let svc = null;
    const vfs = realFs ? null : injectedVfs || createVfs({ storage: api.userStorage, userId, log, ...(debounceMs != null ? { debounceMs } : {}) });
    const eng = injectedEngine || createEngine({ api, userId, log, getMessageLimit, translator, meter, getHideBlocks: chatId => { try { const all = svc?._test.settings(); return cores['./features.cjs'].resolve(all, chatId, 'hideBlocks').enabled ? hideBlocks.tagsOf(all.chats?.[chatId]?.hideBlocks) : null; } catch { return null; } }, getWindow: () => { try { return Number(svc?._test.settings().window) || null; } catch { return null; } } });
    const exits = [];
    const fakeProcess = { env: { DATA_DIR: DATA_ROOT, ...env }, pid: 0, argv: ['lumiverse-extension'], stderr: { write: s => log(String(s).trimEnd()) }, lvRecallBudgetMs: () => { try { return Number(svc?._test.settings().interceptorBudgetMs) || 0; } catch { return 0; } }, on: (ev, fn) => { if (ev === 'exit') exits.push(fn); } };
    const urlShim = { pathToFileURL: p => new URL('file://' + p) };
    const owner = {};
    const mine = {};
    const req = name => {
        if (name === './aliases.cjs') return (mine[name] ??= aliasesFor(cores[name], owner));
        if (name === './scenes.cjs') return (mine[name] ??= scenesFor(cores[name], owner));
        if (name === 'node:fs' || name === 'fs') return realFs || vfs.fs;
        if (name === 'node:path' || name === 'path') return path;
        if (name === 'node:url' || name === 'url') return urlShim;
        if (name in cores) return cores[name];
        throw Error(`service asked for an unknown module: ${name}`);
    };
    const mod = { exports: {} };
    globalThis.__marinaraMemory = { ...(globalThis.__marinaraMemory || {}), version };
    svc = makeService(req, fakeProcess, mod);
    svc._test.setEngine(eng.engine);
    const { routes, hooks } = collectRoutes(app => svc.attach(app));
    /** Runs fn as this instance: its hooks answer, and files it needs but has not loaded are loaded (vfs.run). */
    const run = fn => running.run(owner, () => (vfs ? vfs.run(fn) : fn()));
    return {
        svc, X: svc._test, vfs, eng, routes, hooks, run, owner,
        dispose() { for (const fn of exits) { try { fn(); } catch { /* shutting down */ } } release(owner); },
    };
}
