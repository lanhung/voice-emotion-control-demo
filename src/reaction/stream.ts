import type { AnalysisResult } from '../../shared/emotions';
import type { LogEvent } from '../../shared/monitoring';
import { REACTION_ANIMATION_GAP_MS, REACTION_COALESCE_MS, REACTION_DISPLAY_MS, REACTION_MIN_INTERVAL_MS,
  type ReactionPhrase, type ReactionRequest, type ReactionResponse } from '../../shared/reaction';
import { reactionErrorMessages } from './client';
import { appendReactionContext, createReactionContext, reactionContextRequest } from './context';

export type ReactionState = { status: 'idle' } | { status: 'waiting' }
  | { status: 'replied'; text: ReactionPhrase } | { status: 'error'; message: string };
interface StreamOptions {
  request: (input: ReactionRequest, signal: AbortSignal) => Promise<ReactionResponse>;
  onState: (state: ReactionState) => void;
  log: LogEvent;
}

/** Serial requests use fresh bounded context after each reply and its animation interval. */
export class ReactionStream {
  private enabled = false;
  private sessionId: string | null = null;
  private recording = false;
  private context = createReactionContext();
  private generation = 0;
  private pendingAt: number | null = null;
  private lastStartedAt = -Infinity;
  private lastRecognitionAt = -Infinity;
  private animationUntil = -Infinity;
  private controller: AbortController | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ReactionState = { status: 'idle' };

  constructor(private readonly options: StreamOptions) {}

  private show(state: ReactionState) { this.state = state; this.options.onState(state); }
  private cancel() {
    this.generation++;
    this.controller?.abort(); this.controller = null;
    if (this.requestTimer !== null) clearTimeout(this.requestTimer);
    if (this.displayTimer !== null) clearTimeout(this.displayTimer);
    this.requestTimer = null; this.displayTimer = null;
    this.pendingAt = null; this.context = createReactionContext();
    this.lastStartedAt = -Infinity; this.lastRecognitionAt = -Infinity; this.animationUntil = -Infinity;
  }
  reset() {
    this.cancel(); this.sessionId = null; this.recording = false;
    this.show({ status: 'idle' });
  }
  dispose() { this.cancel(); this.sessionId = null; this.recording = false; }
  setEnabled(value: boolean) {
    this.cancel(); this.enabled = value; this.show({ status: 'idle' });
    this.options.log('reaction.settings', value ? '已开启短回应，新的识别结果将自动触发' : '已关闭短回应', { enabled: value });
  }
  begin(sessionId: string) {
    this.reset(); this.sessionId = sessionId; this.recording = true;
  }
  append(sessionId: string, result: AnalysisResult) {
    if (!this.enabled || !this.recording || sessionId !== this.sessionId) return;
    // After a long pause, do not let a previous topic dominate the current expression.
    if (this.pendingAt === null && Date.now() - this.lastRecognitionAt > 15_000) this.context = createReactionContext();
    const outcome = appendReactionContext(this.context, result);
    if (outcome === 'ignored') return;
    if (outcome === 'too_long') {
      this.cancel();
      this.show({ status: 'error', message: '这段识别文字过长，已跳过短回应，可以继续聆听。' });
      this.options.log('reaction.skipped', '识别片段过长，跳过短回应', { reason: 'too_long' }); return;
    }
    this.lastRecognitionAt = Date.now();
    this.pendingAt ??= Date.now() + REACTION_COALESCE_MS;
    this.schedule();
  }
  complete(sessionId: string) {
    if (sessionId !== this.sessionId || !this.recording) return;
    this.recording = false;
    if (this.pendingAt !== null) {
      this.pendingAt = Date.now();
      if (this.requestTimer !== null) clearTimeout(this.requestTimer);
      this.requestTimer = null; this.schedule();
    }
  }

  private schedule() {
    if (!this.enabled || !this.sessionId || this.pendingAt === null || this.controller || this.requestTimer !== null
      || this.state.status === 'replied') return;
    const due = Math.max(this.pendingAt, this.lastStartedAt + REACTION_MIN_INTERVAL_MS, this.animationUntil);
    this.requestTimer = setTimeout(() => { this.requestTimer = null; void this.send(); }, Math.max(0, due - Date.now()));
  }
  private async send() {
    if (!this.enabled || !this.sessionId || this.pendingAt === null || this.controller || this.state.status === 'replied') return;
    const input = reactionContextRequest(this.context, this.sessionId, crypto.randomUUID());
    this.pendingAt = null; this.lastStartedAt = Date.now();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const current = () => generation === this.generation && this.enabled && !controller.signal.aborted;
    this.show({ status: 'waiting' });
    this.options.log('reaction.requested', '识别完成，正在生成短回应', { turnId: input.turnId,
      textLength: input.text.length, contextSegments: this.context.segments.length, trigger: this.recording ? 'recognition' : 'final' });
    try {
      const result = await this.options.request(input, controller.signal);
      if (!current()) return;
      const trace = { turnId: input.turnId, requestId: result.requestId, latencyMs: result.latencyMs };
      if (result.status === 'error') {
        const message = Object.hasOwn(reactionErrorMessages, result.code) ? reactionErrorMessages[result.code] : reactionErrorMessages.unavailable;
        this.showError(message);
        this.options.log('reaction.failed', message, { ...trace, code: result.code }, 'warn'); return;
      }
      const output = result.modelOutput ?? (result.status === 'replied' ? result.text : result.reason === 'none' ? 'NONE' : '');
      this.options.log('reaction.received', `大模型回复：${output || '（空回复）'}`, { ...trace,
        status: result.status, modelOutput: output, outputTruncated: result.outputTruncated ?? false,
        finishReason: result.finishReason, ...(result.status === 'replied' ? { text: result.text } : { reason: result.reason }) });
      if (result.status === 'skipped') {
        this.show({ status: 'idle' });
        this.options.log('reaction.skipped', '本次无需展示短回应', { ...trace, reason: result.reason }); return;
      }
      if (this.displayTimer !== null) clearTimeout(this.displayTimer);
      this.show({ status: 'replied', text: result.text });
      this.options.log('reaction.displayed', `已展示短回应：${result.text}`, { ...trace, text: result.text });
      this.displayTimer = setTimeout(() => {
        this.displayTimer = null;
        if (!current()) return;
        // Start the gap when text actually clears, including after a delayed browser timer.
        // Collect recognition during this time; generate from the latest context afterwards.
        this.animationUntil = Date.now() + REACTION_ANIMATION_GAP_MS;
        this.show({ status: 'idle' });
        this.schedule();
      }, REACTION_DISPLAY_MS);
    } catch (error) {
      if (!current()) return;
      const message = error instanceof Error && error.name === 'TimeoutError' ? reactionErrorMessages.timeout : reactionErrorMessages.unavailable;
      this.showError(message);
      this.options.log('reaction.failed', message, { turnId: input.turnId }, 'warn');
    } finally {
      if (this.controller === controller) { this.controller = null; this.schedule(); }
    }
  }
  private showError(message: string) {
    if (this.displayTimer !== null) clearTimeout(this.displayTimer);
    this.displayTimer = null; this.show({ status: 'error', message });
  }
}
