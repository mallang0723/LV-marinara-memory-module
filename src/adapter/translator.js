// The memory side of the translator contract "LV-TX v1" (LV-Translator 0.4.0, st_translator). Everything it reads is public data the
// translator writes itself; nothing here calls the translator.
//
//   handshake  rpcPool endpoint `anon_memory_lv.contract` (published here, policy { requires: [] } so the reader needs none of our
//              permissions) and `st_translator.contract` (read here, cached): { name:'lv-tx', v:1, ext, version, provides }
//   message    metadata.st_translator.pub = { v:1, h, lang, text, paras?, edited?, at }; used only when h == hashText(message.content)
//   chat       chat.metadata.st_translator.glossary = { text, hash, at } (under st_translator.v 1); used only when hash == hashText(text)
//
// Source of the shapes: ~/dev/lv-translator src/adapter/contract.ts (wip/translation-tools-1.8.0 d18dd8c). `h` is the translator's
// vendored upstream hashText (FNV-1a 32 over UTF-16 code units, base36), not the ledger's sha1 hashText.

export const SELF_ID = 'anon_memory_lv';
export const PEER_ID = 'st_translator';
export const CONTRACT_NAME = 'lv-tx';
export const CONTRACT_VERSION = 1;
export const PROVIDES = ['reads-pub-translation@1', 'reads-glossary@1'];
export const PEER_TTL_MS = 20_000;

/** FNV-1a 32 base36, byte for byte the translator's hashText (upstream personal-extension/extension.js@807d6a3 L1899-L1907). */
export function hashText(str) {
    let h = 0x811c9dc5;
    const s = String(str ?? '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

export function handshake(version) { return { name: CONTRACT_NAME, v: CONTRACT_VERSION, ext: SELF_ID, version, provides: [...PROVIDES] }; }

/** 'none' (nothing readable: not installed, refused, no rpcPool), 'ok' (lv-tx v1), 'incompatible' (something else or another version). */
export function classifyPeer(value) {
    if (!isObject(value)) return 'none';
    if (value.name !== CONTRACT_NAME || typeof value.v !== 'number') return 'incompatible';
    return value.v === CONTRACT_VERSION ? 'ok' : 'incompatible';
}

/**
 * Publishes the memory side and watches the translator's. state() is synchronous (the last answer); refresh() asks again at most once
 * per ttl. Any failure of the pool (older host, requires refused, no value) is "none": the feature stays off, silently.
 */
export function createTranslatorLink(api, { version = '0', ttlMs = PEER_TTL_MS, now = () => Date.now(), log = () => {} } = {}) {
    const pool = api?.rpcPool;
    let published = false;
    let current = { state: 'none', version: null };
    let at = -Infinity, inflight = null;
    function publish() {
        if (published || !pool?.sync) return published;
        try { pool.sync('contract', handshake(version), { requires: [] }); published = true; } catch (e) { log(`translator handshake: ${e?.message || e}`); }
        return published;
    }
    async function refresh(force = false) {
        if (!pool?.read) return current;
        if (!force && now() - at < ttlMs) return current;
        if (inflight) return inflight;
        inflight = (async () => {
            try {
                const value = await pool.read(`${PEER_ID}.contract`);
                current = { state: classifyPeer(value), version: isObject(value) && typeof value.version === 'string' ? value.version : null };
            } catch { current = { state: 'none', version: null }; }
            at = now();
            return current;
        })().finally(() => { inflight = null; });
        return inflight;
    }
    function dispose() { try { if (published) pool?.unregister?.('contract'); } catch { /* shutting down */ } published = false; }
    return { publish, refresh, state: () => current.state, version: () => current.version, dispose };
}

/** The translation of `content` the translator published, or null: no pub, an unknown pub version, or a hash of other text (stale). */
export function readPub(content, metadata) {
    const pub = isObject(metadata) && isObject(metadata[PEER_ID]) ? metadata[PEER_ID].pub : null;
    if (!isObject(pub) || pub.v !== 1 || typeof pub.text !== 'string' || !pub.text.trim()) return null;
    if (typeof content !== 'string' || !content || pub.h !== hashText(content)) return null;
    const paras = {};
    if (isObject(pub.paras)) for (const [k, v] of Object.entries(pub.paras)) if (typeof v === 'string' && v.trim()) paras[k] = v;
    return { text: pub.text, paras: Object.keys(paras).length ? paras : null, edited: isObject(pub.edited) ? Object.keys(pub.edited) : [], lang: typeof pub.lang === 'string' ? pub.lang : null };
}

/** The glossary text the translator published for a chat, or null (none, unknown version, or text that does not match its hash). */
export function readGlossary(chatMetadata) {
    const own = isObject(chatMetadata) ? chatMetadata[PEER_ID] : null;
    const g = isObject(own) && own.v === 1 ? own.glossary : null;
    if (!isObject(g) || typeof g.text !== 'string' || g.hash !== hashText(g.text)) return null;
    return g.text;
}
