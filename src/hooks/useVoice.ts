import { useCallback, useEffect, useRef, useState } from 'react';
import processorUrl from '../audio/processor.ts?worker&url';
import { encodeWav, resample } from '../audio/wav';
import { emotions, type AnalysisResult, type Emotion, type TranscriptEntry } from '../../shared/emotions';
import { emptyMetrics, measureSignal, toDbfs, type InputDeviceInfo, type VoiceMetrics } from '../../shared/monitoring';
import { useMonitor } from './useMonitor';
import { useReaction } from './useReaction';
import { defaultCaptureWindowMs, defaultRecognitionOptions, type CaptureSettings } from '../../shared/recognition';

type Phase = 'idle' | 'requesting' | 'listening' | 'finishing';
type AudioMessage = { type: 'level'; rms: number; peak: number }
  | { type: 'chunk'; samples: Float32Array; sampleRate: number }
  | { type: 'flushed'; submittedSamples: number; discardedSamples: number; sampleRate: number };
interface Capture { context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; node: AudioWorkletNode; gain: GainNode }
interface AudioWindow { wav: ArrayBuffer; sequence: number; capturedAt: number; durationMs: number; settings: CaptureSettings }

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '麦克风权限未开启。请在浏览器地址栏允许使用麦克风，然后重试。';
    if (error.name === 'NotFoundError') return '没有找到麦克风，请连接输入设备后重试。';
    if (error.name === 'NotReadableError') return '无法打开麦克风，它可能正被其他应用占用。';
    if (error.name === 'OverconstrainedError') return '所选麦克风不可用，请重新选择输入设备。';
  }
  return error instanceof Error ? error.message : '麦克风启动失败，请重新尝试。';
}

export function useVoice() {
  const { events, log, clearLogs, exportLogs, sessionIdRef } = useMonitor();
  const reaction = useReaction(log);
  const { begin: beginReaction, append: appendReaction, complete: completeReaction, reset: resetReaction, captureGeneration: captureReactionGeneration } = reaction;
  const [phase, setPhase] = useState<Phase>('idle');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(38).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [autoGain, setAutoGain] = useState(false);
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>({ ...defaultRecognitionOptions, windowMs: defaultCaptureWindowMs });
  const [thresholdDb, setThresholdDbState] = useState(-55);
  const [skipSilence, setSkipSilenceState] = useState(true);
  const [inputInfo, setInputInfo] = useState<InputDeviceInfo | null>(null);
  const [signal, setSignal] = useState({ rms: 0, peak: 0, dbfs: -96 });
  const [lastResult, setLastResult] = useState<AnalysisResult | null>(null);
  const [metrics, setMetrics] = useState<VoiceMetrics>(emptyMetrics);
  const metricsRef = useRef(emptyMetrics());
  const thresholdRef = useRef(-55);
  const skipSilenceRef = useRef(true);
  const signalRef = useRef(signal);
  const lastFrameRef = useRef(0);
  const emotionRef = useRef<Emotion>('neutral');
  const captureRef = useRef<Capture | null>(null);
  const sessionRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const queueRef = useRef<AudioWindow[]>([]);
  const processingRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const flushRef = useRef<(() => void) | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateCaptureSettings = useCallback((patch: Partial<CaptureSettings>) => {
    if (phaseRef.current !== 'idle') return;
    setCaptureSettings((current) => ({ ...current, ...patch }));
    log('settings.recognition', '识别设置已调整，下次开麦生效', patch);
  }, [log]);

  const updateMetrics = useCallback((patch: Partial<VoiceMetrics>) => {
    metricsRef.current = { ...metricsRef.current, ...patch }; setMetrics(metricsRef.current);
  }, []);
  const updatePhase = useCallback((value: Phase) => {
    log('session.state', `录音状态：${phaseRef.current} → ${value}`, { from: phaseRef.current, to: value });
    phaseRef.current = value; setPhase(value);
  }, [log]);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')); }
    catch (err) { log('mic.enumeration_failed', '无法读取麦克风列表', { reason: String(err) }, 'warn'); }
  }, [log]);
  const release = useCallback(async () => {
    const capture = captureRef.current;
    const session = sessionRef.current;
    captureRef.current = null;
    if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
    setInputInfo((current) => current ? { ...current, state: 'closed' } : null);
    signalRef.current = { rms: 0, peak: 0, dbfs: -96 };
    setLevel(0); setSignal(signalRef.current);
    if (capture) {
      capture.stream.getTracks().forEach((track) => { track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); });
      capture.node.port.onmessage = null; capture.node.onprocessorerror = null; capture.context.onstatechange = null;
      capture.source.disconnect(); capture.node.disconnect(); capture.gain.disconnect();
      await capture.context.close().catch(() => undefined);
      if (session === sessionRef.current) log('mic.released', '麦克风与音频处理器已释放');
    }
  }, [log]);

  const fail = useCallback((message: string, details: Record<string, unknown> = {}) => {
    log('session.error', message, details, 'error');
    resetReaction();
    sessionRef.current++;
    abortRef.current?.abort(); queueRef.current = []; processingRef.current = null;
    updateMetrics({ queued: 0 }); flushRef.current?.(); flushRef.current = null;
    void release(); setError(message); setProcessing(false); updatePhase('idle');
  }, [log, release, resetReaction, updateMetrics, updatePhase]);

  const pump = useCallback((session: number) => {
    if (processingRef.current) return;
    const task = async () => {
      setProcessing(true);
      let currentSequence = 0;
      try {
        while (queueRef.current.length && session === sessionRef.current) {
          const chunk = queueRef.current.shift()!;
          currentSequence = chunk.sequence;
          const sentAt = performance.now();
          updateMetrics({ queued: queueRef.current.length, submitted: metricsRef.current.submitted + 1 });
          log('request.sent', `#${chunk.sequence} 音频已提交`, { sequence: chunk.sequence, bytes: chunk.wav.byteLength,
            durationMs: chunk.durationMs, settings: chunk.settings,
            queueWaitMs: Math.round(sentAt - chunk.capturedAt), queued: queueRef.current.length });
          const controller = new AbortController(); abortRef.current = controller;
          const reactionGeneration = captureReactionGeneration();
          const response = await fetch('/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Aura-Session': sessionIdRef.current!, 'X-Aura-Sequence': String(chunk.sequence),
              'X-Aura-Language': chunk.settings.language, 'X-Aura-Ban-Emo-Unk': String(chunk.settings.banUnknownEmotion) }, body: chunk.wav,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string; requestId?: string };
            log('request.failed', `#${chunk.sequence} 请求失败：HTTP ${response.status}`, { sequence: chunk.sequence, requestId: body.requestId ?? response.headers.get('x-request-id'), error: body.error }, 'error');
            throw new Error(body.error ?? '语音识别连接中断，请重新开始。');
          }
          const result = await response.json() as AnalysisResult;
          if (session !== sessionRef.current) return;
          appendReaction(sessionIdRef.current!, result, reactionGeneration);
          const roundTripMs = Math.round(performance.now() - sentAt);
          setLatency(result.latencyMs); setLastResult(result);
          updateMetrics({ completed: metricsRef.current.completed + 1, lastSequence: chunk.sequence, roundTripMs });
          log('recognition.result', `#${chunk.sequence} ${result.emotionTag ?? '无情绪标签'} → ${emotions[result.emotion].label}`, {
            sequence: chunk.sequence, requestId: result.trace?.requestId, tags: result.tags, emotion: result.emotion,
            text: result.text, isSpeech: result.isSpeech, events: result.events, roundTripMs, upstreamMs: result.latencyMs,
            serverMs: result.trace?.serverMs, recognitionOptions: result.recognitionOptions, ...result.inference,
          });
          if (result.isSpeech || result.events.length) {
            const same = emotionRef.current === result.emotion && metricsRef.current.sameEmotionCount > 0;
            updateMetrics({ sameEmotionCount: same ? metricsRef.current.sameEmotionCount + 1 : 1 });
            log(same ? 'emotion.unchanged' : 'emotion.changed', same
              ? `模型连续 ${metricsRef.current.sameEmotionCount} 段返回${emotions[result.emotion].label}，保持主色`
              : `应用情绪：${emotions[emotionRef.current].label} → ${emotions[result.emotion].label}`, {
              sequence: chunk.sequence, requestId: result.trace?.requestId, previous: emotionRef.current, emotion: result.emotion,
              color: emotions[result.emotion].color, source: 'sensevoice', sameEmotionCount: metricsRef.current.sameEmotionCount,
            });
            emotionRef.current = result.emotion; setEmotion(result.emotion);
            setEntries((previous) => [...previous, { ...result, id: crypto.randomUUID(), timestamp: Date.now() }].slice(-120));
          } else {
            log('recognition.empty', `#${chunk.sequence} 模型未检出语音或声音事件，保留当前灯效`, { sequence: chunk.sequence, tags: result.tags });
          }
        }
      } catch (err) {
        if (session === sessionRef.current) {
          updateMetrics({ failed: metricsRef.current.failed + 1 });
          fail(err instanceof Error && err.name === 'TimeoutError' ? '模型响应超时，录音已停止。请稍后重试。'
            : err instanceof Error ? err.message : '语音识别连接中断，请重新开始。', { sequence: currentSequence });
        }
      } finally {
        if (session === sessionRef.current) { processingRef.current = null; setProcessing(false); }
      }
    };
    processingRef.current = task();
  }, [appendReaction, captureReactionGeneration, fail, log, sessionIdRef, updateMetrics]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message = '浏览器需要安全连接才能录音。请在本机使用 http://localhost:3000，或通过 HTTPS 访问。';
      setError(message); log('mic.unsupported', message, { secureContext: window.isSecureContext }, 'error'); return;
    }
    const session = ++sessionRef.current;
    const sessionSettings = { ...captureSettings };
    sessionIdRef.current = crypto.randomUUID(); updateMetrics(emptyMetrics()); setLastResult(null);
    beginReaction(sessionIdRef.current);
    log('session.started', '开始真实麦克风采集', { intervalMs: sessionSettings.windowMs, settings: sessionSettings,
      thresholdDb: thresholdRef.current, skipSilence: skipSilenceRef.current, autoGainControl: autoGain, secureContext: window.isSecureContext });
    updatePhase('requesting'); setQuiet(false); setElapsed(0); setLevels(Array(38).fill(0));
    let context: AudioContext | undefined;
    let stream: MediaStream | undefined;
    try {
      context = new AudioContext({ latencyHint: 'interactive' }); await context.resume();
      log('mic.permission_request', '请求麦克风权限', { selection: selectedDeviceId ? 'selected-device' : 'system-default' });
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: autoGain,
      } });
      if (session !== sessionRef.current) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return; }
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      const info: InputDeviceInfo = { label: track.label || '系统麦克风', captureRate: context.sampleRate,
        trackRate: settings.sampleRate ?? null, channels: settings.channelCount ?? null,
        echoCancellation: settings.echoCancellation ?? null, noiseSuppression: settings.noiseSuppression ?? null,
        autoGainControl: settings.autoGainControl ?? null, state: context.state };
      setInputInfo(info); log('mic.ready', `麦克风已连接：${info.label}`, { ...info, trackState: track.readyState, muted: track.muted });
      void refreshDevices();
      await context.audioWorklet.addModule(processorUrl);
      if (session !== sessionRef.current) { stream.getTracks().forEach((audioTrack) => audioTrack.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'aura-capture', { channelCount: 1, processorOptions: { windowMs: sessionSettings.windowMs } });
      const gain = context.createGain(); gain.gain.value = 0;
      captureRef.current = { context, stream, source, node, gain };
      context.onstatechange = () => {
        if (session !== sessionRef.current || !captureRef.current) return;
        const state = captureRef.current.context.state;
        setInputInfo((value) => value ? { ...value, state } : value);
        log('audio.context_state', `音频处理器：${state}`, { state }, state === 'running' ? 'info' : 'warn');
      };
      let sequence = 0;
      node.port.onmessage = (event: MessageEvent<AudioMessage>) => {
        if (session !== sessionRef.current) return;
        const message = event.data;
        if (message.type === 'level') {
          lastFrameRef.current = Date.now();
          signalRef.current = { rms: message.rms, peak: message.peak, dbfs: toDbfs(message.rms) }; setSignal(signalRef.current);
          const strength = Math.min(1, Math.sqrt(message.rms) * 1.8);
          setLevel(strength); setLevels((values) => [...values.slice(1), strength]);
        } else if (message.type === 'chunk') {
          sequence++;
          const measured = measureSignal(message.samples);
          const durationMs = Math.round(message.samples.length / message.sampleRate * 1000);
          const silent = skipSilenceRef.current && measured.dbfs < thresholdRef.current;
          setQuiet(silent); updateMetrics({ captured: metricsRef.current.captured + 1 });
          log('audio.window', `#${sequence} 采集 ${durationMs} ms · ${measured.dbfs} dBFS`, {
            sequence, durationMs, sampleRate: message.sampleRate, samples: message.samples.length, ...measured,
            thresholdDb: thresholdRef.current, skipSilence: skipSilenceRef.current,
          });
          if (measured.clippedPercent > 1) log('audio.clipping', `#${sequence} 输入过响，建议远离麦克风或降低输入增益`, { sequence, clippedPercent: measured.clippedPercent }, 'warn');
          if (silent) {
            updateMetrics({ skipped: metricsRef.current.skipped + 1 });
            log('audio.skipped', `#${sequence} 低于静音门限，未提交模型`, { sequence, dbfs: measured.dbfs, thresholdDb: thresholdRef.current }); return;
          }
          if (queueRef.current.length >= 4) { fail('模型处理速度暂时跟不上录音，已停止采集。请稍后重新开始。', { sequence, queued: queueRef.current.length }); return; }
          const wav = encodeWav(resample(message.samples, message.sampleRate));
          queueRef.current.push({ wav, sequence, capturedAt: performance.now(), durationMs, settings: sessionSettings });
          updateMetrics({ queued: queueRef.current.length }); pump(session);
        } else {
          log('audio.flushed', message.submittedSamples > 0 ? '末尾音频已送入片段处理流程'
            : message.discardedSamples > 0 ? '末尾不足 100 ms，已丢弃；无需提交' : '音频缓冲区已清空，无剩余片段', {
            submittedSamples: message.submittedSamples, discardedSamples: message.discardedSamples,
            durationMs: Math.round(message.submittedSamples / message.sampleRate * 1000),
          });
          flushRef.current?.(); flushRef.current = null;
        }
      };
      node.onprocessorerror = () => fail('音频采集发生错误，请重新开始。');
      stream.getAudioTracks().forEach((audioTrack) => {
        audioTrack.onended = () => fail('麦克风已断开，请检查输入设备。');
        audioTrack.onmute = () => log('mic.muted', '麦克风输入被系统暂停', {}, 'warn');
        audioTrack.onunmute = () => log('mic.unmuted', '麦克风输入已恢复');
      });
      source.connect(node); node.connect(gain); gain.connect(context.destination);
      log('audio.worklet_ready', '实时音频处理器已启动；输出为 16 kHz 单声道 WAV', { captureRate: context.sampleRate, targetRate: 16000, intervalMs: sessionSettings.windowMs });
      updatePhase('listening');
      const started = Date.now(); lastFrameRef.current = started;
      let stalled = false;
      clockRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - started) / 1000));
        const frameAgeMs = Date.now() - lastFrameRef.current;
        if (frameAgeMs > 4000 && !stalled) { log('audio.stalled', '超过 4 秒没有收到音频帧，请检查麦克风或浏览器音频状态', { frameAgeMs, contextState: captureRef.current?.context.state }, 'warn'); stalled = true; }
        if (frameAgeMs < 2000) stalled = false;
        log('audio.level', `输入音量 ${signalRef.current.dbfs} dBFS`, { ...signalRef.current, frameAgeMs, queued: queueRef.current.length });
      }, 1000);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== 'closed') await context.close().catch(() => undefined);
      if (session === sessionRef.current) fail(microphoneError(err), { errorType: err instanceof Error ? err.name : 'Unknown' });
    }
  }, [autoGain, beginReaction, captureSettings, fail, log, pump, refreshDevices, selectedDeviceId, sessionIdRef, updateMetrics, updatePhase]);

  const stop = useCallback(async () => {
    if (phaseRef.current === 'requesting') { fail('已取消麦克风连接。'); return; }
    if (phaseRef.current !== 'listening') return;
    const session = sessionRef.current;
    log('session.stopping', '停止采集，等待剩余片段完成', { ...metricsRef.current }); updatePhase('finishing');
    const capture = captureRef.current;
    capture?.stream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    if (capture) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          log('audio.flush_timeout', '音频处理器未及时确认最后一段，取消待处理的短回应', {}, 'warn');
          resetReaction(); flushRef.current = null; resolve();
        }, 350);
        flushRef.current = () => { clearTimeout(timer); resolve(); }; capture.node.port.postMessage('flush');
      });
    }
    await release(); await processingRef.current;
    if (session === sessionRef.current) {
      updatePhase('idle'); log('session.completed', '本次录音处理完成', { ...metricsRef.current });
      completeReaction(sessionIdRef.current!);
    }
  }, [completeReaction, fail, log, release, resetReaction, sessionIdRef, updatePhase]);

  useEffect(() => {
    void refreshDevices(); navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);
  useEffect(() => () => { sessionRef.current++; abortRef.current?.abort(); queueRef.current = []; void release(); }, [release]);

  return { phase, entries, emotion, error, level, levels, elapsed, processing, latency, quiet, start, stop, reaction,
    events, log, clearLogs, exportLogs, signal, metrics, inputInfo, lastResult, sessionId: sessionIdRef.current,
    devices, selectedDeviceId, setSelectedDeviceId, autoGain, setAutoGain, refreshDevices, thresholdDb, skipSilence,
    captureSettings, updateCaptureSettings,
    setThresholdDb: (value: number) => { thresholdRef.current = value; setThresholdDbState(value); log('settings.threshold', `静音门限调整为 ${value} dBFS`, { thresholdDb: value }); },
    setSkipSilence: (value: boolean) => { skipSilenceRef.current = value; setSkipSilenceState(value); log('settings.silence', value ? '开启静音过滤' : '关闭静音过滤，每段都送入模型', { skipSilence: value }); },
    clear: () => { resetReaction(); setEntries([]); setLatency(null); log('transcript.cleared', '已清空页面转写记录'); }, dismissError: () => setError(null) };
}
