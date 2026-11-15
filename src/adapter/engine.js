// The "engine" the pinned upstream service.cjs asks for (its Marinara storage objects), answered by Lumiverse's Spindle API.
// One engine per user. Chat messages come from a per-chat snapshot: read once (in pages when the host has
// `chat-lean-messages-v1`, else the one full read the host offers) and then kept current from the host's message events;
// there is never a full read per call or per tick. `refreshTail` re-reads only the last few messages.
import { wrapHostError } from '../common/store.js';
import { readPub, readGlossary } from './translator.js';

const PAGE = 200;
const TAIL = 30;
const iso = t => { const n = Number(t); if (!Number.isFinite(n) || n <= 0) return null; return new Date(n < 1e12 ? n * 1000 : n).toISOString(); };
const clone = v => (v == null ? v : structuredClone(v));

export function createEngine({ api, userId, log = () => {}, translator = null, lean = !!api.host?.capabilities?.['chat-lean-messages-v1'], getMessageLimit = async () => null, getWindow = () => null }) {
    const call = async fn => { try { return await fn(); } catch (e) { throw wrapHostError(e); } };
    const stats = { fullReads: 0, pageReads: 0, tailReads: 0, events: 0 };

    // ---- messages ----
    /** chatId -> {rows: dto[] in chat order, loading: Promise|null} */
    const snaps = new Map();
    const shapeRow = (m, position) => {
        const extra = m.extra && typeof m.extra === 'object' ? m.extra : {};
        const meta = m.metadata && typeof m.metadata === 'object' ? m.metadata : null;
        const content = typeof m.content === 'string' ? m.content : '';
        const role = m.role === 'system' ? 'system' : m.is_user || m.role === 'user' ? 'user' : 'assistant';
        // Hidden messages are still the story (a message hidden from the prompt was said): hiddenFromAI is never set.
        const out = { id: m.id, role, content, characterId: role === 'assistant' ? `name:${m.name || ''}` : null, rowid: position + 1, activeSwipeIndex: m.swipe_id ?? 0, extra: { ...(role === 'user' ? { personaSnapshot: { name: m.name || 'User' } } : {}) } };
        out.lv = { extra, metadata: meta };   // the host's own fields
        translatorRow(out, m);
        return out;
    };
    // ---- translator contract "LV-TX v1" (src/adapter/translator.js) ----
    // The translator's public translation of a message becomes what upstream already reads off a Marinara row: extra.translation +
    // translationSource (chatMessages, the Korean the library finds old lines by) and extra.paraTranslate.map (noteSourceKo, the
    // paragraph translations quoted lines are shown with). Used only while the translator is present and speaks v1, and only when its
    // hash matches the message text as it is now.
    function translatorRow(row, dto) {
        if (translator?.state() !== 'ok') return;
        const pub = readPub(row.content, dto.metadata);
        if (!pub) return;
        row.extra.translation = pub.text;
        row.extra.translationSource = row.content;
        if (pub.paras) row.extra.paraTranslate = { map: pub.paras };
    }
    /** The glossary the translator published in the chat's metadata (one chat read, no message read), or null. */
    async function translatorGlossary(chatId) {
        if (translator) await translator.refresh();
        if (translator?.state() !== 'ok') return null;
        return readGlossary((await authorize(chatId)).metadata);
    }
    // Message events carry the host's raw message: the extensions' metadata is extra.spindle_metadata there, `metadata` in a read.
    const dtoOf = m => ({ id: m.id, role: m.role, is_user: m.is_user, name: m.name, content: m.content, swipe_id: m.swipe_id, extra: m.extra, metadata: m.metadata ?? m.extra?.spindle_metadata, index_in_chat: m.index_in_chat });
    async function authorize(chatId) {
        const c = await call(() => api.chats.get(chatId, userId));
        if (!c) throw Object.assign(new Error('채팅을 찾지 못했습니다.'), { status: 404 });
        return c;
    }
    async function loadAll(chatId) {
        await authorize(chatId);
        let rows;
        if (lean) {
            rows = [];
            for (let offset = 0; ; offset += PAGE) {
                stats.pageReads++;
                const page = await call(() => api.chat.getMessages(chatId, { limit: PAGE, offset, light: true }));
                rows.push(...(page || []));
                if (!page || page.length < PAGE) break;
            }
        } else {
            stats.fullReads++;
            rows = await call(() => api.chat.getMessages(chatId));
        }
        return (rows || []).map(dtoOf);
    }
    async function snapshot(chatId) {
        let s = snaps.get(chatId);
        if (s?.rows) return s;
        if (!s) { s = { rows: null, loading: null, gen: 0 }; snaps.set(chatId, s); }
        if (!s.loading) {
            const gen = s.gen;
            s.loading = loadAll(chatId).then(rows => { if (s.gen === gen) s.rows = rows; }).finally(() => { s.loading = null; });
        }
        await s.loading;
        if (!s.rows) return snapshot(chatId);
        return s;
    }
    const chatCache = new Map();
    const chatsApi = {
        async listMessages(chatId) {
            if (translator) await translator.refresh();   // cached for 20 s; a failed read is "none"
            const s = await snapshot(chatId);
            return s.rows.map(shapeRow);
        },
        async getById(id) {
            const hit = chatCache.get(id);
            if (hit && Date.now() - hit.at < 3000) return hit.value;
            let c;
            try { c = await authorize(id); } catch (e) { if (e?.status === 404) return null; throw e; }
            const value = shapeChat(c);
            // How many newest messages the reply model sees directly: Lumiverse's own message limit when it is on, else the
            // extension's window setting (upstream reads `contextMessageLimit` from the chat metadata and falls back to 30).
            let limit = null;
            try { limit = await getMessageLimit(); } catch { /* the setting is optional */ }
            limit = Number.isInteger(limit) && limit > 0 ? limit : getWindow();
            if (limit) value.metadata = JSON.stringify({ ...JSON.parse(value.metadata), contextMessageLimit: limit });
            chatCache.set(id, { at: Date.now(), value });
            return value;
        },
        async list() {
            const out = [];
            for (let offset = 0; ; offset += PAGE) {
                const res = await call(() => api.chats.list({ limit: PAGE, offset, userId }));
                const data = Array.isArray(res) ? res : res?.data || [];
                out.push(...data);
                if (Array.isArray(res) || data.length < PAGE || (res.total != null && out.length >= res.total)) break;
            }
            return out.map(shapeChat);
        },
        async listByGroup() { return []; },
        async updateMessageContent() { throw Error('루미버스에서는 말풍선 태그를 쓰지 않습니다.'); },
    };
    function shapeChat(c) {
        const meta = c.metadata && typeof c.metadata === 'object' ? c.metadata : {};
        const ids = Array.isArray(meta.character_ids) && meta.character_ids.length ? meta.character_ids : c.character_id ? [c.character_id] : [];
        const metadata = { ...meta };
        const summary = typeof meta.loom_summary === 'string' && meta.loom_summary.trim() ? meta.loom_summary : '';
        if (summary) metadata.summaryEntries = [{ id: 'loom_summary', title: 'Loom 요약', content: summary, enabled: true }];
        return { id: c.id, name: c.name || '', mode: 'roleplay', characterIds: ids, metadata: JSON.stringify(metadata), createdAt: iso(c.created_at), updatedAt: iso(c.updated_at) };
    }

    // ---- events keep the snapshot current ----
    const positionOf = (s, id) => s.rows.findIndex(r => r.id === id);
    function onMessage(type, payload) {
        const chatId = payload?.chatId;
        const s = snaps.get(chatId);
        if (!s) return;
        stats.events++; s.seen = (s.seen || 0) + 1;
        if (!s.rows) { s.gen++; return; }                       // a load is in flight: its result may predate this event
        const m = payload.message;
        if (type === 'MESSAGE_DELETED') {
            const at = positionOf(s, payload.messageId);
            if (at >= 0) s.rows.splice(at, 1); else invalidate(chatId);
            return;
        }
        if (!m || typeof m.id !== 'string') return invalidate(chatId);
        const at = positionOf(s, m.id);
        if (type === 'MESSAGE_SENT' && at < 0) {
            if (payload.inserted || (Number.isFinite(m.index_in_chat) && m.index_in_chat !== s.rows.length)) return invalidate(chatId);
            s.rows.push(dtoOf(m));
        } else if (at >= 0) s.rows[at] = { ...dtoOf(m) };
        else invalidate(chatId);
    }
    function invalidate(chatId) { const s = snaps.get(chatId); if (s) { s.gen++; s.rows = null; s.loading = null; } }
    function dropChat(chatId) { snaps.delete(chatId); chatCache.delete(chatId); }
    /** Re-reads only the last messages (after a reply) and puts them into the snapshot by id. */
    async function refreshTail(chatId, n = TAIL) {
        const s = snaps.get(chatId);
        if (!s?.rows) return;
        // An older host has no tail read: the snapshot is trusted as long as message events keep arriving; a reply that produced
        // none (events refused or lost) means the snapshot can no longer be trusted, so it is read again once.
        if (!lean) { if (!s.seen) invalidate(chatId); s.seen = 0; return; }
        s.seen = 0;
        stats.tailReads++;
        const tail = (await call(() => api.chat.getMessages(chatId, { tail: n, light: true }))) || [];
        if (!tail.length) return;
        const first = positionOf(s, tail[0].id);
        if (first < 0) return invalidate(chatId);
        s.rows.splice(first, s.rows.length - first, ...tail.map(dtoOf));
    }

    // ---- characters / connections ----
    const names = new Map();
    const characters = {
        async getById(id) {
            if (typeof id === 'string' && id.startsWith('name:')) return { data: JSON.stringify({ name: id.slice(5) || null }) };
            if (names.has(id)) return names.get(id);
            const c = await call(() => api.characters.get(id, userId)).catch(() => null);
            const row = c ? { data: JSON.stringify({ name: c.name || null }) } : null;
            names.set(id, row);
            return row;
        },
    };
    let embedConns = null;
    async function embeddingConnections() {
        if (!api.embeddings?.listConnections) throw Object.assign(new Error('이 루미버스는 임베딩 API를 제공하지 않습니다.'), { code: 'permission' });
        return (await call(() => api.embeddings.listConnections({ userId }))).filter(c => c.enabled !== false);
    }
    const connections = {
        async list() {
            const list = (await call(() => api.connections.list(userId))) || [];
            // Lumiverse keeps embeddings in their own connections: the user's primary one plays the part of the memory
            // connection's "embedding model" (upstream reads it off the connection).
            let primary = null;
            try { embedConns = await embeddingConnections(); primary = embedConns.find(c => c.is_primary) || embedConns[0] || null; } catch { embedConns = null; }
            return list.map(c => ({ id: c.id, name: c.name, provider: c.provider, model: c.model, isDefault: !!c.is_default, embeddingModel: primary?.model || '', baseUrl: 'lumiverse://connection', maxContext: undefined }));
        },
        async getWithKey(id) { const row = (await this.list()).find(c => c.id === id); return row || null; },
        async unavailableReason() { return null; },
    };
    /** The provider the service gets for a connection: chat goes through generate.quiet, embeddings through the embeddings API. */
    function createLLMProvider(providerName, baseUrl, apiKey, maxContext, openrouter, x, y, z, defaultParameters, connectionId) {
        return {
            async chatComplete(messages, opts = {}) {
                const parameters = {};
                if (opts.maxTokens != null) parameters.max_tokens = opts.maxTokens;
                if (opts.temperature != null) parameters.temperature = opts.temperature;
                // upstream asks for JSON mode first and, when the host refuses it (an error naming response_format), asks again without
                if (opts.responseFormat) parameters.response_format = opts.responseFormat;
                const res = await call(() => api.generate.quiet({ messages, ...(connectionId ? { connection_id: connectionId } : {}), parameters, signal: opts.signal, userId }));
                const content = typeof res === 'string' ? res : res?.content;
                return { content: typeof content === 'string' ? content : '', usage: res?.usage || null };
            },
            async embed(texts, model, signal) {
                embedConns ??= await embeddingConnections();
                const pick = embedConns.find(c => c.model === model || c.name === model) || embedConns.find(c => c.is_primary) || embedConns[0];
                const res = await call(() => api.embeddings.embed({ texts: texts.map(t => String(t).slice(0, 8000)), ...(pick ? { connection_id: pick.id } : {}), input_type: 'passage', userId }, { signal }));
                return res?.embeddings || [];
            },
        };
    }
    // Marinara's tracker snapshots do not exist here. An empty answer (not null) keeps upstream's own story clock running: it reads the
    // date line a message carries itself and carries it on to the next messages (addTrackerClock).
    const gameStates = { async getCommittedForMessages() { return new Map(); }, async getLatestForMessages() { return null; } };
    const engine = { chats: chatsApi, characters, connections, createLLMProvider, resolveBaseUrl: c => c?.baseUrl || 'lumiverse://connection', gameStates };
    return { engine, onMessage, invalidate, dropChat, refreshTail, translatorGlossary, stats, snapshotRows: async id => (await snapshot(id)).rows, resetEmbeddings: () => { embedConns = null; } , getMessageLimit };
}
