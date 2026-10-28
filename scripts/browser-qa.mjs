// Browser QA of the built extension (dist/frontend.js) against stand-ins for the Lumiverse drawer / Extras / events
// (qa/harness.html) and the real backend entry on the fake Spindle host (qa/backend-env.mjs, no model, no network).
// Firefox and Chromium; 360x460 (touch), 360x740 (touch), 1280x800; two origins:
//  - "insecure": http://qa.test (served through page.route): a non-loopback http origin is NOT a secure context, so
//    crypto.randomUUID / crypto.subtle / navigator.clipboard / navigator.share are missing exactly as on a phone over plain http,
//  - "secure": http://127.0.0.1:<random port> (a secure context).
// `npm run qa:insecure` runs only the insecure origin. Host themes: a dark and a light one of qa/host-themes.json; the screens'
// own light/dark switches are driven too. Per view: horizontal overflow, text >= 15px (secondary >= 13px), tap targets >= 44px,
// text contrast >= 4.5:1 on what is actually behind it, no scroll box other than the screens' own main scroller, no request
// leaving the page (only the harness files and the stand-in channel), no console errors.
// Tools are not dependencies: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs, FIREFOX_BIN, CHROMIUM_BIN. Port 0 = random.
// Screenshots go to QA_SHOT_DIR (default <os tmpdir>/memory-library-lv-qa), outside the repo.
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createQaServer } from './qa-server.mjs';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(e => { console.error('Playwright not found (set PLAYWRIGHT_MODULE):', e.message); process.exit(2); });
const only = (process.env.QA_ONLY || '').split(',').filter(Boolean);                       // e.g. insecure or firefox-360x460-secure
const originsWanted = (process.env.QA_ORIGINS || '').split(',').filter(Boolean);
const shotDir = process.env.QA_SHOT_DIR || path.join(os.tmpdir(), 'memory-library-lv-qa');
const VIEWPORTS = [{ width: 360, height: 460, touch: true }, { width: 360, height: 740, touch: true }, { width: 390, height: 844, touch: true }, { width: 1280, height: 800, touch: false }];
const HOST_THEMES = ['default-dark', 'lumiverse-light'];
const parts = (process.env.QA_PARTS || 'drawer,memory,guard').split(',');
const innerWidthOf = vp => vp.width;
const root = process.cwd();
const qa = await createQaServer(root);
const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    try {
        const r = await qa.handle({ method: req.method, pathname: new URL(req.url, 'http://x').pathname, search: new URL(req.url, 'http://x').search, session: req.headers['x-qa-session'] || 'default', body });
        res.setHeader('Content-Type', r.type); res.end(r.body);
    } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ORIGINS = { secure: `http://127.0.0.1:${port}/qa/harness.html`, insecure: 'http://qa.test/qa/harness.html' };
const browsers = [['firefox', pw.firefox, process.env.FIREFOX_BIN || undefined], ['chromium', pw.chromium, process.env.CHROMIUM_BIN || undefined]];
const failures = [], rows = [], envRows = [], notes = [];

// ---------- in-page measurement ----------
function measure({ target, secondarySel, mainScrollers }) {
    const rootOf = key => {
        if (key === 'memory') return document.querySelector('#memory-module-library')?.shadowRoot;
        return qa.drawerRoot(key.replace('drawer-', ''));
    };
    const panel = rootOf(target);
    if (!panel) return { missing: true };
    const shown = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
    const cn = e => { const cls = [...e.classList].slice(0, 3).join('.'); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : ''); };
    const name = e => { let n = cn(e); if (!e.classList.length && e.parentElement) n += '<' + cn(e.parentElement); return n + (e.textContent.trim() ? '「' + e.textContent.trim().slice(0, 12) + '」' : ''); };
    const all = [...panel.querySelectorAll('*')].filter(e => !['STYLE', 'SCRIPT', 'TEMPLATE'].includes(e.tagName) && shown(e));
    const vw = innerWidth;
    const overflow = all.filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).filter(e => !e.closest('svg')).slice(0, 5).map(name);
    const hscroll = document.documentElement.scrollWidth > innerWidth + 1;
    const parse = c => { const m = c.match(/[\d.]+/g); return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const over = (c, b) => ({ r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a), a: 1 });
    const parentOf = n => n.parentElement || (n.parentNode && n.parentNode.host) || null;
    const backOf = e => { const layers = []; for (let n = e; n; n = parentOf(n)) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a >= 1) break; } let b = parse(getComputedStyle(document.documentElement).getPropertyValue('--lumiverse-bg-deep')) || { r: 10, g: 8, b: 18, a: 1 }; b.a = 1; for (const c of layers.reverse()) b = over(c, b); return b; };
    const ratio = e => { const b = backOf(e); if (!b) return 21; const c = over(parse(getComputedStyle(e).color), b), x = lum(c), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
    const inactive = e => !!e.closest('button:disabled, textarea:disabled, select:disabled, input:disabled, [aria-disabled="true"]');
    const texts = all.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.closest('svg') && !e.closest('option'));
    const isSecondary = e => !!e.closest(secondarySel);
    const fonts = texts.map(e => ({ e, size: parseFloat(getComputedStyle(e).fontSize), secondary: isSecondary(e) }));
    const smallPrimary = fonts.filter(x => !x.secondary && x.size < 14.95), smallSecondary = fonts.filter(x => x.secondary && x.size < 12.95);
    const lowContrast = texts.filter(e => !inactive(e)).map(e => ({ e, r: ratio(e) })).filter(x => x.r < 4.5);
    const fields = [...panel.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), textarea, select')].filter(shown);
    const smallFieldText = fields.filter(e => parseFloat(getComputedStyle(e).fontSize) < 14.95).map(e => ({ e, size: parseFloat(getComputedStyle(e).fontSize) }));
    const tapSize = e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); };
    const tapTargets = [...panel.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), textarea, summary, a[href], [role=button]')].filter(shown).filter(e => !inactive(e) && !e.closest('svg'));
    const checks = [...panel.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(shown).map(e => e.closest('label') || e);
    const taps = [...new Set([...tapTargets, ...checks])];
    const shortTaps = taps.filter(e => tapSize(e) < 43.5);
    const isScroller = e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.tagName !== 'TEXTAREA' && e.tagName !== 'SELECT' && !e.closest('svg');
    const scrollers = all.filter(isScroller).filter(e => !mainScrollers.some(s => e.matches(s)));
    const fmt = (list, k) => list.slice(0, 5).map(x => name(x.e || x) + '=' + Math.round((k ? x[k] : tapSize(x.e || x)) * 10) / 10);
    return {
        overflow, hscroll, scrollers: scrollers.map(name).slice(0, 5),
        smallPrimary: smallPrimary.length, smallSecondary: smallSecondary.length, smallField: smallFieldText.length, shortTaps: shortTaps.length, lowContrast: lowContrast.length,
        examples: { primary: fmt(smallPrimary, 'size'), secondary: fmt(smallSecondary, 'size'), field: fmt(smallFieldText, 'size'), taps: fmt(shortTaps), contrast: fmt(lowContrast, 'r') },
        counts: { texts: texts.length, taps: taps.length },
    };
}
const SECONDARY = 'small, sup, time, .hint, .muted, .eyebrow, [class*="meta"], [class*="hint"], [class*="foot"], [class*="stamp"], [class*="clock"], .num, .cno, .ct, .nk, .no-c, .pv, .imgic, .bm-room, .badge, [class*="badge"], .am-hint, .am-stat, .launch-sub, .brand small, .nav-label, .side-bottom small, .rail-note p, em, .dcat, .cm, .file-code, .file-range, .file-spine, .chip-id, .event-no, .pill, .editor-number, .stamp, .count, .metric small, .metric span';
const MAIN_SCROLLERS = { memory: ['#content', '.inspector', '.sidebar'], 'drawer-memory': [] };

try {
    await mkdir(shotDir, { recursive: true });
    const variants = [];
    for (const [bname, type, exe] of browsers) for (const oname of Object.keys(ORIGINS)) for (const vp of VIEWPORTS) variants.push({ bname, type, exe, oname, vp });
    const launched = new Map();
    for (const { bname, type, exe, oname, vp } of variants) {
        const tag = `${bname}-${vp.width}x${vp.height}-${oname}`;
        if (originsWanted.length && !originsWanted.includes(oname)) continue;
        if (only.length && !only.some(o => tag.includes(o))) continue;
        if (!launched.has(bname)) {
            try { launched.set(bname, await type.launch(exe ? { executablePath: exe } : {})); } catch (e) { failures.push(`${bname}: launch failed ${e.message.split('\n')[0]}`); launched.set(bname, null); }
        }
        const browser = launched.get(bname);
        if (!browser) continue;
        const session = `s-${tag}`;
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, ...(bname === 'chromium' && vp.touch ? { isMobile: true, deviceScaleFactor: 2 } : {}), locale: 'ko-KR', permissions: [], reducedMotion: 'reduce', extraHTTPHeaders: { 'x-qa-session': session } });
        if (oname === 'insecure') {
            await context.route('http://qa.test/**', async route => {
                try { const rq = route.request(); const r = await qa.handle({ method: rq.method(), pathname: new URL(rq.url()).pathname, search: new URL(rq.url()).search, session, body: rq.postData() || '' }); await route.fulfill({ status: 200, contentType: r.type, body: r.body }); } catch { await route.fulfill({ status: 404, body: '' }); }
            });
        }
        const page = await context.newPage();
        const errors = [], outside = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text() + ' ' + (m.location()?.url || '')); });
        const origin = new URL(ORIGINS[oname]).origin;
        page.on('request', r => { const u = r.url(); if (u.startsWith('data:') || u.startsWith('blob:')) return; if (!u.startsWith(origin + '/')) outside.push(u); else { const p = new URL(u).pathname; if (!/^\/(qa|dist)\//.test(p) || /\/api\//.test(p)) outside.push(u); } });
        await page.goto(ORIGINS[oname]);
        await page.waitForFunction(() => window.qa?.ready, null, { timeout: 20000 });
        await page.waitForTimeout(700);
        const sleep = ms => page.waitForTimeout(ms);
        const step = async (label, fn) => { try { await fn(); } catch (e) { failures.push(`${tag} ${label}: ${e.message.split('\n')[0]}`); await page.screenshot({ path: path.join(shotDir, `FAIL-${tag}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.png`) }).catch(() => {}); } };
        let hostTheme = HOST_THEMES[0];
        const check = async (view, target) => {
            const m = await page.evaluate(measure, { target, secondarySel: SECONDARY, mainScrollers: MAIN_SCROLLERS[target] });
            if (m.missing) { failures.push(`${tag} ${view}: ${target} root missing`); return null; }
            const file = path.join(shotDir, `${tag}-${hostTheme}-${view}.png`);
            await page.screenshot({ path: file });
            rows.push({ tag, theme: hostTheme, view, ...m });
            const where = `${tag} [${hostTheme}] ${view}`;
            if (m.overflow.length || m.hscroll) failures.push(`${where}: horizontal overflow ${m.overflow.join(' | ')}${m.hscroll ? ' (page scrolls sideways)' : ''}`);
            if (m.scrollers.length) failures.push(`${where}: extra scroll boxes ${m.scrollers.join(', ')}`);
            if (m.smallPrimary || m.smallSecondary || m.smallField) failures.push(`${where}: text<15 x${m.smallPrimary} (${m.examples.primary.join(' | ')}) meta<13 x${m.smallSecondary} (${m.examples.secondary.join(' | ')}) field<15 x${m.smallField} (${m.examples.field.join(' | ')})`);
            if (m.shortTaps) failures.push(`${where}: tap<44 x${m.shortTaps} (${m.examples.taps.join(' | ')})`);
            if (m.lowContrast) failures.push(`${where}: contrast<4.5 x${m.lowContrast} (${m.examples.contrast.join(' | ')})`);
            return m;
        };
        const setHost = async name => { hostTheme = name; await page.evaluate(n => qa.setTheme(n), name); await sleep(120); };
        const evalIn = (key, fn, arg) => page.evaluate(([k, src, a]) => { const r = document.querySelector('#memory-module-library')?.shadowRoot; return new Function('root', 'arg', src)(r, a); }, [key, fn, arg]);
        const click = async (key, sel, label) => { const ok = await evalIn(key, 'const b = root.querySelector(arg); if (!b) return false; b.scrollIntoView({block:"center"}); b.click(); return true;', sel); if (!ok) throw Error('missing ' + (label || sel)); await sleep(250); };

        await step('environment', async () => {
            const env = await page.evaluate(() => qa.env());
            envRows.push({ tag, ...env });
            if (oname === 'insecure' && (env.secure !== false || env.randomUUID !== 'undefined' || env.clipboard !== 'undefined' || env.subtle !== 'undefined' || env.share !== 'undefined')) throw Error('not an insecure context: ' + JSON.stringify(env));
            if (oname === 'secure' && env.secure !== true) throw Error('expected a secure context: ' + JSON.stringify(env));
            if (errors.length) throw Error('errors at start: ' + errors.join(' | '));
        });

        for (const theme of (parts.includes('drawer') ? HOST_THEMES : [])) {
            await setHost(theme);
            await step(`drawer tabs [${theme}]`, async () => {
                for (const id of ['memory']) {
                    await page.evaluate(i => qa.openTab(i), id);
                    await sleep(500);
                    await check(`drawer-${id}`, `drawer-${id}`);
                }
            });
        }
        await setHost('default-dark');
        if (parts.includes('drawer')) await step('drawer tabs: current chat is read on open (no onActivate first value)', async () => {
            await page.evaluate(() => qa.openTab('memory'));
            await sleep(400);
            const txt = await page.evaluate(() => qa.drawerRoot('memory').innerText);
            if (!/이 방은 기억이 (켜져|꺼져) 있어요/.test(txt)) throw Error('drawer card did not show the chat status: ' + txt.slice(0, 120));
            await page.evaluate(() => qa.switchChat('chat-none'));
            await sleep(500);
            const txt2 = await page.evaluate(() => qa.drawerRoot('memory').innerText);
            if (!/이 방은 기억이 꺼져 있어요/.test(txt2)) throw Error('chat change not reflected: ' + txt2.slice(0, 160));
            await page.evaluate(() => qa.switchChat('chat-a'));
            await sleep(500);
        });

        // ----- Extras + memory screen -----
        if (parts.includes('memory')) await step('Extras -> memory screen opens', async () => {
            await page.evaluate(() => { document.getElementById('extras-btn').click(); });
            await sleep(100);
            await page.evaluate(() => qa.clickAction('memory-open'));
            await page.waitForFunction(() => { const r = document.querySelector('#memory-module-library')?.shadowRoot; const p = r?.querySelector('#panel'); return p && !p.hidden; }, null, { timeout: 8000 });
            await sleep(900);
        });
        for (const theme of (parts.includes('memory') ? HOST_THEMES : [])) {
            await setHost(theme);
            for (const ui of ['dark', 'light']) {
                await step(`memory tabs [${theme}/${ui}]`, async () => {
                    const cur = await evalIn('memory', 'return root.host.getAttribute("data-theme")');
                    if (cur !== ui) await click('memory', '#themeToggle', 'theme toggle');
                    for (const t of ['home', 'scenes', 'search', 'facts', 'ledger', 'life', 'inject', 'settings']) {
                        await click('memory', `button[data-tab="${t}"]`, `tab ${t}`);
                        await sleep(300);
                        await check(`memory-${ui}-${t}`, 'memory');
                    }
                });
            }
        }
        if (parts.includes('memory')) await step('memory: settings saved on pick (connection / recall)', async () => {
            await click('memory', 'button[data-tab="settings"]', 'settings tab');
            await sleep(500);
            await evalIn('memory', 'const s = root.querySelector("#setRecall"); s.value = "off"; s.dispatchEvent(new Event("change", {bubbles:true}));');
            await sleep(700);
            const st = await page.evaluate(async () => (await (await fetch('./__rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frame: { requestId: 'q1', type: 'api', method: 'GET', path: 'memory-module/status' }, user: 'qa-user' }) })).json()).replies[0].data.settings.recall);
            if (st !== 'off') throw Error('recall mode not saved at once: ' + st);
        });
        if (parts.includes('memory')) await step('memory: close and reopen from the drawer', async () => {
            await click('memory', '#close', 'close');
            await sleep(200);
            await page.evaluate(() => qa.openTab('memory'));
            await sleep(200);
            await page.evaluate(() => qa.drawerRoot('memory').querySelector('button.am-btn').click());
            await page.waitForFunction(() => { const p = document.querySelector('#memory-module-library')?.shadowRoot?.querySelector('#panel'); return p && !p.hidden; }, null, { timeout: 8000 });
            await click('memory', '#close', 'close');
        });

        // ----- Ctrl+K -> backend -> frontend -----
        if (parts.includes('memory')) await step('Ctrl+K command opens the memory screen', async () => {
            await page.evaluate(async () => { await fetch('./__cmd?id=open-memory&chat=chat-a'); });
            await page.waitForFunction(() => { const p = document.querySelector('#memory-module-library')?.shadowRoot?.querySelector('#panel'); return p && !p.hidden; }, null, { timeout: 8000 });
            await sleep(400);
            await click('memory', '#close', 'close');
        });

        // ----- the way out: floating close button (phones), Android back button, Escape (desktop) -----
        if (parts.includes('guard')) {
            const OPEN = {
                memory: async () => { await page.evaluate(() => { document.getElementById('extras-btn').click(); }); await sleep(100); await page.evaluate(() => qa.clickAction('memory-open')); await page.waitForFunction(() => { const p = document.querySelector('#memory-module-library')?.shadowRoot?.querySelector('#panel'); return p && !p.hidden; }, null, { timeout: 8000 }); },
            };
            const isOpen = key => page.evaluate(() => { const r = document.querySelector('#memory-module-library')?.shadowRoot?.querySelector('#panel'); return !!r && !r.hidden; });
            const guardInfo = () => page.evaluate(() => {
                const h = document.getElementById('am-overlay-guard'); const b = h?.shadowRoot?.querySelector('button'); if (!b) return null;
                const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return { w: r.width, h: r.height, right: innerWidth - r.right, top: r.top, shown: cs.display !== 'none' && r.width > 0, hit: hit === h, label: b.getAttribute('aria-label'), bg: cs.backgroundColor, fg: cs.color, histLen: history.length };
            });
            for (const key of ['memory']) {
                for (const theme of HOST_THEMES) {
                    await setHost(theme);
                    await step(`${key} close control [${theme}]`, async () => {
                        await OPEN[key](); await sleep(500);
                        const g = await guardInfo();
                        if (vp.touch) {
                            if (!g || !g.shown) throw Error('no visible close button on a phone viewport');
                            if (g.w < 43.5 || g.h < 43.5) throw Error(`close button too small ${g.w}x${g.h}`);
                            if (g.top < 0 || g.right < 0 || g.right > 24 || g.top > 24) throw Error(`close button not in the top-right corner (top ${g.top}, right ${g.right})`);
                            if (!g.hit) throw Error('close button is covered by something (elementFromPoint misses it)');
                            await page.screenshot({ path: path.join(shotDir, `${tag}-${theme}-${key}-closer.png`) });
                            await page.mouse.click(innerWidthOf(vp) - g.right - g.w / 2, g.top + g.h / 2);
                            await sleep(400);
                            if (await isOpen(key)) throw Error('overlay still open after tapping the close button');
                            if (await guardInfo()) throw Error('close button still in the page after closing');
                            // closing leaves no stale history entry on top, and reopening works with the state kept
                            const st = await page.evaluate(() => history.state && history.state.__amOverlay);
                            if (st) throw Error('history entry of the overlay left behind: ' + st);
                            await OPEN[key](); await sleep(300);
                            if (!(await guardInfo())?.shown) throw Error('close button missing after reopening');
                            // Android back button / back gesture
                            await page.evaluate(() => history.back()); await sleep(500);
                            if (await isOpen(key)) throw Error('overlay still open after the back button');
                            if (await guardInfo()) throw Error('close button still shown after back');
                            await OPEN[key](); await sleep(300);
                            if (!(await isOpen(key))) throw Error('could not reopen after back');
                            await page.mouse.click(innerWidthOf(vp) - g.right - g.w / 2, g.top + g.h / 2); await sleep(300);
                        } else {
                            if (g && g.shown) throw Error('floating close button should be hidden on a desktop mouse viewport');
                            await page.keyboard.press('Escape'); await sleep(400);
                            if (await isOpen(key)) throw Error('Escape did not close the overlay on desktop');
                        }
                        if (await isOpen(key)) throw Error('overlay left open');
                    });
                }
            }
        }
        if (errors.length) failures.push(`${tag}: console/page errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
        if (outside.length) failures.push(`${tag}: requests that left the page: ${[...new Set(outside)].slice(0, 4).join(' | ')}`);
        await context.close();
    }
    for (const b of launched.values()) await b?.close();
} finally { server.close(); }

const summary = { ok: failures.length === 0, variants: new Set(rows.map(r => r.tag)).size, views: rows.length, failures: failures.length };
await writeFile(path.join(shotDir, 'qa-report.json'), JSON.stringify({ summary, failures, env: envRows, notes, rows: rows.map(({ examples, ...r }) => r) }, null, 1));
console.log(JSON.stringify(summary));
for (const f of failures) console.log('FAIL ' + f);
for (const n of notes) console.log('NOTE ' + n);
process.exit(failures.length ? 1 : 0);
