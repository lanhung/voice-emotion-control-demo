import { Ollama } from 'ollama';
import { validateLayaResponse, type LayaConfig } from './laya';

type SetupEvent = { event: string; model: string; status?: string };
type SetupLogger = (event: SetupEvent) => void;

function clientWithTimeout(host: string, timeoutMs: number): Ollama {
  return new Ollama({ host, fetch: (url, options) => fetch(url, {
    ...options,
    signal: options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  }) });
}

/** Prepare the persistent model store and verify real inference before Web starts. */
export async function prepareLayaModel(config: LayaConfig, log: SetupLogger): Promise<void> {
  const { host, model } = config;
  try {
    await clientWithTimeout(host, 30_000).show({ model });
    log({ event: 'model.cached', model });
  } catch (error) {
    // A missing model is recoverable; connectivity and server errors must fail setup.
    if (!(error instanceof Error) || !('status_code' in error) || error.status_code !== 404) throw error;
    log({ event: 'model.downloading', model });
    const progress = await clientWithTimeout(host, 30 * 60_000).pull({ model, stream: true });
    let lastStatus: string | undefined;
    for await (const part of progress) {
      if (part.status !== lastStatus) {
        lastStatus = part.status;
        log({ event: 'model.download', model, status: part.status });
      }
    }
  }

  // `show`/`list` alone cannot detect a missing MLX/CUDA runtime or incompatible GPU.
  log({ event: 'model.checking', model });
  // First use can also compile CUDA kernels; keep this separate from UI deadlines.
  const response = await clientWithTimeout(host, 5 * 60_000).systemone({
    model, state: { purpose: 'startup readiness check', emotion: 'happy' },
    questions: { phrase: { type: 'choice', instructions: 'Choose supportive wording for this acoustic emotion.',
      criteria: { a: 'Well done!', b: 'Stay close.' } } },
    keep_alive: -1,
  });
  validateLayaResponse(response, model, ['a', 'b']);
  log({ event: 'model.ready', model });
}
