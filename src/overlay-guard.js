// Reliable way out of the two full-screen overlays on a phone (the originals' own close button sits in a top bar that can be
// clipped by a status bar / notch / browser chrome, and neither original handles the Android back button):
//  - a floating close button in its own host (top-right, safe-area aware, >= 44px, light/dark readable), above both overlays,
//  - a history entry per open overlay, so the back button / back gesture closes the top overlay instead of leaving the page,
//  - Escape for overlays whose original has no Escape handling of its own (`escape: true`).
// The overlays tell us when they open/close (LV.onOpen, patched in); closing never touches their state, it calls their own close().
export const GUARD_CSS = `
:host{all:initial;position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;display:block}
button{pointer-events:auto;position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);right:calc(env(safe-area-inset-right,0px) + 6px);width:44px;height:44px;min-width:44px;min-height:44px;padding:0;margin:0;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:#1c1b29;color:#fff;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.55),0 4px 14px rgba(0,0,0,.45);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:active{background:#000}
button:focus-visible{outline:3px solid #ffd54a;outline-offset:2px}
svg{width:22px;height:22px;display:block}
/* desktop with a mouse: the screens' own close button and Escape are enough */
@media (min-width:721px) and (hover:hover){button{display:none}}
`;
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export function createOverlayGuard({ doc = globalThis.document, win = globalThis.window } = {}) {
    const stack = [];            // open overlays, last = top
    let host = null, btn = null, ignoreAt = 0, seq = 0;
    const mark = '__amOverlay';

    const ensureButton = () => {
        if (host) return;
        host = doc.createElement('div');
        host.id = 'am-overlay-guard';
        const root = host.attachShadow({ mode: 'open' });
        const st = doc.createElement('style'); st.textContent = GUARD_CSS;
        btn = doc.createElement('button');
        btn.type = 'button'; btn.innerHTML = ICON;
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closeTop(); });
        root.append(st, btn);
    };
    const paint = () => {
        if (!stack.length) { if (host) host.remove(); return; }
        ensureButton();
        const top = stack[stack.length - 1];
        btn.setAttribute('aria-label', top.label); btn.title = top.label;
        // last in the document wins the tie against the memory screen's own z-index 2147483647
        (doc.documentElement).append(host);
    };
    function closeTop() { const top = stack[stack.length - 1]; if (top) { try { top.close(); } catch { /* ignore */ } } }

    const onPop = () => {
        if (ignoreAt && Date.now() - ignoreAt < 700) { ignoreAt = 0; return; }   // the popstate of our own history.back()
        ignoreAt = 0;
        const top = stack[stack.length - 1];
        if (!top) return;
        top.pushed = false;
        try { top.close(); } catch { /* ignore */ }
    };
    const onKey = e => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        const top = stack[stack.length - 1];
        if (top && top.escape) { try { top.close(); } catch { /* ignore */ } }
    };
    win.addEventListener('popstate', onPop);
    win.addEventListener('keydown', onKey);

    return {
        /** One overlay: call sync(true|false) whenever its open state is (re)drawn; close() must close it. */
        register({ label, close, escape = false }) {
            const entry = { id: ++seq, label, close, escape, pushed: false };
            return {
                sync(open) {
                    const at = stack.indexOf(entry);
                    if (open && at < 0) {
                        stack.push(entry);
                        try { win.history.pushState({ [mark]: entry.id }, ''); entry.pushed = true; } catch { /* no history API */ }
                    } else if (open && at >= 0 && at !== stack.length - 1) {
                        stack.push(...stack.splice(at, 1));          // reopened/raised: it is the top one again
                    } else if (!open && at >= 0) {
                        stack.splice(at, 1);
                        if (entry.pushed) {
                            entry.pushed = false;
                            try { if (win.history.state && win.history.state[mark] === entry.id) { ignoreAt = Date.now(); win.history.back(); } } catch { /* ignore */ }
                        }
                    }
                    paint();
                },
            };
        },
        isOpen: () => stack.length > 0,
        dispose() { win.removeEventListener('popstate', onPop); win.removeEventListener('keydown', onKey); stack.length = 0; if (host) host.remove(); },
    };
}
