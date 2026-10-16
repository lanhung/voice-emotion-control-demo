import { defaultCaptureWindowMs, parseCaptureWindow } from '../../shared/recognition';

declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  abstract process(inputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class AuraCapture extends AudioWorkletProcessor {
  private buffer: Float32Array;
  private offset = 0;
  private levelFrames = 0;
  private sumSquares = 0;
  private peak = 0;

  constructor(options?: { processorOptions?: { windowMs?: number } }) {
    super(options);
    const windowMs = parseCaptureWindow(options?.processorOptions?.windowMs ?? defaultCaptureWindowMs);
    this.buffer = new Float32Array(Math.round(sampleRate * windowMs / 1000));
    this.port.onmessage = (event: MessageEvent<string>) => {
      if (event.data === 'flush') {
        const pendingSamples = this.offset;
        const submittedSamples = pendingSamples >= sampleRate * 0.1 ? pendingSamples : 0;
        if (submittedSamples) this.flush();
        else this.offset = 0;
        this.port.postMessage({ type: 'flushed', submittedSamples, discardedSamples: pendingSamples - submittedSamples, sampleRate });
      }
    };
  }

  private flush() {
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'chunk', samples, sampleRate }, [samples.buffer]);
    this.offset = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.buffer[this.offset++] = sample;
      this.sumSquares += sample * sample;
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.levelFrames++;
      if (this.offset === this.buffer.length) this.flush();
      if (this.levelFrames >= sampleRate / 20) {
        this.port.postMessage({ type: 'level', rms: Math.sqrt(this.sumSquares / this.levelFrames), peak: this.peak });
        this.levelFrames = 0;
        this.sumSquares = 0;
        this.peak = 0;
      }
    }
    // Output stays silent; the microphone is never played through the speakers.
    return true;
  }
}

registerProcessor('aura-capture', AuraCapture);
