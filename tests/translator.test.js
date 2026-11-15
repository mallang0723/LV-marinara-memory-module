// Contract "LV-TX v1", memory side: fixtures mirror what lv-translator 0.4.0 writes (tests/fixtures/translator-contract.json, source cited inside).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fake } from './fake.js';
import { makeEnv, story } from './env.js';
import { start } from '../src/backend.js';
import { createEngine } from '../src/adapter/engine.js';
import { hashText, classifyPeer, createTranslatorLink, readPub, readGlossary, handshake } from '../src/adapter/translator.js';
import { patchMemory } from '../src/memory/ui/patch.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/translator-contract.json', import.meta.url), 'utf8'));
const PEER = 'st_translator.contract';
const clone = v => JSON.parse(JSON.stringify(v));
const withTranslator = f => f.rpcPool.peers.set(PEER, clone(FX.contract));
/** A two-message chat whose last reply carries the translator's pub for `content`. */
function chatWith(f, { pub = FX.pub, content = FX.content, chatId = 'chat-a' } = {}) {
    const rows = story(f, chatId, 4);
    const reply = rows.at(-1);
    reply.content = content; reply.swipes = [content];
    if (pub) reply.metadata = { st_translator: { v: 1, pub: clone(pub) } };
    return reply;
}
const last = async (e, id = 'chat-a') => (await e.engine.chats.listMessages(id)).at(-1);
const mk = (f, o = {}) => { const translator = createTranslatorLink(f.api, { version: '1.4.0-lv.1' }); return { translator, e: createEngine({ api: f.api, userId: 'u1', translator, ...o }) }; };

test('hash parity: same output as the translator on its shared vectors (and not the ledger sha1)', () => {
    for (const [text, want] of FX.vectors) assert.equal(hashText(text), want, JSON.stringify(text));
});

test('handshake: published as { requires: [] } with name/version, readable by any extension', () => {
    const f = fake();
    const { translator } = mk(f);
    assert.equal(translator.publish(), true);
    assert.deepEqual(f.rpcPool.policies.get('contract'), { requires: [] });
    assert.deepEqual(f.rpcPool.synced.get('contract'), handshake('1.4.0-lv.1'));
    assert.deepEqual(f.rpcPool.synced.get('contract'), { name: 'lv-tx', v: 1, ext: 'anon_memory_lv', version: '1.4.0-lv.1', provides: ['reads-pub-translation@1', 'reads-glossary@1'] });
    translator.dispose();
    assert.equal(f.rpcPool.synced.has('contract'), false);
});

test('peer classification: v1 ok, other version or foreign value incompatible, nothing readable none', async () => {
    assert.equal(classifyPeer(FX.contract), 'ok');
    assert.equal(classifyPeer({ ...FX.contract, v: 2 }), 'incompatible');
    assert.equal(classifyPeer({ name: 'other', v: 1 }), 'incompatible');
    assert.equal(classifyPeer(undefined), 'none');
    const f = fake(); const { translator } = mk(f);
    await translator.refresh(); assert.equal(translator.state(), 'none');
    withTranslator(f); await translator.refresh(true); assert.equal(translator.state(), 'ok'); assert.equal(translator.version(), '0.4.0');
    const g = fake({ noRpcPool: true }); const t2 = createTranslatorLink(g.api);
    assert.equal(t2.publish(), false); await t2.refresh(); assert.equal(t2.state(), 'none');
});

test('the peer answer is cached for 20 s (one read per window)', async () => {
    const f = fake(); withTranslator(f);
    let t = 0; const translator = createTranslatorLink(f.api, { now: () => t });
    await translator.refresh(); await translator.refresh(); t = 19_000; await translator.refresh();
    assert.equal(f.rpcPool.reads.length, 1);
    t = 21_000; await translator.refresh(); assert.equal(f.rpcPool.reads.length, 2);
});

test('valid pub: the row carries translation, translationSource and paraTranslate.map (what upstream reads off a Marinara row)', async () => {
    const f = fake({ lean: true }); withTranslator(f); chatWith(f);
    const { e } = mk(f);
    const row = await last(e);
    assert.equal(row.extra.translation, FX.pub.text);
    assert.equal(row.extra.translationSource, FX.content);
    assert.deepEqual(row.extra.paraTranslate, { map: FX.pub.paras });
});

test('upstream behaviour from the synthesised row: chatMessages tr, and quoted paragraphs are shown with the translator\'s (hand-corrected) Korean', async () => {
    const { f, inst } = makeEnv({ fakeOpts: { lean: true } });
    withTranslator(f); chatWith(f);
    await inst.preloadRoom('chat-a');
    const msgs = await inst.u.run(() => inst.svc.chatMessages('chat-a'));
    assert.equal(msgs.at(-1).tr, FX.pub.text);
    const lookup = inst.X.translationLookup('chat-a', 'ko');
    assert.equal(lookup('The lamp had gone out.'), '등불은 꺼져 있었다.');
    assert.equal(lookup('He sighed.'), '한국어(He sighed.)');
    // a curly-quoted paragraph: upstream's own normalisation (srcNorm) lands on the translator's blockKey (FX.blockKeys, same key for both quote styles)
    const quoted = '“Don’t go,” she said.';
    const { f: g, inst: gi } = makeEnv({ fakeOpts: { lean: true } });
    withTranslator(g);
    chatWith(g, { content: quoted, pub: { ...FX.pub, h: hashText(quoted), text: '“가지 마.” 그녀가 말했다.', paras: { [FX.blockKeys[quoted]]: '“가지 마.” 그녀가 말했다.' }, edited: undefined } });
    await gi.preloadRoom('chat-a');
    await gi.u.run(() => gi.svc.chatMessages('chat-a'));
    assert.equal(gi.X.translationLookup('chat-a', 'ko')('"Don\'t go," she said.'), '“가지 마.” 그녀가 말했다.');
});

test('stale pub (hash of other text), unknown pub version, empty text: ignored', async () => {
    for (const pub of [{ ...FX.pub, h: hashText('older text') }, { ...FX.pub, v: 2 }, { ...FX.pub, text: '  ' }]) {
        const f = fake({ lean: true }); withTranslator(f); chatWith(f, { pub });
        const row = await last(mk(f).e);
        assert.equal(row.extra.translation, undefined);
        assert.equal(row.extra.paraTranslate, undefined);
    }
    assert.equal(readPub(FX.content, undefined), null);
    assert.equal(readPub(FX.content, { st_translator: 'x' }), null);
});

test('only one installed: no translator, or one of another version, or no rpcPool: pub is ignored silently (no errors, no handshake read failures)', async () => {
    for (const setup of [() => {}, f => f.rpcPool.peers.set(PEER, { ...FX.contract, v: 2 }), f => f.rpcPool.peers.set(PEER, { name: 'x', v: 1 })]) {
        const f = fake({ lean: true }); setup(f); chatWith(f);
        const row = await last(mk(f).e);
        assert.equal(row.extra.translation, undefined);
    }
    const f = fake({ lean: true, noRpcPool: true }); chatWith(f);
    assert.equal((await last(createEngine({ api: f.api, userId: 'u1', translator: createTranslatorLink(f.api) }))).extra.translation, undefined);
    assert.equal((await last(createEngine({ api: f.api, userId: 'u1' }))).extra.translation, undefined);   // an engine without any link
    // translator only (memory not present) is the translator's own case: it publishes nothing and has nothing to read from us
});

test('MESSAGE_EDITED (a hand-corrected translation that rewrote the English): new content + new pub from the event payload, no re-read of the chat', async () => {
    const f = fake({ lean: true }); withTranslator(f);
    const old = chatWith(f, { content: 'The lamp was still burning.\n\nHe sighed.', pub: null });
    const { e } = mk(f);
    assert.equal((await last(e)).extra.translation, undefined);
    const reads = f.state.messageReads.length;
    // the host's event payload is the raw message: the translator's data sits in extra.spindle_metadata
    const edited = { ...clone(old), content: FX.content, swipes: [FX.content], extra: { spindle_metadata: { st_translator: { v: 1, pub: clone(FX.pub) } } } };
    e.onMessage('MESSAGE_EDITED', { chatId: 'chat-a', message: edited });
    const row = await last(e);
    assert.equal(row.content, FX.content);
    assert.equal(row.extra.translation, FX.pub.text);
    assert.deepEqual(row.extra.paraTranslate.map, FX.pub.paras);
    // content changed first, pub follows in a second event: until the hashes agree nothing is used, then it is
    const lag = { ...edited, content: 'The lamp had gone out.\n\nHe sighed!' };
    e.onMessage('MESSAGE_EDITED', { chatId: 'chat-a', message: lag });
    assert.equal((await last(e)).extra.translation, undefined);
    e.onMessage('SWIPE_EDITED', { chatId: 'chat-a', message: edited });
    assert.equal((await last(e)).extra.translation, FX.pub.text);
    assert.equal(f.state.messageReads.length, reads, 'events only: no further chat read');
});

test('no full-chat read and no ownMetadataOnly (it would hide the translator\'s metadata): paged light reads once, everything else from events', async () => {
    const f = fake({ lean: true }); withTranslator(f); chatWith(f);
    const { e } = mk(f);
    for (let i = 0; i < 5; i++) await e.engine.chats.listMessages('chat-a');
    await e.translatorGlossary('chat-a');
    assert.equal(e.stats.fullReads, 0);
    assert.deepEqual(f.state.messageReads.map(r => [r.limit, r.light, r.ownMetadataOnly]), [[200, true, undefined]]);
});

test('the pinned screen has no /api/personal-extensions call left; syncGlossary is LV.syncGlossary', () => {
    const read = p => readFileSync(new URL(`../src/memory/ui/${p}`, import.meta.url), 'utf8');
    const out = patchMemory({ runtime: read('runtime.orig.js'), uiCss: read('ui.orig.css'), themeCss: read('theme.orig.css'), version: 'test' });
    assert.ok(!out.includes('personal-extensions'));
    assert.match(out, /async function syncGlossary\(id\) \{\s*try \{ await LV\.syncGlossary\(id\); \} catch \{\}\s*\}/);
});

const glossaryMeta = (g = {}) => ({ st_translator: { v: 1, glossary: { ...FX.glossary.glossary, ...g } } });

test('glossary: the translator\'s chat glossary reaches upstream\'s glossary path once; same text again changes nothing', async () => {
    const { f, inst } = makeEnv({ fakeOpts: { lean: true } });
    withTranslator(f); f.chats.get('chat-a').metadata = { ...f.chats.get('chat-a').metadata, ...glossaryMeta() };
    const first = await inst.syncTranslatorGlossary('chat-a');
    assert.equal(first.applied, true); assert.equal(first.changed, true); assert.equal(first.count, 2);
    const stored = inst.X.loadTranslations('chat-a').glossary;
    assert.deepEqual(stored.pairs.map(p => [p.from, p.to]), [['Alice', '앨리스'], ['Bob', '밥']]);
    assert.deepEqual(await inst.syncTranslatorGlossary('chat-a'), { applied: false, same: true });
    // a new text replaces it
    f.chats.get('chat-a').metadata = glossaryMeta({ text: 'Carol = 캐럴', hash: hashText('Carol = 캐럴') });
    assert.equal((await inst.syncTranslatorGlossary('chat-a')).changed, true);
    assert.deepEqual(inst.X.loadTranslations('chat-a').glossary.pairs.map(p => p.from), ['Carol']);
});

test('glossary: bad hash, unknown version, translator absent or incompatible: nothing applied, nothing thrown', async () => {
    assert.equal(readGlossary({ st_translator: { v: 1, glossary: { text: 'a = b', hash: 'zzz', at: 1 } } }), null);
    assert.equal(readGlossary({ st_translator: { v: 2, glossary: { text: 'a = b', hash: hashText('a = b'), at: 1 } } }), null);
    assert.equal(readGlossary({}), null);
    for (const setup of [f => withTranslator(f) || (f.chats.get('chat-a').metadata = glossaryMeta({ hash: 'bad' })), f => (f.chats.get('chat-a').metadata = glossaryMeta()), f => { f.rpcPool.peers.set(PEER, { ...FX.contract, v: 2 }); f.chats.get('chat-a').metadata = glossaryMeta(); }]) {
        const { f, inst } = makeEnv({ fakeOpts: { lean: true } });
        setup(f);
        assert.deepEqual(await inst.syncTranslatorGlossary('chat-a'), { applied: false });
        assert.equal(inst.X.loadTranslations('chat-a').glossary, undefined);
    }
});

test('backend: handshake at start, the screen\'s route and CHAT_CHANGED apply the glossary; only rooms that keep memory follow CHAT_CHANGED', async () => {
    const f = fake({ lean: true });
    const stop = start({ ...f.api, log: { info() {} } }, { afterReplyMs: 5, store: { debounceMs: 0 } });
    assert.deepEqual(f.rpcPool.policies.get('contract'), { requires: [] });
    assert.equal(f.rpcPool.synced.get('contract').ext, 'anon_memory_lv');
    withTranslator(f);
    f.chats.get('chat-a').metadata = glossaryMeta();
    // no translator answer yet for the first call is fine: the route asks (cached) itself
    const r = await f.rpc('POST', 'ext/translator/sync', { chatId: 'chat-a' });
    assert.equal(r.ok, true); assert.equal(r.data.applied, true);
    assert.equal((await f.rpc('POST', 'ext/translator/sync', {})).data.applied, false);
    // CHAT_CHANGED for a room without memory: ignored
    f.chats.get('chat-a').metadata = glossaryMeta({ text: 'Dan = 댄', hash: hashText('Dan = 댄') });
    f.emit('CHAT_CHANGED', { chat: { id: 'chat-a' }, changedFields: ['metadata.st_translator'] }, 'u1');
    await new Promise(r => setTimeout(r, 20));
    assert.equal((await f.rpc('GET', 'memory-module/chats/chat-a/translations')).ok, true);
    await stop();
    assert.equal(f.rpcPool.synced.has('contract'), false);
});
