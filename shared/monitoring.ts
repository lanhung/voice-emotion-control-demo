export type LogLevel = 'info' | 'warn' | 'error';
export interface MonitorEvent {
  id: number;
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  sessionId: string | null;
  details: Record<string, unknown>;
}
export type LogEvent = (event: string, message: string, details?: Record<string, unknown>, level?: LogLevel) => void;
export interface SignalMetrics { rms: number; peak: number; dbfs: number; clippedPercent: number }
export const toDbfs = (rms: number) => Math.max(-96, Math.round(20 * Math.log10(Math.max(rms, 0.000001)) * 10) / 10);

export function measureSignal(samples: ArrayLike<number>): SignalMetrics {
  let power = 0; let peak = 0; let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.abs(samples[i]);
    power += sample * sample; peak = Math.max(peak, sample);
    if (sample >= 0.99) clipped++;
  }
  const rms = Math.sqrt(power / Math.max(1, samples.length));
  return { rms, peak, dbfs: toDbfs(rms), clippedPercent: Math.round(clipped / Math.max(1, samples.length) * 10000) / 100 };
}

export interface VoiceMetrics {
  captured: number;
  skipped: number;
  submitted: number;
  completed: number;
  failed: number;
  queued: number;
  lastSequence: number | null;
  roundTripMs: number | null;
  sameEmotionCount: number;
}
export const emptyMetrics = (): VoiceMetrics => ({ captured: 0, skipped: 0, submitted: 0, completed: 0, failed: 0, queued: 0, lastSequence: null, roundTripMs: null, sameEmotionCount: 0 });

export interface InputDeviceInfo {
  label: string;
  captureRate: number;
  trackRate: number | null;
  channels: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  state: string;
}
