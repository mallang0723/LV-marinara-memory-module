// Turns the unmodified 기억 서재 screen (runtime.orig.js, an IIFE that installs a launcher + shadow-DOM panel into Marinara's page)
// into `export function mountMemory(marinara, LV)`: same screen, same routes (served by src/memory/routes.js through the shim).
// Patch points are anchors that must match exactly once (src/patch-util.mjs). Only what must differ on Lumiverse is changed:
// the transport (fetch -> LV.fetch), the active chat, where the panel is attached, the launcher (removed), the Marinara-only
// speaker-tag switch (removed), Marinara wording, and "choose a connection / recall option = saved at once" (AGENTS 2).
import { createHash } from 'node:crypto';
import { replaceAnchor, replaceRange } from '../../patch-util.mjs';

export const RUNTIME_SHA256 = '47bfacd40f890bae4dd4f0df0abf736abe63a8cedce5a08ed68ac0a5f0f6b2b0';

export function patchMemory({ runtime, uiCss, themeCss, version }) {
    const sha = createHash('sha256').update(runtime).digest('hex');
    if (sha !== RUNTIME_SHA256) throw new Error(`memory screen original changed: sha256 ${sha} != pinned ${RUNTIME_SHA256}`);
    let s = runtime;
    // English story times need more than the first two words even in the scene shelf.
    s = replaceAnchor(s, "esc((s.time || '').split(/\\s+/).slice(0, 2).join(' '))", "esc(s.time || '')", { name: 'full scene shelf time' });
    s = replaceAnchor(s, "(() => {\n  'use strict';", "export function mountMemory(marinara, LV) {\n  'use strict';", { name: 'iife open' });
    // what build.py of the original did: CSS and version into their places
    s = replaceAnchor(s, "/*__UI_CSS__*/ ''", () => '/*__UI_CSS__*/ ' + JSON.stringify(uiCss), { name: 'ui css' });
    s = replaceAnchor(s, "/*__THEME_CSS__*/ ''", () => '/*__THEME_CSS__*/ ' + JSON.stringify(themeCss), { name: 'theme css' });
    s = replaceAnchor(s, "'/*__VERSION__*/'", () => JSON.stringify(version), { name: 'version' });
    // transport: the screen's fetch('/api/memory-module...') and fetch('/api/connections') go through the shim, never to the network
    s = replaceAnchor(s, "response = await fetch(path.startsWith('/api/') ? path : BASE + path, init);", "response = await LV.fetch(path.startsWith('/api/') ? path : BASE + path, init);", { name: 'fetch' });
    s = replaceAnchor(s, "return localStorage.getItem('marinara-active-chat-id') || '';", "return LV.activeChatId() || '';", { name: 'active chat id' });
    s = replaceAnchor(s, '(document.body || document.documentElement).append(element);', 'LV.mountHost(element);', { name: 'mount host' });
    // launcher: removed (drawer tab / input-bar action / Ctrl+K open the panel); its click handler becomes LV.toggle
    s = replaceAnchor(s, "    launcher = makeLauncher();\n    makeDraggable(launcher);\n    launcher.addEventListener('click', () => (open ? closeLibrary() : openLibrary()));", "    LV.toggle = () => (open ? closeLibrary() : openLibrary());", { name: 'launcher handler' });
    s = replaceAnchor(s, '<style>${UI_CSS}${EXTRA_CSS}${THEME_CSS}</style>', '<style>${UI_CSS}${EXTRA_CSS}${THEME_CSS}${LV.css}</style>', { name: 'css order' });
    // speaker tags: a Marinara-only group-bubble feature, not on Lumiverse
    s = replaceAnchor(s, `        <label class="setting-switch"><span>말풍선 태그 되살리기<small>화자 색상이 켜진 '합쳐서' 그룹 RP에서 모델이 원래의 숨은 화자 태그를 출력하도록 지침을 보강합니다. 보이는 이름표 없이 따옴표만 쓰는 대사에도 적용됩니다.</small></span><input type="checkbox" id="setTags" \${info.speakerTags ? 'checked' : ''}></label>\n`, '', { name: 'speaker tags switch' });
    s = replaceAnchor(s, "        <label class=\"setting-switch\"><span>대사 앞에 이름 표시<small>캐릭터 대사에 '이름 | 대사'를 출력하도록 요청합니다. 말풍선 태그 기능과 독립적으로 설정할 수 있습니다.</small></span><input type=\"checkbox\" id=\"setSpeakerNames\" ${info.speakerNames ? 'checked' : ''}></label>\n", '', { name: 'speaker names switch' });
    s = replaceAnchor(s, "      if (e.target.id === 'setSpeakerNames') {\n        const on = e.target.checked;\n        void act(() => api('POST', `/chats/${encodeURIComponent(room)}/speaker-names`, { on }), on ? '대사 앞에 이름 표시를 켰습니다.' : '대사 앞에 이름 표시를 껐습니다.');\n      }\n", '', { name: 'speaker names handler' });
    // choosing a connection / recall option saves at once (it used to wait for the 저장 button); no connection yet shows a prompt
    s = replaceAnchor(s, '<div class="paper"><h2>모든 방 공통</h2>', `<div class="paper"><h2>모든 방 공통</h2>
        <p class="hint" id="windowSource">\${esc(serverSettings?.windowInfo?.label || '창 크기 확인 중')}</p>
        <label>기억 서재 창 크기 (루미버스 메시지 제한이 꺼져 있을 때만 적용)<input id="setWindow" type="number" min="1" step="1" value="\${esc(serverSettings?.window || 30)}"></label>
        <p class="hint">루미버스 요약 → 메시지 제한 → 컨텍스트 내 메시지 제한이 우선합니다. 설정을 읽지 못하면 서재 값, 없으면 기본값 30을 사용합니다.</p>`, { name: 'effective memory window' });
    s = replaceAnchor(s, '<select id="setConnection">${connections.map(', '<select id="setConnection"><option value="" ${current ? \'\' : \'selected\'} disabled>— 연결을 고르세요 —</option>${connections.map(', { name: 'connection placeholder' });
    s = replaceAnchor(s, "      if (e.target.id === 'setTags') {\n        const on = e.target.checked;\n        void act(() => api('POST', `/chats/${encodeURIComponent(room)}/speaker-tags`, { on }), on ? '말풍선 태그 되살리기를 켰습니다.' : '말풍선 태그 되살리기를 껐습니다.');\n      }\n", `      if (['setWriteLang', 'setMemLang', 'setTrConn', 'setTrQuotes'].includes(e.target.id)) { void handle('saveLanguage'); return; }
      const instant = { setConnection: ['/settings', 'connection', '기억 정리에 쓸 연결을 저장했습니다.'], setRecall: ['/settings/recall', 'mode', '회상 방식을 저장했습니다.'], setRecallAmount: ['/settings/recall-amount', 'amount', '회상 양을 저장했습니다.'], setChapterLength: ['/settings/chapter-length', 'length', '지난 이야기 흐름 길이를 저장했습니다.'], setRecallStyle: ['/settings/recall-style', 'style', '기억을 드러내는 정도를 저장했습니다.'] }[e.target.id];
      if (instant && e.target.value) {
        const value = e.target.value;
        void act(async () => { await api('POST', instant[0], { [instant[1]]: value }); serverSettings = (await api('GET', '/status')).settings; }, instant[2]);
      }
`, { name: 'instant save' });
    s = replaceAnchor(s, "      if (['setWriteLang', 'setMemLang', 'setTrConn', 'setTrQuotes'].includes(e.target.id))", `      if (e.target.id === 'setWindow') {
        const window = Number(e.target.value);
        void act(async () => { if (!Number.isInteger(window) || window <= 0) throw Error('창 크기는 1 이상의 정수로 적어 주세요.'); await api('POST', '/api/ext/settings', { window }); serverSettings = (await api('GET', '/status')).settings; }, '루미버스 메시지 제한이 꺼져 있을 때 쓸 창 크기를 저장했습니다.');
        return;
      }
      if (['setWriteLang', 'setMemLang', 'setTrConn', 'setTrQuotes'].includes(e.target.id))`, { name: 'save fallback memory window' });
    // 기억 검색: the stored memory is English while the library shows Korean (the translation cache), so searching "테오" found nothing although the Korean view shows 테오.
    // (Upstream 8d5f090 searches only the stored text, same gap.) Now a record also matches on the Korean text the screen shows for it, and a typed name/term also matches its other
    // spellings from the name table (canonical name, 글에 쓸 표기, aliases) and the 호칭 사전 원어(번역) pairs. One result per record; the excerpt comes from the text that matched.
    s = replaceAnchor(s, "const needsNames = () => ['names', 'life'].includes(tab);", "const needsNames = () => ['names', 'life', 'search'].includes(tab);", { name: 'search needs the name table' });
    s = replaceRange(s, '  function searchableText(value) {', '  function viewSearch() {', `  function searchableText(value, translated = false) {
    if (value == null) return '';
    const leaf = (x) => (translated ? shown(x) : x);
    if (Array.isArray(value)) return value.map((x) => searchableText(x, translated)).filter(Boolean).join(' ');
    if (typeof value !== 'object') return leaf(String(value));
    const parts = [];
    for (const [k, v] of Object.entries(value)) {
      if (v == null) continue;
      if (SEARCH_TEXT.has(k)) parts.push(Array.isArray(v) ? v.filter((x) => typeof x === 'string').map(leaf).join(' ') : typeof v === 'string' ? leaf(v) : '');
      else if (SEARCH_NESTED.has(k)) parts.push(searchableText(v, translated));
    }
    return parts.filter(Boolean).join(' ').replace(/\\s+/g, ' ');
  }

  /** What to look for: the typed text plus the same person/term under its other spellings (name table, 호칭 사전 pairs, cached translations of a bare name). */
  function searchVariants(raw) {
    const low = (x) => String(x ?? '').trim().toLocaleLowerCase();
    const q = low(raw);
    const out = q ? [q] : [];
    if (!q) return out;
    const add = (x) => { const v = low(x); if (v && !out.includes(v)) out.push(v); };
    const groups = [];
    if (names && namesRoom === room) {
      for (const [canon, p] of Object.entries(names.people || {})) groups.push([canon, p?.display, ...(p?.aliases || [])]);
      const entries = names.address?.entries || [];
      for (const e of entries) { const t = entries.find((x) => x.id === e.pairWith); if (t) groups.push([e.term, t.term]); }
    }
    for (const g of groups) {
      const list = g.filter((x) => typeof x === 'string' && x.trim());
      if (!list.some((x) => low(x) === q || low(x).split(/\\s+/).includes(q))) continue;
      for (const x of list) { add(x); const first = low(x).split(/\\s+/)[0]; if (first.length >= 2) add(first); }
    }
    for (const [k, v] of Object.entries(trMap)) if (k.length <= 40 && (low(k) === q || low(v) === q)) { add(k); add(v); }
    return out;
  }

`, 'search text and variants');
    s = replaceRange(s, '    if (query) for (const [label, kind, records] of groups) for (const record of records) {', '    return `<h1>기억 검색</h1>', `    const variants = searchVariants(searchQuery);
    const find = (text) => { const lower = text.toLocaleLowerCase(); let best = null; for (const v of variants) { const i = lower.indexOf(v); if (i >= 0 && (!best || i < best.at)) best = { at: i, length: v.length }; } return best; };
    if (query) for (const [label, kind, records] of groups) for (const record of records) {
      let text = searchableText(record, true);
      let hit = find(text);
      if (!hit) { text = searchableText(record); hit = find(text); }
      if (!hit) continue;
      const start = Math.max(0, hit.at - 45);
      const end = hit.at + hit.length + 110;
      const excerpt = \`\${start ? '…' : ''}\${text.slice(start, end)}\${text.length > end ? '…' : ''}\`;
      results.push(\`<a href="#" class="record-link record-row" data-goto-\${kind}="\${esc(record.id)}"><span class="pill neutral">\${label}</span><span class="row-main"><b>\${esc(record.title || record.about || record.id)}</b><small>\${esc(excerpt)}</small></span><span class="chip-arrow">›</span></a>\`);
    }
`, 'search loop');
    // Marinara wording
    s = replaceAnchor(s, '서버에 연결하지 못했습니다. 마리나라가 다시 켜지는 중이라면 잠시 뒤에 다시 시도해 주세요.', '루미버스 서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', { name: 'wording connect' });
    s = replaceAnchor(s, '서버에 기억 모듈이 없거나 꺼져 있습니다. 서버에 기억 모듈을 설치했는지 확인해 주세요.', '확장의 기억 서재 쪽이 응답하지 않습니다. 확장이 켜져 있는지, 권한이 허용돼 있는지 확인해 주세요.', { name: 'wording 404' });
    s = replaceAnchor(s, '채팅방을 선택해 주세요. 마리나라에서 채팅방을 열면 그 방이 먼저 표시됩니다.', '채팅방을 선택해 주세요. 루미버스에서 채팅방을 열면 그 방이 먼저 표시됩니다.', { name: 'wording room' });
    s = replaceAnchor(s, '마리나라에서 쓰는 글꼴 따라가기', '루미버스 글꼴 따라가기', { name: 'wording font' });
    s = replaceAnchor(s, '마리나라 연결의 임베딩 설정 그대로 쓰기 (추천)', '루미버스의 기본 임베딩 연결 쓰기 (추천)', { name: 'wording embed mode' });
    s = replaceAnchor(s, '‘그대로 쓰기’는 위의 ‘기억 정리에 쓸 연결’에서 마리나라 연결 설정의 <b>시맨틱 검색(임베딩)</b> 모델·주소·임베딩 연결을 그대로 가져옵니다.', '‘기본 임베딩 연결’은 루미버스 설정 &gt; 임베딩의 <b>대표(primary) 임베딩 연결</b>입니다. 임베딩(embeddings) 권한이 필요합니다.', { name: 'wording embed hint' });
    s = replaceAnchor(s, '>여기서 직접 입력</option>', '>임베딩 연결을 이름·모델로 골라 쓰기</option>', { name: 'wording embed manual' });
    s = replaceAnchor(s, '<label>직접 입력할 임베딩 모델<input id="setEmbedding"', '<label>쓸 임베딩 연결(이름이나 모델)<input id="setEmbedding"', { name: 'wording embed label' });
    s = replaceAnchor(s, '임베딩 모델을 찾지 못했습니다. 마리나라 연결 설정에 임베딩 모델을 넣거나 직접 입력해 주세요.', '임베딩 연결을 찾지 못했습니다. 루미버스 설정 > 임베딩에 연결을 추가하거나 이름을 적어 주세요.', { name: 'wording embed none' });
    s = replaceAnchor(s, '<p class="hint">기억 모듈 업데이트는 설치할 때와 같은 명령을 다시 실행하시면 됩니다.</p>', '<p class="hint">이 화면은 루미버스 확장 \\u201c기억 서재\\u201d의 일부입니다. 업데이트는 루미버스 확장 관리에서 합니다.</p>', { name: 'wording update' });
    s = replaceAnchor(s, '<h3>기억은 서버에 있습니다</h3><p>여기서 고친 내용은 서버의 기억 모듈에 바로 저장되고, 다음 답변부터 반영됩니다.</p>', '<h3>기억은 확장 저장소에 있습니다</h3><p>여기서 고친 내용은 확장의 저장소에 바로 저장되고, 다음 답변부터 반영됩니다.</p>', { name: 'wording rail' });
    s = replaceAnchor(s, '지나간 대화를 장면·사실·장부로 정리해, 답변할 때마다 필요한 기억을 넣어 주는 서버 기억 모듈입니다.', '지나간 대화를 장면·사실·장부로 정리해, 답변할 때마다 필요한 기억을 넣어 주는 기억 서재입니다.', { name: 'wording intro' });
    // the shell's overlay guard (floating close button, back button, Escape) is told whenever the panel is (re)drawn open or closed
    s = replaceAnchor(s, "    root.querySelector('#panel').hidden = !open;\n    if (!open) return;", "    root.querySelector('#panel').hidden = !open;\n    LV.onOpen?.(open);\n    if (!open) return;", { name: 'open state hook' });
    s = replaceAnchor(s, "    const sequence = ++roomLoadSequence;\n    if (!id) { info = null; store = null; storeRoom = ''; return; }", "    const sequence = ++roomLoadSequence;\n    if (trRoom !== id) { trMap = {}; trPending = 0; trError = ''; trWorking = false; trRoom = id; }\n    if (!id) { info = null; store = null; storeRoom = ''; return; }", { name: 'clear room translations' });
    s = replaceAnchor(s, "  async function loadTranslations(id) {\n    try {", "  async function loadTranslations(id) {\n    const sequence = roomLoadSequence;\n    try {", { name: 'translation request sequence' });
    s = replaceAnchor(s, "      if (room !== id || disposed) return;\n      trMap = t.items || {};", "      if (room !== id || disposed || sequence !== roomLoadSequence) return;\n      trMap = t.items || {};", { name: 'translation response sequence' });
    s = replaceAnchor(s, "      if (room === id) trError = error?.message || String(error);", "      if (room === id && !disposed && sequence === roomLoadSequence) trError = error?.message || String(error);", { name: 'translation error sequence' });
    s = replaceAnchor(s, '  let trMap = {};', "  let trMap = {};\n  let trRoom = '';", { name: 'translation room owner' });
    s = replaceAnchor(s, '  function render() {', "  function render() {\n    if (trRoom !== room) { trMap = {}; trPending = 0; trError = ''; trWorking = false; trRoom = room; }", { name: 'clear translations before room render' });
    // Lumiverse owns panel geometry; all memory features are available.
    s = replaceAnchor(s, "  function applyPanelGeometry() {", "  function applyPanelGeometry() { return; // Lumiverse owns the panel layout.", { name: "panel geometry owner" });
    s = replaceAnchor(s, "    setupPanelMove();", "", { name: "panel pointer owner" });
    s = replaceAnchor(s, "        <div class=\"resize-edge resize-r\" id=\"resizeRight\" aria-hidden=\"true\"></div><div class=\"resize-edge resize-b\" id=\"resizeBottom\" aria-hidden=\"true\"></div><div class=\"resize-grip\" id=\"resizeCorner\" title=\"끌어서 크기 바꾸기\" aria-hidden=\"true\"></div>", "", { name: "panel resize handles" });
    s = replaceAnchor(s, '<p class="hint">컴퓨터 화면에서는 위쪽 막대를 끌어 창을 옮기고, 오른쪽 아래 모서리·오른쪽·아래쪽 가장자리를 끌어 크기를 바꿀 수 있습니다. 위치와 크기는 이 기기에 기억됩니다.</p>', '<p class="hint">창은 화면 크기에 맞춰 표시됩니다. 휴대폰에서는 위쪽 닫기 버튼이나 뒤로가기로 닫을 수 있습니다.</p>', { name: 'panel layout help' });
    s = replaceAnchor(s, "        <div class=\"buttons\"><button data-act=\"resetPanel\">창 위치 초기화</button></div>\n", "", { name: "panel reset control" });
    s = replaceAnchor(s, "await api('DELETE', `/orphans/${encodeURIComponent(id)}`);", "await api('DELETE', `/orphans/${encodeURIComponent(id)}`, { confirm: true });", { name: 'confirm orphan deletion' });
    s = replaceAnchor(s, "await api('POST', '/orphans/delete-all');", "await api('POST', '/orphans/delete-all', { confirm: true });", { name: 'confirm all orphan deletion' });
    s = replaceRange(s, "      const range = sel.getRangeAt(0), element", "      const boxes = range.getClientRects()", "      const range = sel.getRangeAt(0);\n      const parts = LV.selectionParts(range);\n", 'Lumiverse message selection');
    s = replaceAnchor(s, "padding:9px 13px;border:1px solid #d4c9bc", "min-height:44px;min-width:44px;padding:9px 13px;border:1px solid #d4c9bc", { name: 'selection touch size' });
    s = replaceAnchor(s, "font:600 13px sans-serif;box-shadow", "font:600 15px sans-serif;box-shadow", { name: 'selection font size' });
    s = replaceAnchor(s, '${statePaper(world, worldForm, armed)}', '${omissionNotice(world.omittedAuto)}${statePaper(world, worldForm, armed)}', { name: 'world omission counts' });
    s = replaceAnchor(s, '${conflictsPaper(conflicts, store)}', '${omissionNotice({ conflicts: conflicts?.omittedAuto })}${conflictsPaper(conflicts, store)}', { name: 'conflict omission count' });
    s = replaceAnchor(s, '  function viewWorld() {', `  function omissionNotice(counts) {
    const labels = { state: '인물 상태', places: '장소', keepsakes: '소중한 물건', conflicts: '열린 충돌' };
    const parts = Object.entries(counts || {}).filter(([, n]) => n > 0).map(([k, n]) => labels[k] + ' ' + n + '개');
    return parts.length ? '<p class="note cap-notice" role="status">자동 항목 ' + esc(parts.join(' · ')) + '는 표시 한도로 생략했습니다. 직접 고친 기록과 판단은 보존합니다.</p>' : '';
  }
  function viewWorld() {`, { name: 'Korean omission notice' });
    s = replaceAnchor(s, '<b>불러올 백업</b>:', '<p class="restore-removes">지울 파일: ${esc(d.removes?.join(", ") || "없음")}</p><b>불러올 백업</b>:', { name: 'show all removed files' });
    s = replaceAnchor(s, "바꾸기 전에 지금 상태를 안전 사본으로 한 번 남기며", "바꾸기 전에 지금 상태와 직전 안전 사본을 보관하며", { name: 'two restore snapshots' });
    // Re-entering Facts fetches fresh decisions, but an identical response must not replace
    // the rows the reader is scrolling/focusing. Idle polling does not load conflicts.
    s = replaceRange(s, '  async function loadConflicts(id) {', '  async function loadNames(id) {', `  async function loadConflicts(id) {
    let next = null;
    try {
      next = await api('GET', \`/chats/\${encodeURIComponent(id)}/conflicts\`);
    } catch {
      // Keep the original fallback: a failed conflicts route hides the banner.
    }
    if (room !== id || disposed) return false;
    const changed = conflictsRoom !== id || JSON.stringify(conflicts) !== JSON.stringify(next);
    conflicts = next;
    conflictsRoom = id;
    return changed;
  }
  async function ensureConflicts() {
    if (!needsConflicts() || !room) return;
    const id = room;
    const changed = await loadConflicts(id);
    if (!disposed && room === id && needsConflicts() && changed) render();
  }
`, 'keep unchanged conflict rows');
    // The native file control exposes browser-locale English. Keep its upload handler and
    // use a keyboard-accessible Korean button to invoke the hidden input synchronously.
    s = replaceAnchor(s, '<label>백업 파일 고르기<input type="file" id="restoreFile" accept=".json,application/json" ${busyJob ? \'disabled\' : \'\'}></label>', '<div class="buttons"><button type="button" data-act="restoreChoose" aria-controls="restoreFile" ${busyJob ? \'disabled\' : \'\'}>백업 파일 고르기</button><input type="file" id="restoreFile" accept=".json,application/json" ${busyJob ? \'disabled\' : \'\'} hidden aria-label="백업 파일"></div>', { name: 'Korean backup file button' });
    s = replaceAnchor(s, "      case 'backupDownload':", "      case 'restoreChoose':\n        root.querySelector('#restoreFile')?.click();\n        return;\n      case 'backupDownload':", { name: 'open backup file chooser' });
    // A short selection can be its own model summary. Keep every source quote, but avoid
    // printing that same text as an extra paragraph. Distinct summaries remain visible.
    s = replaceAnchor(s, '<p>${esc(x.summary)}</p>${x.parts.map', '${selectedSummaryHtml(x)}${x.parts.map', { name: 'selected summary without duplicate source' });
    s = replaceAnchor(s, '  function selectedMemoriesHtml() {', `  function selectedSummaryHtml(x) {
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const summary = normalize(x.summary);
    const parts = x.parts || [];
    if (!summary || parts.some(p => normalize(p.text) === summary) || normalize(parts.map(p => p.text).join(' ')) === summary) return '';
    return '<p>' + esc(x.summary) + '</p>';
  }
  function selectedMemoriesHtml() {`, { name: 'compare selected summary with sources' });
    // return a handle instead of installing at evaluation time
    s = replaceAnchor(s, '  install();\n  host.onCleanup?.(cleanup);\n})();', '  install();\n  host.onCleanup?.(cleanup);\n  return { toggle: () => LV.toggle(), open: () => { if (!open) LV.toggle(); }, close: closeLibrary, isOpen: () => open, dispose: cleanup, setRoom: id => { room = id; } };\n}', { name: 'iife close' });
    return s;
}
