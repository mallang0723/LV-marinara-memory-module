// Bridge upstream service-test fixtures to the production Lumiverse store, adapter and routes.
import F from '../src/memory/core/features.cjs';
import { makeEnv } from './env.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
export async function upstreamHarness(rooms, tunables = {}) {
    const env = makeEnv({ tunables });
    await env.um.ready();
    await Promise.all(rooms.map(id => env.um.ensureChat(id)));
    const service = {
        renderLedger: env.um.renderLedger,
        _test: { ...env.um,
            loadNames: id => env.um.roomData.get(id, 'names'),
            saveNames: (id, value) => env.um.roomData.save(id, 'names', value),
            loadAddress: id => env.um.roomData.get(id, 'address'),
            saveAddress: (id, value) => env.um.roomData.save(id, 'address', value),
            loadAttributionLog: id => env.um.roomData.get(id, 'attribution-log'),
            attributionSetting: id => F.resolveAttribution(env.um.settings(), id),
            async reviewAttributions(id, scenes, messages, getModel, job, reason) {
                const previousRead = env.um.chatMessages;
                const previousModel = env.f.model;
                env.um.chatMessages = async () => messages;
                env.f.model = async ({ messages: prompt }) => (await (await getModel()).provider.chatComplete(prompt)).content;
                try { return await env.um.roomData.using(id, () => env.um.reviewAttributions(id, scenes, messages, async () => ({ connectionId: 'conn-a', signal: job.abort?.signal }), job, reason)); }
                finally { env.um.chatMessages = previousRead; env.f.model = previousModel; }
            },
            setEngine(engine) {
            if (engine.connections) env.f.api.connections.list = async () => engine.connections.list();
            env.um.clearConnectionsCache();
            if (engine.createLLMProvider) env.f.model = async ({ messages, parameters, signal }) => (await engine.createLLMProvider().chatComplete(messages, { ...parameters, signal })).content;
            if (engine.chats) env.f.api.chat.getMessages = async id => (await engine.chats.listMessages(id)).map((m, i) => ({ ...m, index_in_chat: (m.rowid || i + 1) - 1 }));
        } },
        attach(app) {
            registerMemoryRoutes({ add(method, pattern, handler) {
                app.register(inner => inner[method.toLowerCase()]('/' + pattern.replace(/^memory-module\//, ''), async (req, reply) => { try { return await handler({ ...req, userId: env.U, query: req.query || {} }); } catch (error) { if (reply) return reply.status(400).send({ error: error.message }); throw error; } }));
            } }, env.svc);
        },
    };
    return { service, env };
}
