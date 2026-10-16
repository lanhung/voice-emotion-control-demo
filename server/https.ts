import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

export interface HttpsOptions { cert: Buffer; key: Buffer }

export function readHttpsOptions(env: NodeJS.ProcessEnv = process.env): HttpsOptions | undefined {
  const certFile = env.HTTPS_CERT_FILE?.trim();
  const keyFile = env.HTTPS_KEY_FILE?.trim();
  if (!certFile && !keyFile) return undefined;
  if (!certFile || !keyFile) {
    throw new Error('HTTPS_CERT_FILE 和 HTTPS_KEY_FILE 必须同时设置。');
  }

  try {
    const options = { cert: readFileSync(certFile), key: readFileSync(keyFile) };
    createSecureContext(options);
    return options;
  } catch (cause) {
    throw new Error('无法加载 HTTPS 证书或私钥，请检查路径、权限、格式及证书与私钥是否匹配。', { cause });
  }
}
