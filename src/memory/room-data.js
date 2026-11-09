// Per-user, per-room additions to the 0.12.6 core. No host-global alias loader:
// simultaneous users may have different name tables for the same chat id.
import { AsyncLocalStorage } from 'node:async_hooks';
import A from './core/aliases.cjs';
import Addr from './core/address.generated.cjs';
import S from './core/scenes.generated.cjs';
import F from './core/features.cjs';
import St from './core/state.generated.cjs';
import Pl from './core/places.generated.cjs';
import Ks from './core/keepsakes.generated.cjs';
import Cf from './core/conflicts.generated.cjs';
import Tk from './core/trackers.generated.cjs';
import Rp from './core/reasons.generated.cjs';
const books = new AsyncLocalStorage();
S.setAddressProvider(() => {
    const book = books.getStore()?.address();
    return book ? Addr.termMap(book) : null;
});
S.setStateProvider(() => books.getStore()?.placeKey() || null);
export const FEATURE_REGISTRY = F.FEATURES;
export function createRoomData({ store, userId, keyFor, persist, settings }) {
    const cache = new Map();
    const loading = new Map();
    const definitions = {
        state: [1, St.emptyState], places: [1, Pl.emptyPlaces], keepsakes: [1, Ks.emptyKeepsakes],
        conflicts: [1, Cf.emptyConflicts], trackers: [1, Tk.emptyTrackers],
        'recall-prefs': [1, Rp.emptyPrefs], selected: [1, () => ({ version: 1, items: [] })],
        names: [A.NAMES_VERSION, A.emptyTable],
        address: [Addr.ADDRESS_VERSION, Addr.emptyBook],
        'attribution-log': [1, () => ({ version: 1, runs: [] })],
        lang: [1, () => ({ version: 1, lang: null })],
    };
    async function load(id) {
        if (cache.has(id)) return;
        if (!loading.has(id)) loading.set(id, read(id).finally(() => loading.delete(id)));
        return loading.get(id);
    }
    async function read(id) {
        const data = {};
        for (const [name, [version, empty]] of Object.entries(definitions)) {
            const key = keyFor(id, name);
            data[name] = await store.supported(userId, key, await store.getJson(userId, key, null), version) || empty();
        }
        cache.set(id, data);
    }
    const get = (id, name) => cache.get(id)?.[name] || definitions[name][1]();
    function save(id, name, data) {
        if (!cache.has(id)) throw Error('internal: room data not loaded');
        data.updatedAt = new Date().toISOString();
        persist(keyFor(id, name), data);
        if (name === 'names') Object.assign(cache.get(id).names, data);
        else cache.get(id)[name] = data;
    }
    function using(id, fn) { return books.run({ address: () => get(id, 'address'), placeKey: () => !F.resolve(settings(), id, 'characterState').enabled ? null : name => F.resolve(settings(), id, 'places').enabled ? Pl.resolve(get(id, 'places'), name)?.id || Pl.keyOf(name) : Pl.keyOf(name) }, () => A.using(get(id, 'names'), fn)); }
    function seed(id, names) {
        const table = structuredClone(get(id, 'names'));
        if (A.seed(table, names)) save(id, 'names', table);
    }
    function refreshAddress(id, scenes) {
        const book = structuredClone(get(id, 'address'));
        if (using(id, () => Addr.refresh(book, scenes))) save(id, 'address', book);
    }
    function learnEdit(id, st, oldScene, newScene) {
        const book = structuredClone(get(id, 'address')), table = structuredClone(get(id, 'names'));
        const auto = F.resolve(settings(), id, 'autoApply').enabled;
        using(id, () => Addr.learnFromSceneEdit(book, { store: st, oldScene, newScene, table, options: { address: true, auto } }));
        save(id, 'names', table);
        save(id, 'address', book);
    }
    const featureView = id => F.view(settings(), id, FEATURE_REGISTRY);
    const routineEnabled = id => F.resolve(settings(), id, 'recentLife').enabled;
    return { invalidate: id => cache.delete(id), load, get, save, using, seed, refreshAddress, learnEdit, featureView, routineEnabled, names: Object.keys(definitions) };
}
