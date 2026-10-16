import type { RecognitionOptions } from './recognition';

export const emotions = {
  neutral: { label: '平静', english: 'Calm', color: '#08b5b8', secondary: '#20e3b2', accent: '#20cbd9', description: '青绿呼吸，缓缓流动', speed: 0.8, distort: 0.26 },
  happy: { label: '愉悦', english: 'Joy', color: '#ff9f00', secondary: '#ff6414', accent: '#ffdb38', description: '金橙光芒，轻盈跃动', speed: 2.4, distort: 0.48 },
  sad: { label: '低落', english: 'Melancholy', color: '#235bff', secondary: '#172caa', accent: '#4899ff', description: '深蓝涟漪，慢慢舒展', speed: 0.45, distort: 0.30 },
  angry: { label: '愤怒', english: 'Intensity', color: '#f51e3b', secondary: '#ff4921', accent: '#ae092b', description: '炽红光芒，强烈涌动', speed: 4.3, distort: 0.72 },
  surprised: { label: '惊讶', english: 'Wonder', color: '#f529c0', secondary: '#ff6aac', accent: '#c529e9', description: '玫红闪耀，向外绽放', speed: 3.0, distort: 0.58 },
  fearful: { label: '紧张', english: 'Tension', color: '#7735ef', secondary: '#4d169c', accent: '#a75cf7', description: '深紫波动，微微颤动', speed: 3.8, distort: 0.44 },
  disgusted: { label: '厌恶', english: 'Aversion', color: '#50ad13', secondary: '#a0d61b', accent: '#177d32', description: '酸绿流转，收拢起伏', speed: 1.4, distort: 0.52 },
  unknown: { label: '待辨识', english: 'Uncertain', color: '#78859b', secondary: '#a7afbf', accent: '#565f75', description: '继续倾听，等待下一句', speed: 0.4, distort: 0.16 },
} as const;

export type Emotion = keyof typeof emotions;
export const previewEmotions: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'];

export interface AnalysisResult {
  text: string;
  emotion: Emotion;
  language: string | null;
  events: string[];
  isSpeech: boolean;
  latencyMs: number;
  durationMs: number;
  tags: string[];
  emotionTag: string | null;
  recognitionOptions?: RecognitionOptions;
  trace?: {
    requestId: string;
    sessionId: string;
    sequence: number;
    receivedAt: string;
    serverMs: number;
  };
  inference?: { inferenceMs: number; queueMs: number };
}

export interface TranscriptEntry extends AnalysisResult {
  id: string;
  timestamp: number;
}

export interface HealthResponse {
  status: 'ready' | 'unavailable';
  model: 'SenseVoiceSmall';
  intervalMs: number;
}
