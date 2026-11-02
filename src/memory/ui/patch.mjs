// Turns the unmodified 기억 서재 screen (runtime.orig.js, an IIFE that installs a launcher + shadow-DOM panel into Marinara's page)
// into `export function mountMemory(marinara, LV)`: same screen, same routes (served by src/memory/routes.js through the shim).
// Patch points are anchors that must match exactly once (src/patch-util.mjs). Only what must differ on Lumiverse is changed:
// the transport (fetch -> LV.fetch), the active chat, where the panel is attached, the launcher (removed), the Marinara-only
// speaker-tag switch (removed), Marinara wording, and "choose a connection / recall option = saved at once" (AGENTS 2).
import { createHash } from 'node:crypto';
import { replaceAnchor } from '../../patch-util.mjs';

export const RUNTIME_SHA256 = 'b056fc057f258b4d7ccc892340724ffbd62dd095dd14fb13a5dab80fb3d5700d';

export function patchMemory({ runtime, uiCss, themeCss, version }) {
    const sha = createHash('sha256').update(runtime).digest('hex');
    if (sha !== RUNTIME_SHA256) throw new Error(`memory screen original changed: sha256 ${sha} != pinned ${RUNTIME_SHA256}`);
    let s = runtime;
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
    s = replaceAnchor(s, '<select id="setConnection">${connections.map(', '<select id="setConnection"><option value="" ${current ? \'\' : \'selected\'} disabled>— 연결을 고르세요 —</option>${connections.map(', { name: 'connection placeholder' });
    s = replaceAnchor(s, "      if (e.target.id === 'setTags') {\n        const on = e.target.checked;\n        void act(() => api('POST', `/chats/${encodeURIComponent(room)}/speaker-tags`, { on }), on ? '말풍선 태그 되살리기를 켰습니다.' : '말풍선 태그 되살리기를 껐습니다.');\n      }\n", `      if (['setWriteLang', 'setMemLang', 'setTrConn', 'setTrQuotes'].includes(e.target.id)) { void handle('saveLanguage'); return; }
      const instant = { setConnection: ['/settings', 'connection', '기억 정리에 쓸 연결을 저장했습니다.'], setRecall: ['/settings/recall', 'mode', '회상 방식을 저장했습니다.'], setRecallAmount: ['/settings/recall-amount', 'amount', '회상 양을 저장했습니다.'], setChapterLength: ['/settings/chapter-length', 'length', '지난 이야기 흐름 길이를 저장했습니다.'], setRecallStyle: ['/settings/recall-style', 'style', '기억을 드러내는 정도를 저장했습니다.'] }[e.target.id];
      if (instant && e.target.value) {
        const value = e.target.value;
        void act(async () => { await api('POST', instant[0], { [instant[1]]: value }); serverSettings = (await api('GET', '/status')).settings; }, instant[2]);
      }
`, { name: 'instant save' });
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
    // return a handle instead of installing at evaluation time
    s = replaceAnchor(s, '  install();\n  host.onCleanup?.(cleanup);\n})();', '  install();\n  host.onCleanup?.(cleanup);\n  return { toggle: () => LV.toggle(), open: () => { if (!open) LV.toggle(); }, close: closeLibrary, isOpen: () => open, dispose: cleanup, setRoom: id => { room = id; } };\n}', { name: 'iife close' });
    return s;
}
