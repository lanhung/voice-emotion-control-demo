import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const audio = process.env.TEST_AUDIO_PATH ?? resolve('.artifacts/speech.wav');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 40_000,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1100 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--enable-unsafe-swiftshader',
      ...(existsSync(audio) ? [`--use-file-for-fake-audio-capture=${audio}`] : []),
    ] },
  },
});
