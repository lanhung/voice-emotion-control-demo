import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { buildApp } from '../server/app';
import { readHttpsOptions, type HttpsOptions } from '../server/https';
import { encodeWav } from '../src/audio/wav';

let directory: string;
let credentials: HttpsOptions;
let env: NodeJS.ProcessEnv;
const servers: Array<{ close(): Promise<unknown> }> = [];
const execute = promisify(execFile);
const wav = Buffer.from(encodeWav(new Float32Array(40000).fill(0.1)));

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'aura-https-'));
  env = { HTTPS_CERT_FILE: join(directory, 'server.crt'), HTTPS_KEY_FILE: join(directory, 'server.key') };
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext', 'extendedKeyUsage=serverAuth',
    '-keyout', env.HTTPS_KEY_FILE!, '-out', env.HTTPS_CERT_FILE!], { stdio: 'ignore' });
  credentials = { cert: readFileSync(env.HTTPS_CERT_FILE!), key: readFileSync(env.HTTPS_KEY_FILE!) };
});
afterEach(async () => {
  await Promise.all(servers.splice(0).reverse().map((server) => server.close()));
  vi.unstubAllEnvs();
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function request(url: string, options: RequestOptions = {}, body?: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: credentials.cert, agent: false, ...options }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function startApi(https = true, ready = true) {
  const model = Fastify(); servers.push(model);
  model.get('/health', () => ({ ready }));
  model.addContentTypeParser(/^multipart\//, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  model.post('/api/v1/asr', () => ({ result: [{ raw_text: '<|zh|><|HAPPY|><|Speech|>你好。' }] }));
  const modelUrl = await model.listen({ host: '127.0.0.1', port: 0 });
  const app = await buildApp({ https: https ? readHttpsOptions(env) : undefined,
    sensevoiceUrl: modelUrl, logger: false, staticDir: '/nonexistent' });
  servers.push(app);
  return app.listen({ host: '127.0.0.1', port: 0 });
}

describe('HTTPS with fixed certificate files', () => {
  it('keeps HTTP optional and rejects incomplete or unreadable TLS configuration', () => {
    expect(readHttpsOptions({})).toBeUndefined();
    expect(readHttpsOptions({ HTTPS_CERT_FILE: ' ', HTTPS_KEY_FILE: '' })).toBeUndefined();
    expect(() => readHttpsOptions({ HTTPS_CERT_FILE: env.HTTPS_CERT_FILE })).toThrow('必须同时设置');
    expect(() => readHttpsOptions({ HTTPS_KEY_FILE: env.HTTPS_KEY_FILE })).toThrow('必须同时设置');
    expect(() => readHttpsOptions({ ...env, HTTPS_KEY_FILE: join(directory, 'missing.key') })).toThrow('无法加载 HTTPS');
    const invalidKey = join(directory, 'invalid.key');
    writeFileSync(invalidKey, 'not a private key');
    expect(() => readHttpsOptions({ ...env, HTTPS_KEY_FILE: invalidKey })).toThrow('无法加载 HTTPS');
  });

  it('serves health and audio over verified TLS and still rejects cross-origin POSTs', async () => {
    const url = await startApi();
    const health = await request(url + '/api/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ status: 'ready' });
    const audio = await request(url + '/api/analyze', {
      method: 'POST', headers: { origin: url, 'content-type': 'audio/wav' },
    }, wav);
    expect(audio.status).toBe(200);
    expect(JSON.parse(audio.body)).toMatchObject({ text: '你好。', emotion: 'happy' });
    expect((await request(url + '/api/analyze', {
      method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'audio/wav' },
    }, wav)).status).toBe(403);
  });

  it.each([false, true])('runs the container health probe with HTTPS=%s', async (https) => {
    for (const ready of [true, false]) {
      const url = await startApi(https, ready);
      const probe = execute(process.execPath, ['--import', 'tsx', 'server/healthcheck.ts'], {
        env: { ...process.env, PORT: new URL(url).port,
          HTTPS_CERT_FILE: https ? env.HTTPS_CERT_FILE : '',
          HTTPS_KEY_FILE: https ? env.HTTPS_KEY_FILE : '' },
      });
      if (ready) await expect(probe).resolves.toMatchObject({ stdout: '', stderr: '' });
      else await expect(probe).rejects.toMatchObject({ code: 1 });
    }
  });

  it('serves Vite over HTTPS and proxies same-origin audio to the HTTPS API', async () => {
    const apiUrl = await startApi();
    vi.stubEnv('HTTPS_CERT_FILE', env.HTTPS_CERT_FILE!);
    vi.stubEnv('HTTPS_KEY_FILE', env.HTTPS_KEY_FILE!);
    vi.stubEnv('PORT', new URL(apiUrl).port);
    const web = await createServer({
      configFile: resolve('vite.config.ts'), mode: 'test', clearScreen: false,
      server: { host: '127.0.0.1', port: 0 },
    });
    servers.push(web);
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing Vite listen address');
    const url = 'https://127.0.0.1:' + address.port;
    expect((await request(url + '/')).status).toBe(200);
    expect((await request(url + '/api/health')).status).toBe(200);
    const audio = await request(url + '/api/analyze', {
      method: 'POST', headers: { origin: url, 'content-type': 'audio/wav' },
    }, wav);
    expect(audio.status).toBe(200);
    expect(JSON.parse(audio.body)).toMatchObject({ text: '你好。', emotion: 'happy' });
  });
});
