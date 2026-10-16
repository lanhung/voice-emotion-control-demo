import { z } from 'zod';
import type { AnalysisResult, Emotion } from '../shared/emotions';
import { defaultRecognitionOptions, recognitionLanguages, type RecognitionOptions } from '../shared/recognition';

const responseSchema = z.object({
  result: z.array(z.object({ raw_text: z.string().optional(), text: z.string().optional() })),
  timings: z.object({ inferenceMs: z.number().nonnegative(), queueMs: z.number().nonnegative() }).optional(),
  recognitionOptions: z.object({ language: z.enum(recognitionLanguages), banUnknownEmotion: z.boolean() }).optional(),
});

const emotionTags: Record<string, Emotion> = {
  NEUTRAL: 'neutral', HAPPY: 'happy', SAD: 'sad', ANGRY: 'angry',
  SURPRISED: 'surprised', FEARFUL: 'fearful', DISGUSTED: 'disgusted',
  EMO_UNKNOWN: 'unknown', OTHER: 'unknown',
};
const eventTags: Record<string, string> = {
  Laughter: '笑声', Cry: '哭声', BGM: '音乐', Applause: '掌声',
  Cough: '咳嗽', Sneeze: '喷嚏', Breath: '呼吸声', Sing: '歌声', Speech_Noise: '语音噪声',
};

export function parseRecognition(data: unknown): Omit<AnalysisResult, 'latencyMs' | 'durationMs'> {
  const parsed = responseSchema.parse(data);
  const result = parsed.result;
  const raw = result.map((item) => item.raw_text ?? item.text ?? '').join('');
  const tags = Array.from(raw.matchAll(/<\|([^|]+)\|>/g), (match) => match[1]);
  const emotionTag = tags.find((tag) => tag in emotionTags);
  const language = tags.find((tag) => ['zh', 'en', 'yue', 'ja', 'ko'].includes(tag)) ?? null;
  const text = raw.replace(/<\|[^|]*\|>/g, '').trim();
  return {
    text: tags.includes('nospeech') ? '' : text,
    emotion: emotionTag ? emotionTags[emotionTag] : 'unknown',
    language,
    events: [...new Set(tags.filter((tag) => tag in eventTags).map((tag) => eventTags[tag]))],
    isSpeech: !tags.includes('nospeech') && text.length > 0,
    tags,
    emotionTag: emotionTag ?? null,
    ...(parsed.timings ? { inference: parsed.timings } : {}),
    ...(parsed.recognitionOptions ? { recognitionOptions: parsed.recognitionOptions } : {}),
  };
}

/** The browser sends a canonical little-endian PCM WAV, never encoded media. */
export function wavDuration(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.toString('ascii', 12, 16) !== 'fmt ' ||
      buffer.readUInt32LE(16) !== 16 || buffer.readUInt16LE(20) !== 1 ||
      buffer.readUInt16LE(22) !== 1 || buffer.readUInt32LE(24) !== 16000 ||
      buffer.readUInt32LE(28) !== 32000 || buffer.readUInt16LE(32) !== 2 ||
      buffer.readUInt16LE(34) !== 16 || buffer.toString('ascii', 36, 40) !== 'data' ||
      buffer.readUInt32LE(40) !== buffer.length - 44 || buffer.readUInt32LE(4) !== buffer.length - 8 ||
      (buffer.length - 44) % 2 !== 0) {
    throw new Error('Expected a 16 kHz mono PCM16 WAV');
  }
  const duration = (buffer.length - 44) / 32;
  if (duration < 100 || duration > 5000) throw new Error('Audio must be 0.1–5 seconds');
  return duration;
}

export async function recognize(audio: Buffer, url: string, signal: AbortSignal,
  trace?: { requestId: string; sessionId: string; sequence: number },
  onStage?: (event: string, fields: Record<string, unknown>) => void,
  options: RecognitionOptions = defaultRecognitionOptions,
): Promise<AnalysisResult> {
  const durationMs = wavDuration(audio);
  const form = new FormData();
  form.set('files', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'microphone.wav');
  form.set('lang', options.language);
  form.set('ban_emo_unk', String(options.banUnknownEmotion));
  form.set('use_itn', 'true');
  const started = performance.now();
  onStage?.('inference.dispatch', { audioBytes: audio.length, durationMs, recognitionOptions: options });
  const response = await fetch(`${url}/api/v1/asr`, { method: 'POST', body: form, signal,
    headers: trace ? { 'x-request-id': trace.requestId, 'x-aura-session': trace.sessionId, 'x-aura-sequence': String(trace.sequence) } : undefined });
  onStage?.('inference.response', { httpStatus: response.status, upstreamMs: Math.round(performance.now() - started) });
  if (!response.ok) throw new Error(`SenseVoice returned ${response.status}`);
  const result = parseRecognition(await response.json());
  return { ...result, durationMs, latencyMs: Math.round(performance.now() - started) };
}
