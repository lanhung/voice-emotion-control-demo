import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { Agent } from 'node:https';
import { readHttpsOptions } from './server/https.ts';

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  // Certificates are runtime files; production builds do not need access to them.
  const https = command === 'serve' ? readHttpsOptions(env) : undefined;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      https,
      proxy: {
        '/api': {
          target: `${https ? 'https' : 'http'}://127.0.0.1:${env.PORT ?? '3001'}`,
          // Preserve Host so the API can validate the browser's same-origin POSTs.
          changeOrigin: false,
          ...(https ? { agent: new Agent({ ca: https.cert }) } : {}),
        },
      },
    },
    build: { outDir: 'dist/client' },
  };
});
