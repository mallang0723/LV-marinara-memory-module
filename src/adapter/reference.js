// The "rendered ledger" channel for other extensions (today: the anonymous community's 「기억 서재 참고」).
//
// The original anonymous community read GET /api/memory-module/chats/:id and used two fields of the answer, `enabled` and `rendered`.
// Between Lumiverse extensions the only payload-carrying channel is the rpcPool, and its API has no arguments and no user:
// read(endpoint) -> handler({ endpoint, requesterExtensionId, effectivePermissions }) (src/spindle/worker-runtime.ts:4081-4092,
// 5111-5145). So the request is a two-step handshake:
//   1. the requester publishes `<its id>.mem-req` = { v:1, nonce, userId, chatId } (sync, policy { requires: [] }: ids only),
//   2. it reads `anon_memory_lv.rendered`; this handler reads that request endpoint of the *requesting extension*, checks it,
//      and answers { v:1, nonce, userId, chatId, state, enabled, rendered }.
// The requester must serialise its calls (one request value per extension). The answer echoes the nonce so a mix-up is detectable.
//
// Scoping: the requester asserts the userId; this side verifies that the chat belongs to that user (chats.get(chatId, userId))
// before any per-user instance is touched. The host does not vouch for the user, so this is not host-enforced.
// Only extensions on ALLOWED may ask. The text is private chat content: the endpoint requires the `chats` and `chat_mutation`
// permissions of both sides.
export const ENDPOINT = 'rendered';
export const REQUEST_CHANNEL = 'mem-req';
export const ALLOWED = ['anon_community_lv'];
export const REQUIRES = ['chats', 'chat_mutation'];
export const REFERENCE_VERSION = 1;

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * state: 'ok' (this room keeps memory; `rendered` is the ledger text, maybe empty), 'disabled' (this room has memory off),
 * 'absent' (the extension's master switch is off: the requester treats it as "no memory module").
 */
export function createReference({ api, manager, host, log = () => {}, allowed = ALLOWED }) {
    const pool = api?.rpcPool;
    let registered = false;

    async function answer(ctx) {
        const requester = ctx?.requesterExtensionId;
        if (typeof requester !== 'string' || !allowed.includes(requester)) throw new Error('not allowed');
        const req = await pool.read(`${requester}.${REQUEST_CHANNEL}`);
        if (!isObject(req) || req.v !== REFERENCE_VERSION || typeof req.userId !== 'string' || !req.userId || typeof req.chatId !== 'string' || !req.chatId || typeof req.nonce !== 'string') throw new Error('bad request');
        const base = { v: REFERENCE_VERSION, nonce: req.nonce, userId: req.userId, chatId: req.chatId };
        await host.rawChat(req.userId, req.chatId);       // throws (status 404) unless the chat belongs to that user
        const um = manager.forUser(req.userId);
        await um.ready();
        if (um.settings().moduleMemory === false) return { ...base, state: 'absent', enabled: false, rendered: '' };
        await um.preloadRoom(req.chatId);
        if (!um.chatEnabled(req.chatId)) return { ...base, state: 'disabled', enabled: false, rendered: '' };
        return { ...base, state: 'ok', enabled: true, rendered: String(await um.rendered(req.chatId) || '') };
    }

    function publish() {
        if (registered || !pool?.handle) return registered;
        try { pool.handle(ENDPOINT, async ctx => { try { return await answer(ctx); } catch (e) { log(`rendered endpoint: ${e?.message || e}`); throw e; } }, { requires: [...REQUIRES] }); registered = true; } catch (e) { log(`rendered endpoint: ${e?.message || e}`); }
        return registered;
    }
    function dispose() { try { if (registered) pool?.unregister?.(ENDPOINT); } catch { /* shutting down */ } registered = false; }
    return { publish, dispose, answer };
}
