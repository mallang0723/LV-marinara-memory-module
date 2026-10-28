// Shell: where the memory screen lives in Lumiverse.
//  - drawer tab `기억 서재` (registerDrawerTab): a home card with an "open" button, this chat's status and the switches.
//    The original screen is a full overlay (shadow DOM on document.body, like the original), opened from the tab, from the
//    input bar's Extras (registerInputBarAction) and from Ctrl+K (the backend forwards the command).
//  - the screen is mounted the first time it is opened.
// Host facts: types/dom.d.ts:122-153 (drawer tab: root / onActivate; onActivate is not fired when the same tab is re-opened,
// so the card reads the current chat when it is built and on chat events), :384-398 (input bar action), :1255 (getActiveChat),
// :1136 (ctx.events.on), AGENTS 2 (state subscriptions give no first value).
import { STYLE } from './style.js';

export const TITLE_MEMORY = '기억 서재';
const NEED = { generation: '생성(generation)', chats: '채팅(chats)', chat_mutation: '메시지(chat_mutation)', characters: '캐릭터(characters)', interceptor: '기억 주입(interceptor)' };
const ICON_MEMORY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/></svg>';

export function createShell(ctx, { link, getChatId, openMemory, doc = globalThis.document }) {
    let alive = true;
    const disposers = [];
    const handles = [];
    let info = null;          // ext/info
    let ext = null;           // ext/settings
    let chatInfo = null;      // memory-module/chats/:id (short form)
    let memTab = null, memRoot = null;

    const el = (tag, attrs = {}, ...kids) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
        }
        for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'object' && 'nodeType' in c ? c : doc.createTextNode(String(c)));
        return n;
    };
    const toast = m => { try { ctx.ui?.showToast?.(m); } catch { /* optional */ } };
    const safe = async (fn, fallback = null) => { try { return await fn(); } catch (e) { return fallback; } };
    const note = e => toast(String(e?.message || e || '요청을 처리하지 못했습니다.'));

    // ---------- data ----------
    async function refresh() {
        if (!alive) return;
        info = await safe(() => link.call('GET', 'ext/info'), info);
        ext = await safe(() => link.call('GET', 'ext/settings'), ext);
        const chatId = getChatId();
        chatInfo = chatId ? await safe(() => link.call('GET', `memory-module/chats/${encodeURIComponent(chatId)}`), null) : null;
        paint();
    }
    async function saveExt(patch) {
        try { const r = await link.call('POST', 'ext/settings', patch); ext = { ...(ext || {}), ...r.settings }; } catch (e) { note(e); }
        await refresh();
    }
    const missing = () => Object.entries(NEED).filter(([k]) => info && info.permissions && info.permissions[k] === false).map(([, l]) => l);

    // ---------- tab content ----------
    const switchRow = (label, checked, onChange, hint) => el('div', { class: 'am-card-row' },
        el('div', { class: 'am-row' }, el('label', {}, (() => { const c = el('input', { type: 'checkbox' }); c.checked = checked; c.addEventListener('change', () => onChange(c.checked)); return c; })(), el('span', { text: label }))),
        hint ? el('div', { class: 'am-hint', text: hint }) : null);
    const warn = () => (missing().length ? el('p', { class: 'am-warn', text: `허용되지 않은 권한: ${missing().join(', ')} — 루미버스의 확장 설정에서 허용해 주세요.` }) : null);

    function memoryCard() {
        const chatId = getChatId();
        const c = chatInfo;
        const stat = c ? el('div', { class: 'am-stat' },
            el('span', {}, '장면 ', el('b', { text: String(c.scenes?.count ?? 0) })), el('span', {}, '사실 ', el('b', { text: String(c.scenes?.facts ?? 0) })),
            el('span', {}, '열린 항목 ', el('b', { text: String(Object.values(c.summary?.open || {}).reduce((a, b) => a + b, 0)) })),
            el('span', {}, '정리 ', el('b', { text: c.job?.state === 'running' || c.sceneJob?.state === 'running' ? '진행 중' : c.job?.state === 'error' ? '오류' : '쉬는 중' }))) : null;
        const budgetOptions = [4, 6, 8, 10].map(s => el('option', { value: String(s * 1000), text: `${s}초`, ...(Number(ext?.interceptorBudgetMs || 6000) === s * 1000 ? { selected: true } : {}) }));
        const budget = el('select', { 'aria-label': '기억 주입 시간 한도' }, budgetOptions);
        budget.addEventListener('change', () => saveExt({ interceptorBudgetMs: Number(budget.value) }));
        return el('div', { class: 'am-tab' },
            el('div', { class: 'am-card' },
                el('h2', { text: TITLE_MEMORY }),
                el('p', { text: '긴 RP를 장면·사실·미해결 장부로 정리해 두었다가 답변 직전에 프롬프트에 넣어 줘요.' }),
                chatId ? (c ? el('p', { class: 'am-ok', text: c.enabled ? '이 방은 기억이 켜져 있어요.' : '이 방은 기억이 꺼져 있어요.' }) : el('p', { class: 'am-hint', text: '이 방의 기억 상태를 읽지 못했어요. 권한을 확인해 주세요.' })) : el('p', { class: 'am-hint', text: '채팅을 열어 두면 그 방의 기억을 보여 줘요.' }),
                stat,
                el('button', { class: 'am-btn', type: 'button', text: '기억 서재 열기', onclick: () => openMemory() }),
                chatId && c ? el('div', { class: 'am-row' },
                    el('button', { class: 'am-btn am-quiet', type: 'button', text: c.enabled ? '이 방 끄기' : '이 방 켜기', onclick: () => toggleRoom() }),
                    el('button', { class: 'am-btn am-quiet', type: 'button', text: '이어서 정리', onclick: () => continueRoom() })) : null),
            warn(),
            el('div', { class: 'am-card' },
                el('h2', { text: '설정' }),
                switchRow('기억 서재 사용', ext ? ext.moduleMemory !== false : true, v => saveExt({ moduleMemory: v }), '끄면 어느 방에서도 기억을 넣지도, 갱신하지도 않아요.'),
                switchRow('프롬프트에 자동으로 넣기', ext ? ext.autoInject !== false : true, v => saveExt({ autoInject: v }), `프리셋에 {{memory_ledger}} 매크로를 넣어 쓰면 이 칸을 꺼도 돼요. 매크로를 넣어 두면 그 자리의 내용이 최신으로 바뀌어요.`),
                el('label', { class: 'am-field' }, '기억 주입에 쓸 수 있는 시간', budget),
                el('div', { class: 'am-hint', text: '루미버스는 인터셉터를 기본 10초까지 기다려요. 회상은 이 시간을 넘기면 빠른 방식으로 대신해요.' }),
                el('div', { class: 'am-hint', text: '같은 {{memory_ledger}} 매크로를 쓰는 다른 기억 확장(예: LV-AnonMemory의 기억 서재)과 함께 켜지 마세요. 하나만 쓰거나 한쪽의 기억을 꺼 주세요.' })));
    }
    function paint() {
        if (!alive) return;
        if (memRoot) memRoot.replaceChildren(el('style', { text: STYLE }), memoryCard());
    }

    async function toggleRoom() {
        const chatId = getChatId();
        if (!chatId) return toast('먼저 채팅을 열어 주세요.');
        try {
            const on = !(chatInfo?.enabled);
            await link.call('POST', `memory-module/chats/${encodeURIComponent(chatId)}/${on ? 'enable' : 'disable'}`, {});
            toast(on ? '이 방에서 기억을 켰어요. 처음이면 ‘이어서 정리’를 눌러 주세요.' : '이 방의 기억을 껐어요.');
        } catch (e) { note(e); }
        await refresh();
    }
    async function continueRoom() {
        const chatId = getChatId();
        if (!chatId) return toast('먼저 채팅을 열어 주세요.');
        try { await link.call('POST', `memory-module/chats/${encodeURIComponent(chatId)}/start`, {}); toast('기억 정리를 시작했어요.'); } catch (e) { note(e); }
        await refresh();
    }

    // ---------- registration ----------
    function register() {
        try {
            memTab = ctx.ui.registerDrawerTab({ id: 'memory', title: TITLE_MEMORY, shortName: '기억', headerTitle: TITLE_MEMORY, description: '장면·사실·미해결 장부를 보고 고치기', keywords: ['기억', '서재', '장부', '장면', 'memory', 'ledger'], iconSvg: ICON_MEMORY });
            memRoot = el('div', { class: 'am-drawer' });
            memTab.root.replaceChildren(memRoot);
            handles.push(memTab);
            disposers.push(memTab.onActivate(() => refresh()));
        } catch { memTab = null; }
        for (const [id, label, open, icon] of [['memory-open', '기억 서재 열기', () => openMemory(), ICON_MEMORY]]) {
            try {
                const a = ctx.ui.registerInputBarAction({ id, label, iconSvg: icon });
                handles.push(a);
                disposers.push(a.onClick(open));
            } catch { /* optional surface */ }
        }
    }
    register();
    paint();
    void refresh();

    // Ctrl+K: the backend only forwards "command X in chat Y" to every connected frontend (the host gives a command handler no
    // user id, worker-runtime.ts:5195-5200); act only when this tab looks at that chat (or no chat is involved)
    disposers.push(link.onEvent(msg => {
        if (msg.event !== 'command') return;
        const chatId = getChatId();
        if (msg.chatId && chatId && msg.chatId !== chatId) return;
        if (msg.id === 'open-memory') openMemory();
        else if (msg.id === 'memory-continue') void continueRoom();
        else if (msg.id === 'memory-toggle') void toggleRoom();
    }));

    return {
        refresh, paint,
        get info() { return info; }, get chatInfo() { return chatInfo; },
        dispose() {
            alive = false;
            for (const d of disposers) { try { d(); } catch { /* ignore */ } }
            for (const h of handles) { try { h.destroy(); } catch { /* ignore */ } }
        },
    };
}
