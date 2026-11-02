// Bridge upstream service-test fixtures to the production Lumiverse store, adapter and routes.
import { makeEnv } from './env.js';
import { registerMemoryRoutes } from '../src/memory/routes.js';
export async function upstreamHarness(rooms, tunables = {}) {
    const env = makeEnv({ tunables });
    await env.um.ready();
    await Promise.all(rooms.map(id => env.um.ensureChat(id)));
    const service = {
        renderLedger: env.um.renderLedger,
        _test: { ...env.um, setEngine(engine) {
            if (engine.connections) env.f.api.connections.list = async () => engine.connections.list();
            env.um.clearConnectionsCache();
            if (engine.createLLMProvider) env.f.model = async ({ messages, parameters, signal }) => (await engine.createLLMProvider().chatComplete(messages, { ...parameters, signal })).content;
            if (engine.chats) env.f.api.chat.getMessages = async id => (await engine.chats.listMessages(id)).map((m, i) => ({ ...m, index_in_chat: (m.rowid || i + 1) - 1 }));
        } },
        attach(app) {
            registerMemoryRoutes({ add(method, pattern, handler) {
                app.register(inner => inner[method.toLowerCase()]('/' + pattern.replace(/^memory-module\//, ''), req => handler({ ...req, userId: env.U, query: req.query || {} })));
            } }, env.svc);
        },
    };
    return { service, env };
}
