// The pinned cores keep three process-wide hooks (aliases `setLoader`, scenes `setAddressProvider` / `setStateProvider`) that
// each service instance sets at load time. With one instance per user the last one would win for everybody, so the instances
// register here instead and one dispatcher is installed in the real core: it asks the instance that is running (an
// AsyncLocalStorage set around every entry into an instance), else the first instance that knows the answer.
import { AsyncLocalStorage } from 'node:async_hooks';

export const running = new AsyncLocalStorage();

const hooks = { loader: new Map(), address: new Map(), state: new Map() };
const installed = new Set();

function dispatcher(kind) {
    return (...args) => {
        const own = running.getStore();
        const fn = own && hooks[kind].get(own);
        if (fn) return fn(...args);
        for (const f of hooks[kind].values()) { const out = f(...args); if (out != null) return out; }
        return null;
    };
}
function proxyFor(real, owner, table) {
    return new Proxy(real, {
        get(target, key) {
            if (table[key]) return fn => { hooks[table[key]].set(owner, fn); if (!installed.has(key + '@' + real)) { installed.add(key + '@' + real); target[key](dispatcher(table[key])); } };
            return target[key];
        },
    });
}
export const aliasesFor = (real, owner) => proxyFor(real, owner, { setLoader: 'loader' });
export const scenesFor = (real, owner) => proxyFor(real, owner, { setAddressProvider: 'address', setStateProvider: 'state' });
export const release = owner => { for (const m of Object.values(hooks)) m.delete(owner); };
