import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev only: serve the real Vercel functions in api/demo/*.ts from the Vite dev
 * server, so `npm run dev` runs the whole app (on Vercel they are deployed as is).
 */
function demoApi(): Plugin {
  return {
    name: 'cto-demo-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/demo', async (req, res) => {
        const name = (req.url ?? '/').split('?')[0].replace(/^\//, '');
        if (!/^[a-z-]+$/.test(name)) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const mod = await server.ssrLoadModule(`/api/demo/${name}.ts`);
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const request = new Request(`http://${req.headers.host}${req.originalUrl}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The relayer reads plain env vars (ANI_FULL_KEY, ...); in dev they come from .env.local.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (!k.startsWith('VITE_') && process.env[k] === undefined) process.env[k] = v;
  return {
    plugins: [react(), tailwindcss(), demoApi()],
    build: { target: 'es2022', sourcemap: true },
  };
});
