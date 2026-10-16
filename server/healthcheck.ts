import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { readHttpsOptions } from './https';

const https = readHttpsOptions();
const get = https ? httpsGet : httpGet;
const request = get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  path: '/api/health',
  timeout: 4000,
  ...(https ? { ca: https.cert } : {}),
}, (response) => {
  response.resume();
  process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('error', () => { process.exitCode = 1; });
request.on('timeout', () => { request.destroy(new Error('Health check timed out')); });
