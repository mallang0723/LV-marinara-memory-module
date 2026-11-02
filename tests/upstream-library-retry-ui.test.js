// Port of upstream test-library-retry-ui.cjs against the patched Lumiverse runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patchMemory } from '../src/memory/ui/patch.mjs';
const readUI = name => fs.readFileSync(new URL('../src/memory/ui/' + name, import.meta.url), 'utf8');
const runtime = patchMemory({ runtime: readUI('runtime.orig.js'), uiCss: readUI('ui.orig.css'), themeCss: readUI('theme.orig.css'), version: 'test' }).replace('export function mountMemory', 'function mountMemory');
import S from '../src/memory/core/scenes.cjs';
import { upstreamHarness } from './upstream-harness.js';
const { service } = await upstreamHarness(['room']);
const X = service._test;
class Element {
  constructor() { this.dataset = {}; this.style = { removeProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} }; this.listeners = {}; this.hidden = false; this.scrollTop = 0; this.offsetParent = null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  setAttribute(k, v) { this[k] = v; }
  remove() {}
  append() {}
  focus() {}
  click() { const e = { target: this, stopImmediatePropagation() {}, preventDefault() {} }; for (const f of this.listeners.click || []) f(e); this.onclick?.(e); }
}
class Shadow extends Element {
  constructor(host) { super(); this.host = host; this.nodes = new Map(); }
  querySelector(s) { if (!s.startsWith('#')) return null; if (!this.nodes.has(s)) this.nodes.set(s, new Element()); return this.nodes.get(s); }
  querySelectorAll() { return []; }
}

test('Lumiverse open action, visible error, retry, and close use the real extension and translation routes', async (t) => {
  let modelCalls = 0;
  let release;
  const model = { chatComplete: async (messages) => {
    const lines = JSON.parse(messages[1].content).lines;
    modelCalls++;
    if (modelCalls === 2) throw Error('연결 끊김 테스트');
    if (modelCalls === 3) await new Promise((resolve) => { release = resolve; });
    return { content: JSON.stringify({ lines: lines.map((x) => `번역 ${x}`) }) };
  } };
  X.setEngine({ connections: { list: async () => [{ id: 'm', name: 'm' }], getWithKey: async () => ({ model: 'fake' }) }, resolveBaseUrl: () => 'http://fake', createLLMProvider: () => model });
  X.saveSettings({ connection: 'm', writeLanguage: 'en', chats: { room: { enabled: true } } });
  X.chatLangs.set('room', 'en');
  const store = S.emptyStore();
  store.facts = Array.from({ length: 45 }, (_, i) => ({ id: `F${i}`, text: `This is English memory number ${i}.` }));
  X.saveScenes('room', store);
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((m) => [m, (url, fn) => routes.set(`${m.toUpperCase()} ${url}`, fn)]));
  service.attach({ register: (fn) => fn(app), addHook() {} });
  const call = async (method, route) => routes.get(`${method} ${route}`)({ params: { id: 'room' }, body: {} }, { status() { return this; }, send(v) { return v; } });
  const elements = new Map();
  const document = {
    createElement() { const e = new Element(); e.attachShadow = () => (e.shadowRoot = new Shadow(e)); return e; },
    getElementById(id) { return elements.get(id) || null; },
    body: { append(e) { elements.set(e.id, e); } }, head: { append(e) { elements.set(e.id, e); } },
    addEventListener() {}, removeEventListener() {},
  };
  let cleanup;
  t.after(() => cleanup?.());
  const info = { enabled: true, threads: [], scenes: { count: 0 }, job: { state: 'idle' }, sceneJob: { state: 'idle' }, chatLang: 'en' };
  const fetch = async (url, init) => {
    let data;
    if (url.endsWith('/translations/retry')) data = await call('POST', '/chats/:id/translations/retry');
    else if (url.endsWith('/translations')) data = await call('GET', '/chats/:id/translations');
    else if (url.endsWith('/chats')) data = [{ id: 'room', name: '시험 방', enabled: true }];
    else data = info;
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  const storage = { getItem: (k) => k === 'marinara-active-chat-id' ? 'room' : null, setItem() {}, removeItem() {} };
  const window = { matchMedia: () => ({ matches: false }), dispatchEvent() {} };
  const context = { window, document, fetch, localStorage: storage, marinara: { onCleanup: (fn) => { cleanup = fn; } }, addEventListener() {}, CustomEvent: class {}, setTimeout, clearTimeout, innerWidth: 390, innerHeight: 844, console };
  context.LV = { fetch, activeChatId: () => 'room', mountHost: element => document.body.append(element), css: '' };
  vm.runInNewContext(runtime + '\nmountMemory(marinara, LV);', context);
  const root = elements.get('memory-module-library').shadowRoot;
  const launcher = { click: () => context.LV.toggle() };
  assert.equal(elements.has('memory-module-launcher'), false);
  launcher.click();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  for (let i = 0; i < 100 && !root.querySelector('#content').innerHTML?.includes('연결 끊김 테스트'); i++) {
    await tick();
    // Poll callback in the real extension runs every 10s. Reopening exercises its refresh without waiting.
    if (i === 3) { root.querySelector('#close').onclick(); launcher.click(); }
  }
  const content = root.querySelector('#content');
  assert.match(content.innerHTML, /한국어 번역을 마치지 못했습니다/);
  assert.match(content.innerHTML, /연결 끊김 테스트/);
  assert.match(content.innerHTML, /남은 항목: 5개/);
  assert.match(content.innerHTML, /data-act="retryTranslation"/);
  const button = { dataset: { act: 'retryTranslation' }, closest: (s) => s === 'button' ? button : null };
  for (const fn of root.listeners.click) fn({ target: button });
  for (let i = 0; i < 100 && !release; i++) await tick();
  assert.ok(release, 'retry actually reaches the translation model');
  release();
  for (let i = 0; i < 100 && X.translationLookup('room', 'ko')('This is English memory number 44.') == null; i++) await tick();
  assert.ok(X.translationLookup('room', 'ko')('This is English memory number 44.'));
  root.querySelector('#close').onclick();
  assert.equal(root.querySelector('#panel').hidden, true);
  launcher.click();
  for (let i = 0; i < 100 && content.innerHTML.includes('남은 항목: 5개'); i++) await tick();
  assert.doesNotMatch(content.innerHTML, /한국어 번역을 마치지 못했습니다/);
  assert.doesNotMatch(content.innerHTML, /남은 항목: 5개/);
  root.querySelector('#close').onclick();
  assert.equal(root.querySelector('#panel').hidden, true);
});

test('room changes reject stale translation success/errors, including A → B → A, and failures keep current notes', async () => {
  const elements = new Map();
  const document = {
    createElement() { const e = new Element(); e.attachShadow = () => (e.shadowRoot = new Shadow(e)); return e; },
    getElementById: id => elements.get(id) || null,
    body: { append(e) { elements.set(e.id, e); } },
    addEventListener() {}, removeEventListener() {},
  };
  const pending = [];
  const context = {
    window: { matchMedia: () => ({ matches: false }), dispatchEvent() {} }, document,
    localStorage: { getItem() { return null; }, setItem() {} },
    marinara: {}, addEventListener() {}, CustomEvent: class {}, setTimeout, clearTimeout,
    LV: { activeChatId: () => 'a', mountHost: element => document.body.append(element), css: '',
      fetch: (url) => url.endsWith('/translations') ? new Promise((resolve, reject) => pending.push({ resolve: data => resolve({ ok: true, text: async () => JSON.stringify(data) }), reject })) : Promise.resolve({ ok: true, text: async () => '{}' }) },
  };
  // Expose the real functions only in this test copy, so deferred responses can be ordered deterministically.
  const exposed = runtime.replace('  install();\n  host.onCleanup?.(cleanup);', `
    LV.test = { loadRoom, loadTranslations, state: () => ({ trMap, trError, trPending, trWorking }), room: id => { room = id; } };
    install();
    host.onCleanup?.(cleanup);`);
  vm.runInNewContext(exposed + '\nmountMemory(marinara, LV);', context);
  const x = context.LV.test;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  x.room('a'); const oldA = x.loadRoom('a'); await tick();
  x.room('b'); const b = x.loadRoom('b'); await tick();
  pending[1].resolve({ items: { same: '방 B 번역' }, missing: 0 }); await b;
  pending[0].resolve({ items: { same: '오래된 A 번역' }, missing: 7, error: '오래된 오류' }); await oldA;
  assert.equal(x.state().trMap.same, '방 B 번역');
  assert.equal(x.state().trError, '');
  x.room('a'); const firstA = x.loadRoom('a'); await tick();
  x.room('b'); const secondB = x.loadRoom('b'); await tick();
  x.room('a'); const latestA = x.loadRoom('a'); await tick();
  pending[4].resolve({ items: { same: '최신 A 번역' }, missing: 0 }); await latestA;
  pending[2].reject(Error('지난 A 오류')); await firstA;
  pending[3].resolve({ items: { same: '지난 B 번역' } }); await secondB;
  assert.equal(x.state().trMap.same, '최신 A 번역');
  assert.equal(x.state().trError, '');
  const failure = x.loadRoom('a'); await tick();
  pending[5].reject(Error('연결 실패')); await failure;
  assert.equal(x.state().trMap.same, '최신 A 번역', 'current-room notes survive a fetch failure');
  assert.match(x.state().trError, /루미버스 서버에 연결하지 못했습니다/);
});
