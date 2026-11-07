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
