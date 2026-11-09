// Static guard for the 1.2.0-lv.1 live-QA contrast / touch fixes in src/overrides.memory.css. The browser-measured version
// (computed styles, both themes, every tab, 1280x800 and 390x844) is `npm run qa:ui-fix`; this one needs no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/overrides.memory.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/memory/ui/theme.orig.css', import.meta.url), 'utf8');
const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the pinned original still has the rule pair that made the dark empty state 1.03:1 (so the override is still needed)', () => {
    assert.match(theme, /:host\(\[data-theme=dark\]\) :is\(\.paper,\.metric,\.empty,\.file-index,\.chapter-chip\)\{/);
    assert.match(theme, /\.empty\{[^}]*background:transparent!important/);
    assert.match(theme, /--im-line:#15151526[^}]*color:#151515\}/);   // the rule paints .empty text #151515 ...
    assert.ok(ratio('#151515', '#121212') < 1.5, '... on the #121212 table');
});

test('dark empty state: light text on the table, dark muted text inside paper cards, both >= 4.5:1', () => {
    assert.match(css, /:host\(\[data-theme=dark\]\) #panel \.empty\{color:#c9c3b7!important\}/);
    assert.match(css, /:host\(\[data-theme=dark\]\) #panel :is\(\.paper,\.metric,\.file-index,\.chapter-chip\) \.empty\{color:#5f5a51!important\}/);
    assert.ok(ratio('#c9c3b7', '#121212') >= 4.5);
    assert.ok(ratio('#5f5a51', '#ece8df') >= 4.5);
});

test('the rail is dark in both themes, so its section label is light (was dark ink = 1.0:1 in the light theme)', () => {
    assert.match(css, /#panel \.sidebar \.nav-label\{color:#ece8df!important/);
    assert.ok(ratio('#d9d5cd', '#151515') >= 4.5);   // #ece8df at opacity .85 over the rail blends to about #d9d5cd (measured 10.96:1)
});

test('switches get a >= 44px hit area and the room switch label wraps and stays pinned on desktop', () => {
    assert.match(css, /input\[type=checkbox\]:after\{[^}]*inset:-13px -8px/);   // 22px + 26px = 48px tall, 38px + 16px = 54px wide
    assert.match(css, /#panel \.room-switch span\{[^}]*white-space:normal!important/);
    assert.match(css, /\.sidebar \.room-switch\{position:sticky;bottom:0/);
    assert.match(css, /\.chip-arrow\{opacity:1!important\}/);
});

test('live QA A: the pinned original still paints dark chips on dark-theme cards with the card ink (so the card-chip override is still needed)', () => {
    const ui = readFileSync(new URL('../src/memory/ui/ui.orig.css', import.meta.url), 'utf8');
    assert.match(ui, /\.kchip\{[^}]*background:var\(--im-soft\)[^}]*\}/);
    assert.doesNotMatch(ui.match(/\.kchip\{[^}]*\}/)[0], /color:/);                    // no colour of its own: inherits .paper's #151515
    assert.match(theme, /--im-soft:#2a2826/);                                          // the dark fill
    assert.ok(ratio('#151515', '#2a2826') < 1.5);                                      // 1.24:1 as measured (under the grain)
    assert.doesNotMatch(theme.match(/:host\(\[data-theme=dark\]\) :is\(\.paper[^}]*\}/)[0], /--im-soft/);   // the card scope never re-defined it
});

test('live QA A: every fill that can sit on a dark-theme card takes the light fills, so the card ink/muted text keep >= 4.5:1', () => {
    const rule = css.match(/:host\(\[data-theme=dark\]\) #panel :is\(\.paper,\.metric,\.file-index,\.chapter-chip\) :is\(([^)]*)\)\{([^}]*)\}/);
    assert.ok(rule, 'card-fill rule');
    for (const sel of ['.kchip', '.overview-tabs', '.organize-progress', '.quote-review-panel', '.repair-summary', '.conflict-pair>div', 'a.record-row', '.timeline-card', '.memory-details>summary:hover']) assert.ok(rule[1].split(',').includes(sel), sel);
    assert.match(rule[2], /--im-soft:#e4dfd3/);
    assert.match(rule[2], /color:#151515/);
    assert.ok(ratio('#151515', '#e4dfd3') >= 4.5 && ratio('#151515', '#f7f4ee') >= 4.5);
    assert.ok(ratio('#5f5a51', '#e4dfd3') >= 4.5 && ratio('#5f5a51', '#e0dbcf') >= 4.5);   // --im-muted on soft / selected
    // These chips have separate foreground/background rules; do not change their inherited fills here.
    for (const keep of ['.pill', 'a.chip', '.chip-id']) assert.ok(!rule[1].split(',').includes(keep), keep);
});

test('dark chip IDs pair their own opaque fill and ink on the table and all cream-card contexts', () => {
    const ui = readFileSync(new URL('../src/memory/ui/ui.orig.css', import.meta.url), 'utf8');
    assert.match(ui, /\.chip-id\{[^}]*background:var\(--im-paper\)/);
    assert.match(theme, /--t-paper:#1b1a18/);
    assert.ok(ratio('#37354a', '#1b1a18') < 4.5, 'fix2 ink on the original dark chip fill fails');
    const selectors = [
        ':host([data-theme=dark]) #panel .chip-id',
        ':host([data-theme=dark]) #panel :is(.paper,.metric,.file-index,.chapter-chip) .chip-id',
    ];
    for (const selector of selectors) {
        const rule = css.split(selector + '{')[1]?.split('}')[0];
        assert.ok(rule, selector);
        const ink = rule.match(/(?:^|;)color:(#[\da-f]{6})!important(?:;|$)/)?.[1];
        const fill = rule.match(/(?:^|;)background:(#[\da-f]{6})!important(?:;|$)/)?.[1];
        assert.ok(ink && fill, 'both colours must be explicit and override original selected/hover styles');
        assert.ok(ratio(ink, fill) >= 4.5, `${selector}: ${ratio(ink, fill)}`);
    }
    assert.match(css, /#panel \.record-link \.chip-id\{color:#37354a!important;opacity:1!important\}/, 'light rule remains unchanged');
});

test('browser contrast measurement starts at the text element, including the chip own fill', () => {
    const qa = readFileSync(new URL('../scripts/ui-fix-qa.mjs', import.meta.url), 'utf8');
    assert.match(qa, /for \(let n = e; n; n = parentOf\(n\)\)/);
    assert.match(qa, /getComputedStyle\(n\)\.backgroundColor/);
    assert.match(qa, /if \(c && c\.a >= 1\) break/);
    assert.match(qa, /const ratio = e => \{ const b = backOf\(e\)/);
    assert.match(qa, /class="record-link chip"><span class="chip-id">S2<\/span>/);
});

test('live QA A: warning orange is dark on cream (>= 4.5:1 on paper and soft fills) and light only on the dark table', () => {
    assert.match(css, /#panel :is\(\.warn,\.routine-row \.warn,\.kchip\.is-unknown\)\{color:#8f4524!important\}/);
    assert.match(css, /:host\(\[data-theme=dark\]\) #panel :is\(\.warn,\.routine-row \.warn,\.kchip\.is-unknown\)\{color:#ffb08a!important\}/);
    assert.match(css, /:is\(\.paper,\.metric,\.file-index,\.chapter-chip\) :is\(\.warn,\.routine-row \.warn,\.kchip\.is-unknown\)\{color:#8f4524!important\}/);
    for (const bg of ['#e4dfd3', '#ece8df', '#f7f4ee']) assert.ok(ratio('#8f4524', bg) >= 4.5, bg);
    assert.ok(ratio('#b0623f', '#e4dfd3') < 4.5);                                      // the original orange on the soft chip (3.39:1)
    assert.ok(ratio('#ffb08a', '#121212') >= 4.5);
});

test('the browser QA covers seeded facts chips and the card sweep in both themes', () => {
    const qa = readFileSync(new URL('../scripts/ui-fix-qa.mjs', import.meta.url), 'utf8');
    const seed = readFileSync(new URL('../qa/backend-env.mjs', import.meta.url), 'utf8');
    assert.match(seed, /knownBy: \['하루', '서아'\]/);
    assert.match(seed, /unaware: \['서아'\]/);
    for (const needle of ['kchip is-known', 'kchip is-unknown', 'card-sweep', 'overview-tabs', 'quote-review-panel', 'seed has no chips/facts to measure']) assert.ok(qa.includes(needle), needle);
});
