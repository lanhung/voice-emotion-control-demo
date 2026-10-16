import type { AnalysisResult } from '../../shared/emotions';
import type { LogEvent } from '../../shared/monitoring';
import type { DisplayedRequest, DisplayedResponse, ReactionRequest, ReactionResponse, ReactionReply } from '../../shared/reaction';
import { reactionErrorMessages } from './client';

export type ReactionState = { status: 'idle' } | { status: 'waiting' }
  | { status: 'replied'; text: string; decisionId: string } | { status: 'error'; message: string };
interface StreamOptions {
  request: (input: ReactionRequest, signal: AbortSignal) => Promise<ReactionResponse>;
  acknowledge: (input: DisplayedRequest, signal: AbortSignal) => Promise<DisplayedResponse>;
  onState: (state: ReactionState) => void; log: LogEvent;
}
interface PendingSegment { input: ReactionRequest; receivedAt: number }
interface CurrentDisplay { reply: ReactionReply; painted: boolean; controller: AbortController }

/** Only the current display, active request and latest unsent segment live in the browser. */
export class ReactionStream {
  private readonly clientId = crypto.randomUUID();
  private enabled = false;
  private visible = true;
  private sessionId: string | null = null;
  private recording = false;
  private generation = 0;
  private sequence = 0;
  private animationUntil = -Infinity;
  private pending: PendingSegment | null = null;
  private active: { controller: AbortController; input: ReactionRequest } | null = null;
  private display: CurrentDisplay | null = null;
  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ReactionState = { status: 'idle' };
  constructor(private readonly options: StreamOptions) {}
  private show(state: ReactionState) { this.state = state; this.options.onState(state); }
  private cancel() {
    this.generation++; this.sequence = 0;
    this.active?.controller.abort(); this.active = null; this.pending = null;
    this.clearDisplay(); this.animationUntil = -Infinity;
  }
  private clearDisplay() {
    this.display?.controller.abort(); this.display = null;
    if (this.displayTimer !== null) clearTimeout(this.displayTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.displayTimer = null; this.retryTimer = null;
  }
  reset() { this.cancel(); this.show({ status: 'idle' }); }
  dispose() { this.cancel(); this.recording = false; this.sessionId = null; }
  setVisible(value: boolean) {
    if (value === this.visible) return;
    this.visible = value; this.reset();
  }
  setEnabled(value: boolean) {
    this.cancel(); this.enabled = value; this.show({ status: 'idle' });
    this.options.log('reaction.settings', value ? '已开启情绪陪伴短回应' : '已关闭短回应', { enabled: value });
  }
  begin(sessionId: string) { this.reset(); this.sessionId = sessionId; this.recording = true; }
  complete(sessionId: string) { if (this.sessionId === sessionId) this.recording = false; }
  captureGeneration() { return this.generation; }
  append(sessionId: string, result: AnalysisResult, generation = this.generation) {
    if (!this.enabled || !this.visible || !this.recording || sessionId !== this.sessionId || generation !== this.generation) return;
    const input: ReactionRequest = { clientId: this.clientId, sessionId, generation: this.generation,
      turnId: crypto.randomUUID(), sequence: ++this.sequence, emotion: result.emotion, isSpeech: result.isSpeech, canDisplay: this.canDisplay() };
    this.pending = { input, receivedAt: Date.now() };
    if (this.active && result.isSpeech && this.active.input.emotion !== result.emotion) this.active.controller.abort();
    this.sendLatest();
  }
  private canDisplay() { return this.visible && !this.display && Date.now() >= this.animationUntil; }
  private sendLatest() {
    if (!this.enabled || !this.visible || this.active || !this.pending) return;
    const pending = this.pending; this.pending = null;
    // Never turn a delayed queued recognition into a new decision opportunity.
    if (Date.now() - pending.receivedAt >= 15_000) return;
    const input = { ...pending.input, canDisplay: this.canDisplay() };
    const active = { input, controller: new AbortController() }; this.active = active;
    void this.send(active);
  }
  private async send(active: NonNullable<ReactionStream['active']>) {
    const { input, controller } = active;
    const current = () => input.generation === this.generation && this.enabled && this.visible && !controller.signal.aborted;
    if (!this.display) this.show({ status: 'waiting' });
    this.options.log('reaction.requested', '提交语音情绪，等待服务端选择陪伴短语', {
      turnId: input.turnId, generation: input.generation, sequence: input.sequence, emotion: input.emotion, canDisplay: input.canDisplay });
    try {
      const result = await this.options.request(input, controller.signal);
      if (!current()) return;
      const trace = { turnId: input.turnId, requestId: result.requestId, latencyMs: result.latencyMs };
      if (result.status === 'error') {
        const message = reactionErrorMessages[result.code];
        if (!this.display) this.show({ status: 'error', message });
        this.options.log('reaction.failed', message, { ...trace, code: result.code }, 'warn'); return;
      }
      if (result.status === 'skipped') {
        if (!this.display) this.show({ status: 'idle' });
        this.options.log('reaction.skipped', '本次无需展示陪伴短语', { ...trace, reason: result.reason }); return;
      }
      if (!this.canDisplay() || Date.now() >= result.expiresAt) {
        if (!this.display) this.show({ status: 'idle' });
        return;
      }
      this.display = { reply: result, painted: false, controller: new AbortController() };
      this.show({ status: 'replied', text: result.text, decisionId: result.decisionId });
      this.options.log('reaction.decided', `已选择陪伴短语：${result.text}`, { ...trace, decisionId: result.decisionId, text: result.text });
      // If the renderer cannot paint before expiry, no acknowledgement is sent.
      this.displayTimer = setTimeout(() => this.endDisplay(result.decisionId), Math.max(0, result.expiresAt - Date.now()));
    } catch (error) {
      if (!current()) return;
      const message = error instanceof Error && error.name === 'TimeoutError' ? reactionErrorMessages.decision_timeout : reactionErrorMessages.decision_unavailable;
      if (!this.display) this.show({ status: 'error', message });
      this.options.log('reaction.failed', message, { turnId: input.turnId }, 'warn');
    } finally {
      if (this.active === active) { this.active = null; this.sendLatest(); }
    }
  }
  painted(decisionId: string) {
    const display = this.display;
    if (!display || display.reply.decisionId !== decisionId || display.painted || !this.visible
      || Date.now() >= display.reply.expiresAt || this.state.status !== 'replied') return;
    display.painted = true;
    if (this.displayTimer !== null) clearTimeout(this.displayTimer);
    this.displayTimer = setTimeout(() => this.endDisplay(decisionId), display.reply.displayMs);
    void this.acknowledge(display, 0);
  }
  private endDisplay(decisionId: string) {
    if (this.display?.reply.decisionId !== decisionId) return;
    this.animationUntil = Date.now() + this.display.reply.animationGapMs;
    this.clearDisplay(); this.show({ status: 'idle' });
    // No automatic decisions at timer boundaries: only a new recognition can trigger one.
  }
  private async acknowledge(display: CurrentDisplay, attempt: number) {
    const { reply, controller } = display;
    try {
      const result = await this.options.acknowledge({ clientId: reply.clientId, sessionId: reply.sessionId,
        generation: reply.generation, decisionId: reply.decisionId }, controller.signal);
      if (controller.signal.aborted || this.display !== display) return;
      this.options.log('reaction.displayed', result.status === 'rejected' ? '展示回执已失效' : '陪伴短语展示已确认',
        { decisionId: reply.decisionId, status: result.status });
    } catch {
      if (controller.signal.aborted || this.display !== display || attempt >= 2 || Date.now() >= reply.expiresAt) return;
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.acknowledge(display, attempt + 1); }, 250 * (attempt + 1));
    }
  }
}
