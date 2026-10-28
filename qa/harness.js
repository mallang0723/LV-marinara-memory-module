// Browser QA stub of the Lumiverse frontend: the built dist/frontend.js runs against stand-ins for the drawer, the input bar
// Extras and the events; its backend channel goes to the QA script's node process (qa/backend-env.mjs: the real backend entry on
// the fake Spindle host) through /__rpc and /__poll. No model, no external network.
import { setup } from '../dist/frontend.js';

const USER = 'qa-user';
let toFrontend = null;
const handlers = new Map();
let activeChat = 'chat-a';
const state = { 'chat.active': { chatId: 'chat-a', characterId: 'char-haru' } };
const tabs = [], actions = [], toasts = [];
let activations = 0;
const drawer = document.getElementById('drawer'), sidebar = document.getElementById('sidebar'), content = document.getElementById('panelContent'), title = document.getElementById('drawer-title');
const extrasMenu = document.getElementById('extras-menu');

async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
}
let polling = true;
(async function poll() {
    while (polling) {
        try { const { events } = await (await fetch('./__poll')).json(); for (const m of events || []) toFrontend?.(m); } catch { /* page closing */ }
        await new Promise(r => setTimeout(r, 250));
    }
})();

function showTab(t) {
    for (const x of tabs) { x.wrap.classList.toggle('on', x === t); x.button.classList.toggle('on', x === t); }
    drawer.classList.add('on');
    title.textContent = t.options.headerTitle || t.options.title;
    activations++;
    for (const fn of t.activators) fn();
}
const ctx = {
    ui: {
        registerDrawerTab(o) {
            const wrap = document.createElement('div'), root = document.createElement('div');
            wrap.append(root); content.append(wrap);
            const button = document.createElement('button'); button.textContent = o.shortName || o.title; button.setAttribute('aria-label', o.title); button.innerHTML = (o.iconSvg || '') + '<br>' + button.textContent;
            const t = { options: o, wrap, root, button, activators: new Set() };
            button.addEventListener('click', () => showTab(t));
            sidebar.append(button);
            tabs.push(t);
            return { root, tabId: 'anon_memory_lv:' + o.id, setTitle() {}, setShortName() {}, setBadge() {}, activate() { showTab(t); }, onActivate(fn) { t.activators.add(fn); return () => t.activators.delete(fn); }, destroy() { wrap.remove(); button.remove(); tabs.splice(tabs.indexOf(t), 1); } };
        },
        registerInputBarAction(o) {
            const hs = new Set();
            const b = document.createElement('button'); b.textContent = o.label; b.dataset.action = o.id;
            b.addEventListener('click', () => { extrasMenu.classList.remove('on'); for (const h of hs) h(); });
            extrasMenu.append(b);
            const a = { options: o, onClick(fn) { hs.add(fn); return () => hs.delete(fn); }, destroy() { b.remove(); } };
            actions.push(a);
            return a;
        },
        showToast(m) { toasts.push(m); const d = document.createElement('div'); d.textContent = m; document.getElementById('toasts').append(d); setTimeout(() => d.remove(), 4000); },
        async showConfirm() { return { confirmed: true }; },
    },
    events: { on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return () => handlers.get(event).delete(fn); }, emit(event, p) { for (const fn of handlers.get(event) || []) fn(p); } },
    getActiveChat: () => ({ chatId: activeChat, characterId: 'char-haru' }),
    state: { get: k => state[k], subscribe() { return () => {}; } },
    onBackendMessage(fn) { toFrontend = fn; return () => { toFrontend = null; }; },
    sendToBackend(m) {
        post('./__rpc', { frame: JSON.parse(JSON.stringify(m)), user: USER }).then(({ replies }) => { for (const r of replies || []) toFrontend?.(r); }).catch(() => {});
    },
};
document.getElementById('extras-btn').addEventListener('click', () => extrasMenu.classList.toggle('on'));

const hostThemes = await (await fetch('./host-themes.json')).json();
function setTheme(name) {
    const set = hostThemes[name];
    if (!set) throw Error('unknown theme ' + name);
    const root = document.documentElement;
    for (const p of [...root.style]) if (p.startsWith('--lumiverse-')) root.style.removeProperty(p);
    for (const [k, v] of Object.entries(set)) root.style.setProperty(k, v);
}
setTheme('default-dark');
let dispose = null;
const mount = () => { dispose = setup(ctx); };
mount();
const shadowRoots = () => [...document.querySelectorAll('#memory-module-library')].map(h => h.shadowRoot).filter(Boolean);
window.qa = {
    ctx, setTheme, tabs, actions, toasts,
    themes: Object.keys(hostThemes).filter(k => !k.startsWith('_')),
    get activations() { return activations; },
    env: () => ({ secure: window.isSecureContext, randomUUID: typeof crypto?.randomUUID, subtle: typeof crypto?.subtle, clipboard: typeof navigator.clipboard, share: typeof navigator.share, origin: location.origin }),
    openTab(id) { const t = tabs.find(x => x.options.id === id); if (!t) throw Error('no tab ' + id); showTab(t); },
    clickAction(id) { document.querySelector(`#extras-menu [data-action="${id}"]`).click(); },
    switchChat(chatId) { activeChat = chatId; state['chat.active'] = { chatId, characterId: null }; for (const fn of handlers.get('CHAT_SWITCHED') || []) fn({ chatId }); },
    shadowRoots,
    drawerRoot: id => tabs.find(t => t.options.id === id)?.root,
    remount() { dispose?.(); for (const t of [...tabs]) { t.wrap.remove(); t.button.remove(); } tabs.length = 0; actions.length = 0; extrasMenu.replaceChildren(); mount(); },
    stop() { polling = false; },
    ready: true,
};
