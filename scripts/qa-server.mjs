// QA server pieces shared by scripts/browser-qa.mjs: static files from the repo + the stand-in channel to the QA backend.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createQaEnv } from '../qa/backend-env.mjs';

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' };
export async function createQaServer(root = process.cwd()) {
    /** one backend env per page (header x-qa-session), created on first use */
    const envs = new Map();
    const envFor = async id => { if (!envs.has(id)) envs.set(id, createQaEnv()); return envs.get(id); };
    const requests = [];
    async function handle({ method, pathname, session, body, search = '' }) {
        requests.push(`${method} ${pathname}`);
        if (pathname.endsWith('/__rpc')) {
            const env = await envFor(session);
            const { frame, user } = JSON.parse(body || '{}');
            return json({ replies: await env.handle(frame, user) });
        }
        if (pathname.endsWith('/__poll')) {
            const env = await envFor(session);
            return json({ events: env.drain() });
        }
        if (pathname.endsWith('/__cmd')) {
            const env = await envFor(session);
            const q = new URLSearchParams(search);
            await env.f.invokeCommand(q.get('id'), { chatId: q.get('chat') || undefined });
            return json({ ok: true });
        }
        if (pathname === '/api/v1/settings' && method === 'GET') { // Lumiverse bulk settings list ([{ key, value }]), the source of the message limit
            const env = await envFor(session);
            const value = env.f.state.summarization;
            return json(value ? [{ key: 'summarization', value }] : []);
        }
        const file = path.resolve(root + decodeURIComponent(pathname));
        if (!file.startsWith(root + path.sep)) throw new Error('outside');
        return { status: 200, type: types[path.extname(file)] || 'text/plain', body: await readFile(file) };
    }
    const json = o => ({ status: 200, type: 'application/json', body: JSON.stringify(o) });
    return { handle, requests, envs, env: envFor };
}
