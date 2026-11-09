// Focused browser check for two 1.2.0-lv.1 live-QA findings (see src/overrides.memory.css):
//  1. contrast >= 4.5:1 of every text node in BOTH screen themes (dark/light), including the empty state "채팅방을 선택해 주세요."
//     (the grain background-image is a translucent noise overlay, so the colour layers under it are what count; scripts/browser-qa.mjs
//     skips any element that has a background-image, which is how the dark .empty at 1.03:1 got through)
//     1b. the facts tab is seeded (qa/backend-env.mjs) with 아는 사람 / 모르는 사람 chips, and a synthetic sweep draws every nested fill that can sit on a cream card in the dark theme
//         (chips, pills, tabs, notes, panels, buttons, warnings) inside .paper / .metric / .file-index / .chapter-chip and measures them under the grain like everything else
//  2. at 1280x800 and 390x844: the bottom room switch label is not clipped, and every checkbox/switch (이름 정리·설정 tabs too)
//     has a >= 44px effective touch target (its label counts); no sideways overflow.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_BIN=/usr/bin/chromium node scripts/ui-fix-qa.mjs   (exit 1 on failure)
import { createQaServer } from './qa-server.mjs';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(e => { console.error('Playwright not found (set PLAYWRIGHT_MODULE):', e.message); process.exit(2); });
const ORIGIN = 'http://127.0.0.1';
const qa = await createQaServer(process.cwd());
const browser = await pw.chromium.launch(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {});
const failures = [], report = [];

function inPage({ phase }) {
    const root = document.querySelector('#memory-module-library')?.shadowRoot;
    if (!root) return { missing: true };
    const panel = root.querySelector('#panel');
    const parse = c => { const m = c.match(/[\d.]+/g); return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const over = (c, b) => ({ r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a), a: 1 });
    const parentOf = n => n.parentElement || (n.parentNode && n.parentNode.host) || null;
    const backOf = e => { if (e.matches('.rail-stat b')) return { r: 232, g: 226, b: 214, a: 1 }; /* number printed on the cream centre label of a drawn vinyl record (background-image, so not measurable from colours) */ const layers = []; for (let n = e; n; n = parentOf(n)) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a >= 1) break; } let b = { r: 10, g: 8, b: 18, a: 1 }; for (const c of layers.reverse()) b = over(c, b); return b; };
    const ratio = e => { const b = backOf(e); const cs = getComputedStyle(e); const c = parse(cs.color); c.a *= parseFloat(cs.opacity); const f = over(c, b); const x = lum(f), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
    const shown = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(/\s+/)[0] : '');
    const texts = [...panel.querySelectorAll('*')].filter(e => !['STYLE', 'SCRIPT', 'OPTION'].includes(e.tagName) && !e.closest('svg') && shown(e) && !e.closest('button:disabled,input:disabled,select:disabled') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
    const chain = e => { const c = []; for (let n = e; n && n !== panel && c.length < 4; n = n.parentElement) c.push(name(n)); return c.join('<'); };
    const low = texts.map(e => ({ n: chain(e) + '「' + e.textContent.trim().slice(0, 14) + '」', r: ratio(e) })).filter(x => x.r < 4.5);
    const min = texts.length ? Math.min(...texts.map(ratio)) : null;
    const empty = panel.querySelector('.empty');
    const out = { texts: texts.length, low, min, empty: empty ? { text: empty.textContent.trim().slice(0, 30), ratio: ratio(empty) } : null };
    // touch targets: a checkbox/radio counts through its <label> (or itself, whichever is bigger)
    const boxes = [...panel.querySelectorAll('input[type=checkbox],input[type=radio]')].filter(shown);
    out.small = boxes.map(i => { const l = i.closest('label'); const a = i.getBoundingClientRect(), b = l ? l.getBoundingClientRect() : a; const af = getComputedStyle(i, '::after'), ah = parseFloat(af.height) || 0, aw = parseFloat(af.width) || 0;   // the input's own hit area (its ::after grows past the drawn switch)
        const h = Math.max(a.height, b.height, ah), w = Math.max(a.width, b.width, aw); return { n: name(i), w: Math.round(w), h: Math.round(h) }; }).filter(x => x.h < 43.5 || x.w < 43.5);
    out.boxCount = boxes.length;
    const sw = root.querySelector('.room-switch');
    if (sw) {
        const sp = sw.querySelector('span'), sb = root.querySelector('.sidebar');
        out.roomSwitch = { text: sp.textContent.trim(), clipped: sp.scrollWidth > sp.clientWidth + 1 || sp.scrollHeight > sp.clientHeight + 1, ellipsis: getComputedStyle(sp).textOverflow === 'ellipsis' && sp.scrollWidth > sp.clientWidth, h: Math.round(sw.getBoundingClientRect().height), spanW: Math.round(sp.getBoundingClientRect().width), sideScrolls: sb.scrollHeight > sb.clientHeight };
        const sr = sb.getBoundingClientRect(), r = sw.getBoundingClientRect();
        out.roomSwitch.inSidebar = r.left >= sr.left - 1 && r.right <= sr.right + 1;
    }
    out.hscroll = document.documentElement.scrollWidth > innerWidth + 1;
    out.panelOverflow = [...panel.querySelectorAll('*')].filter(e => !e.closest('svg') && shown(e)).filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).length;
    return out;
}

// every nested element that paints one of the theme fills (--im-soft, --im-paper, --im-subtle, --im-selected, hover/active) inside a card, in the card kinds the dark theme re-colours (theme.orig.css:158)
const SWEEP = `<div class="paper"><h2>카드 안</h2>
  <p class="know-chips"><span class="know-label">아는 사람</span><span class="kchip is-known">하루</span><span class="kchip is-known">서아</span><span class="know-label">모르는 사람</span><span class="kchip is-unknown">미나</span></p>
  <p><span class="pill">직접 고침</span> <span class="pill neutral">중립</span> <span class="pill green">완료</span> <a href="#" class="chip">S1</a> <a href="#" class="record-link chip"><span class="chip-id">S2</span>장면 링크<span class="chip-arrow">›</span></a></p>
  <div class="overview-tabs"><button aria-selected="true">첫째</button><button aria-selected="false">둘째</button></div>
  <div class="note">참고 문구입니다.</div><p class="warn">경고 문구입니다.</p><div class="routine-row"><span class="warn">행 경고</span></div>
  <div class="organize-progress">정리 진행 중 <small>12/40</small></div>
  <div class="quote-review-panel"><h3>대사 확인</h3><p class="hint">설명 문구</p><button>확인</button></div>
  <p class="repair-summary">복구 요약 3건</p>
  <div class="conflict-pair"><div><small>기록 A</small><p>한 쪽 기록</p></div><div><small>기록 B</small><p>다른 쪽 기록</p></div></div>
  <div class="person-chips"><button class="selected">하루</button><button>서아</button></div>
  <details class="memory-details" open><summary>자세히</summary><p>본문</p></details>
  <a href="#" class="record-row"><span class="pill neutral">장면</span><span class="row-main"><b>제목</b><small>발췌 문구</small></span><span class="chip-arrow">›</span></a>
  <div class="quote-card"><small>하루 · #3.1</small><blockquote>대사입니다.</blockquote></div>
  <div class="buttons"><button class="primary">저장</button><button class="ghost">취소</button><button>보통</button></div></div>
<div class="metric"><span class="pill">3</span><small>작은 글</small><span class="kchip is-known">하루</span><span class="kchip is-unknown">서아</span></div>`;

for (const vp of [{ width: 1280, height: 800, touch: false }, { width: 390, height: 844, touch: true }]) {
    const session = `ui-fix-${vp.width}`;
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, locale: 'ko-KR', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-qa-session': session } });
    await context.route(ORIGIN + '/**', async route => { try { const rq = route.request(); const u = new URL(rq.url()); const r = await qa.handle({ method: rq.method(), pathname: u.pathname, search: u.search, session, body: rq.postData() || '' }); await route.fulfill({ status: 200, contentType: r.type, body: r.body }); } catch { await route.fulfill({ status: 404, body: '' }); } });
    const page = await context.newPage();
    page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.error('console', m.text().slice(0, 200)); });
    await page.goto(ORIGIN + '/qa/harness.html');
    await page.waitForFunction(() => window.qa?.ready, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const ev = (fn, arg) => page.evaluate(([src, a]) => new Function('root', 'arg', src)(document.querySelector('#memory-module-library')?.shadowRoot, a), [fn, arg]);
    const open = async () => { await page.evaluate(() => document.getElementById('extras-btn').click()); await page.evaluate(() => qa.clickAction('memory-open')); await page.waitForFunction(() => { const p = document.querySelector('#memory-module-library')?.shadowRoot?.querySelector('#panel'); return p && !p.hidden; }, null, { timeout: 8000 }); await page.waitForTimeout(2500); };
    const check = async (label) => {
        const m = await page.evaluate(inPage, { phase: label });
        const where = `${vp.width}px ${label}`;
        if (m.missing) { failures.push(`${where}: panel missing`); return; }
        if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/${vp.width}-${label.replace(/ /g, '-')}.png` });
        report.push(`${where}: text nodes ${m.texts}, min contrast ${m.min}${m.empty ? `, .empty「${m.empty.text}」=${m.empty.ratio}` : ''}${m.roomSwitch ? `, room-switch h=${m.roomSwitch.h} clipped=${m.roomSwitch.clipped}` : ''}${m.boxCount ? `, switches ${m.boxCount} small=${m.small.length}` : ''}`);
        if (m.low.length) failures.push(`${where}: contrast<4.5 x${m.low.length} (${m.low.slice(0, 6).map(x => x.n + '=' + x.r).join(' | ')})`);
        if (m.small.length) failures.push(`${where}: touch<44 x${m.small.length} (${m.small.slice(0, 4).map(x => `${x.n} ${x.w}x${x.h}`).join(' | ')})`);
        if (m.roomSwitch && (m.roomSwitch.clipped || m.roomSwitch.ellipsis || !m.roomSwitch.inSidebar)) failures.push(`${where}: room switch label clipped ${JSON.stringify(m.roomSwitch)}`);
        if (m.hscroll || m.panelOverflow) failures.push(`${where}: horizontal overflow x${m.panelOverflow}`);
    };
    const themed = async ui => { if ((await ev('return root.host.getAttribute("data-theme")')) !== ui) { await ev('root.querySelector("#themeToggle").click()'); await page.waitForTimeout(200); } };
    await open();
    // the harness always has a room, so the empty state is drawn with the screen's own markup (runtime.orig.js: <div class="empty">채팅방을 선택해 주세요. …</div>),
    // once on the bare table and once inside a paper card, which are the two places .empty is used
    for (const ui of ['dark', 'light']) {
        await themed(ui);
        await ev('root.querySelector("#content").innerHTML = \'<div class="empty">채팅방을 선택해 주세요. 루미버스에서 채팅방을 열면 그 방이 먼저 표시됩니다.</div><div class="paper"><div class="empty">아직 기록이 없습니다.</div></div>\'');
        await check(`${ui} empty-state`);
    }
    for (const ui of ['dark', 'light']) {
        await themed(ui);
        await ev('root.querySelector("#content").innerHTML = arg', SWEEP);
        await check(`${ui} card-sweep`);
        // the chips of the seeded facts tab are measured by the tab loop below; here the three kinds must also be exactly what the sweep drew
        const kinds = await ev('return [...root.querySelectorAll("#content .kchip")].map(e => e.className.replace("kchip ", "")).join(",")');
        if (kinds !== 'is-known,is-known,is-unknown,is-known,is-unknown') failures.push(`${vp.width}px ${ui} card-sweep: kchips ${kinds}`);
    }
    await ev('root.querySelector("#close").click()'); await page.waitForTimeout(200);
    await open();
    for (const ui of ['dark', 'light']) {
        await themed(ui);
        for (const t of ['home', 'scenes', 'search', 'facts', 'ledger', 'life', 'names', 'world', 'inject', 'settings']) {
            if (!(await ev('const b = root.querySelector(arg); if (!b) return false; b.click(); return true;', `button[data-tab="${t}"]`))) { failures.push(`${vp.width}px missing tab ${t}`); continue; }
            await page.waitForTimeout(500);
            await check(`${ui} ${t}`);
            if (t === 'facts') {
                const chips = await ev('return { known: root.querySelectorAll("#content .kchip.is-known").length, unknown: root.querySelectorAll("#content .kchip.is-unknown").length, facts: root.querySelectorAll("#content .fact-row").length }');
                if (chips.known < 2 || chips.unknown < 1 || chips.facts < 2) failures.push(`${vp.width}px ${ui} facts: seed has no chips/facts to measure ${JSON.stringify(chips)}`);
                report.push(`${vp.width}px ${ui} facts: ${chips.facts} facts, ${chips.known} 아는 사람 chips, ${chips.unknown} 모르는 사람 chips`);
            }
        }
    }
    await context.close();
}
await browser.close();
console.log(report.join('\n'));
if (failures.length) { console.error('FAIL\n' + failures.join('\n')); process.exit(1); }
console.log('ui-fix-qa ok');
