import { buildApp } from './app';

const app = await buildApp();
const port = Number(process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 3000 : 3001));
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { await app.close(); process.exit(0); });
}
