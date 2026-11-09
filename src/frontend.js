// 기억 서재 (Lumiverse) — frontend entry: wires the link to the backend, the original memory screen and the shell.
import { selectedMessageParts } from './common/message-selection.js';
import { createLink, createMarinara, createFetch } from './shim/marinara.js';
import { createShell } from './shell.js';
import { createOverlayGuard } from './overlay-guard.js';
import { attachSummarizationFrontend } from './common/host-settings.js';
import { mountMemory } from './memory/ui/runtime.generated.js';
import { MEMORY_OVERRIDES } from './style.js';

export function setup(ctx, opts = {}) {
    const doc = opts.document || globalThis.document;
    const win = opts.window || globalThis.window;
    const link = createLink(ctx, opts.link);
    const hosts = new Set();
    let alive = true;
    const guard = createOverlayGuard({ doc, win });
    const memoryGuard = guard.register({ label: '기억 서재 닫기', close: () => memory?.close(), escape: true });

    /** The chat the user is looking at. Subscriptions give no first value (AGENTS 2): read it when needed. */
    const getChatId = () => {
        try { const c = ctx.getActiveChat?.(); if (c && typeof c.chatId === 'string') return c.chatId; } catch { /* older host */ }
        try { return ctx.state?.get?.('chat.active')?.chatId || ''; } catch { return ''; }
    };
    const fireChat = () => { setTimeout(() => { shell?.refresh?.(); }, 0); };
    const offs = [attachSummarizationFrontend(ctx)];
    for (const ev of ['CHAT_SWITCHED', 'CHAT_CHANGED']) { try { const off = ctx.events?.on?.(ev, fireChat); if (typeof off === 'function') offs.push(off); } catch { /* optional */ } }
    try { const off = ctx.state?.subscribe?.('chat.active', fireChat); if (typeof off === 'function') offs.push(off); } catch { /* optional */ }

    const mountHost = el => { hosts.add(el); (doc.body || doc.documentElement).append(el); };
    const { marinara, runCleanups } = createMarinara(link);

    // ---- memory library and host-message selection ----
    let memory = null;
    const memoryLV = {
        css: MEMORY_OVERRIDES,
        selectionParts: range => selectedMessageParts(range, doc),
        fetch: createFetch(link),
        activeChatId: getChatId,
        mountHost,
        onOpen: open => memoryGuard.sync(open),
        toggle: null,
    };
    const seedTheme = () => {
        // follow the host's brightness the first time (the screen keeps its own sun/moon switch afterwards)
        try {
            if (win.localStorage?.getItem('memory-module-theme')) return;
            const bg = win.getComputedStyle(doc.documentElement).getPropertyValue('--lumiverse-bg') || '';
            const m = bg.match(/[\d.]+/g);
            if (m && m.length >= 3) { const lum = (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) / 255; win.localStorage?.setItem('memory-module-theme', lum < 0.5 ? 'dark' : 'light'); }
        } catch { /* storage or style unavailable */ }
    };
    const mountMemoryNow = () => { if (memory || !alive) return memory; seedTheme(); try { memory = mountMemory(marinara, memoryLV); } catch (e) { console.warn('[memory-library] 기억 서재 화면을 열지 못했어요', e); } return memory; };
    const openMemory = () => { const m = mountMemoryNow(); return m?.open(); };

    let shell = null;
    shell = createShell(ctx, { link, getChatId, openMemory, doc });

    // Install selection while the library is closed, including before its first opening.
    mountMemoryNow();

    return () => {
        alive = false;
        for (const off of offs) { try { off(); } catch { /* ignore */ } }
        try { shell.dispose(); } catch { /* ignore */ }
        try { memory?.dispose(); } catch { /* ignore */ }
        try { runCleanups(); } catch { /* ignore */ }
        for (const h of hosts) { try { h.remove(); } catch { /* ignore */ } }
        try { guard.dispose(); } catch { /* ignore */ }
        link.dispose();
    };
}
