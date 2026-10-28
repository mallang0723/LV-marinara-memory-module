// Host adapter: answers the Marinara-shaped requests the memory screen (and the memory service) make with Lumiverse's
// Spindle API. Every call takes the userId (operator-scoped install) and passes it on; a missing userId is refused here before
// the host does it. Permission failures become errors with code 'permission' and a Korean hint (wrapHostError).
//
// Host facts (Lumiverse ~/Lumiverse, HEAD 11a66b75; DTOs in frontend/node_modules/lumiverse-spindle-types/dist, "types/"):
//  - connections.list(userId) needs `generation` (src/spindle/worker-host.ts:3518-3523); ConnectionProfileDTO types/api.d.ts:666
//  - chats.list({limit,offset,userId}) / chats.get(id,userId) need `chats`; ChatDTO has NO mode, metadata.character_ids lists a
//    group's members (src/services/chats.service.ts:64-65); timestamps are unix seconds
//  - chat.getMessages(chatId) needs `chat_mutation`, returns ALL messages incl. hidden ones (worker-host.ts:3876-3920), role is
//    user|assistant|system only, number = index_in_chat, hidden = extra.hidden === true (worker-host.ts:4179)
//  - chat summary = chat.metadata.loom_summary (string) (src/services/prompt-assembly.service.ts:4728)
//  - a user message carries extra.persona_id (chats.service.ts:1865)
//  - generate.quiet({messages, connection_id, parameters, signal, userId}) -> {content,...}; parameters are snake_case
//    (src/services/generation/direct-generation.ts:253-277, worker-host.ts:3318-3330)
//  - paged lists: limit <= 200 (the fake host enforces it like the real one), loop until `total`
import { wrapHostError } from './store.js';

const PAGE = 200;
const iso = t => { const n = Number(t); if (!Number.isFinite(n) || n <= 0) return null; return new Date(n < 1e12 ? n * 1000 : n).toISOString(); };

export function createHostAdapter(api, { log = () => {} } = {}) {
    const need = userId => { if (typeof userId !== 'string' || !userId) throw new Error('userId required'); return userId; };
    const call = async fn => { try { return await fn(); } catch (e) { throw wrapHostError(e); } };

    async function pages(userId, fetchPage) {
        const out = [];
        for (let offset = 0; ; offset += PAGE) {
            const res = await call(() => fetchPage({ limit: PAGE, offset, userId }));
            const data = Array.isArray(res) ? res : res?.data || [];
            out.push(...data);
            if (Array.isArray(res) || data.length < PAGE || (res.total != null && out.length >= res.total)) break;
        }
        return out;
    }

    const has = perm => { try { return api.permissions?.has ? api.permissions.has(perm) : true; } catch { return true; } };

    // ---- C: connections ----
    async function connections(userId) {
        need(userId);
        const list = await call(() => api.connections.list(userId));
        return (list || []).map(c => ({ id: c.id, name: c.name, provider: c.provider, model: c.model, isDefault: !!c.is_default }));
    }

    // ---- D: chats ----
    const shapeChat = c => {
        const meta = c.metadata && typeof c.metadata === 'object' ? c.metadata : {};
        const ids = Array.isArray(meta.character_ids) && meta.character_ids.length ? meta.character_ids : c.character_id ? [c.character_id] : [];
        const summary = typeof meta.loom_summary === 'string' && meta.loom_summary.trim() ? meta.loom_summary : '';
        const metadata = { ...meta };
        if (summary) metadata.summaryEntries = [{ id: 'loom_summary', title: 'Loom 요약', content: summary, enabled: true }];
        return { id: c.id, name: c.name || '', mode: 'roleplay', characterIds: ids, personaId: null, metadata, createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), lastMessageAt: iso(c.updated_at) };
    };
    async function chatsList(userId) {
        need(userId);
        return (await pages(userId, o => api.chats.list(o))).map(c => shapeChat(c));
    }
    async function rawChat(userId, chatId) {
        need(userId);
        const c = await call(() => api.chats.get(chatId, userId));
        if (!c) throw Object.assign(new Error('채팅을 찾지 못했습니다.'), { status: 404 });
        return c;
    }
    // ---- E/U: messages ----
    const shapeMessage = m => {
        const extra = m.extra && typeof m.extra === 'object' ? m.extra : {};
        const content = typeof m.content === 'string' ? m.content : '';
        return { id: m.id, number: (Number.isFinite(m.index_in_chat) ? m.index_in_chat : 0) + 1, role: m.role === 'system' ? 'system' : m.is_user ? 'user' : m.role || 'assistant', content, name: m.name || '', hidden: extra.hidden === true, personaId: extra.persona_id || null, extra, swipeId: m.swipe_id ?? 0, createdAt: iso(m.created_at || m.send_date) };
    };
    /** All messages in order (hidden ones included: they are still the story, see SPEC 6.4). */
    async function allMessages(userId, chatId) {
        need(userId);
        const rows = await call(() => api.chat.getMessages(chatId));
        return (rows || []).map(shapeMessage).sort((a, b) => a.number - b.number);
    }
    // ---- F: characters ----
    async function character(userId, id) {
        need(userId);
        const c = await call(() => api.characters.get(id, userId));
        if (!c) throw Object.assign(new Error('캐릭터를 찾지 못했습니다.'), { status: 404 });
        return c;
    }
    async function characterName(userId, id) {
        try { return (await character(userId, id)).name || null; } catch { return null; }
    }

    // ---- H/S: generation ----
    /** One model call. `maxTokens`/`temperature` are mapped to snake_case. Returns the text. */
    async function generate(userId, { connectionId, messages: msgs, maxTokens, temperature, signal, extraParameters = {} }) {
        need(userId);
        const parameters = { ...extraParameters };
        if (maxTokens != null) parameters.max_tokens = maxTokens;
        if (temperature != null) parameters.temperature = temperature;
        const res = await call(() => api.generate.quiet({ messages: msgs, ...(connectionId ? { connection_id: connectionId } : {}), parameters, signal, userId }));
        const text = typeof res === 'string' ? res : res?.content;
        return typeof text === 'string' ? text : '';
    }

    // ---- T: embeddings ----
    async function embeddingConnections(userId) {
        need(userId);
        if (!api.embeddings?.listConnections) throw Object.assign(new Error('이 루미버스는 임베딩 API를 제공하지 않습니다.'), { code: 'permission' });
        return call(() => api.embeddings.listConnections({ userId }));
    }
    async function embed(userId, { texts, connectionId, inputType, signal }) {
        need(userId);
        if (!api.embeddings?.embed) throw Object.assign(new Error('이 호스트는 임베딩을 지원하지 않습니다.'), { code: 'permission' });
        const res = await call(() => api.embeddings.embed({ texts, ...(connectionId ? { connection_id: connectionId } : {}), input_type: inputType === 'query' ? 'query' : 'passage', userId }, { signal }));
        return res;
    }

    return { connections, chatsList, rawChat, allMessages, character, characterName, generate, embeddingConnections, embed, has };
}
