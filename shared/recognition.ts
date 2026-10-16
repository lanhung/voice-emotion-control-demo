export const recognitionLanguages = ['auto', 'zh', 'en', 'yue', 'ja', 'ko'] as const;
export type RecognitionLanguage = typeof recognitionLanguages[number];
export const recognitionLanguageLabels: Record<RecognitionLanguage, string> = {
  auto: '自动识别', zh: '中文', en: '英语', yue: '粤语', ja: '日语', ko: '韩语',
};

export interface RecognitionOptions {
  language: RecognitionLanguage;
  banUnknownEmotion: boolean;
}
export const defaultRecognitionOptions: Readonly<RecognitionOptions> = { language: 'auto', banUnknownEmotion: true };

export const captureWindows = [2500, 5000] as const;
export type CaptureWindowMs = typeof captureWindows[number];
export const defaultCaptureWindowMs: CaptureWindowMs = 2500;
export interface CaptureSettings extends RecognitionOptions { windowMs: CaptureWindowMs }

export function parseCaptureWindow(value: unknown): CaptureWindowMs {
  if (value === 2500 || value === 5000) return value;
  throw new Error('音频分段仅支持 2.5 秒或 5 秒。');
}
