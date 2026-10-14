import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, Circle, CircleHelp, Cpu, Expand,
  Grid3X3, Headphones, LoaderCircle, Mic, Minimize, MoveUpRight, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react';
import { emotions, previewEmotions, type Emotion } from '../shared/emotions';
import { useVoice } from './hooks/useVoice';
import { useHealth } from './hooks/useHealth';
import MonitorPanel, { MicrophoneSelector } from './components/MonitorPanel';
import LightMatrix from './components/LightMatrix';
import type { VisualizationMode, VisualizationProps } from './components/visualization';

const LiquidOrb = lazy(() => import('./components/LiquidOrb'));
const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const dateTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export default function App() {
  const voice = useVoice();
  const health = useHealth();
  const [preview, setPreview] = useState<Emotion | null>(null);
  const [visualization, setVisualization] = useState<VisualizationMode>('orb');
  const [immersive, setImmersive] = useState(false);
  const [copied, setCopied] = useState(false);
  const helpRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const emotion = preview ?? voice.emotion;
  const palette = emotions[emotion];
  const listening = voice.phase === 'listening';
  const busy = voice.phase === 'requesting' || voice.phase === 'finishing';
  const lastEntry = voice.entries.at(-1);
  const language = lastEntry?.language ? ({ zh: '中文', en: '英语', yue: '粤语', ja: '日语', ko: '韩语' }[lastEntry.language] ?? lastEntry.language) : '自动识别';
  const variables = { '--emotion-color': palette.color, '--emotion-secondary': palette.secondary, '--emotion-accent': palette.accent } as CSSProperties;
  const log = voice.log;
  const visualProps: VisualizationProps = { emotion, level: voice.level, active: listening || preview !== null,
    source: preview ? 'preview' : voice.lastResult ? 'sensevoice' : 'idle', onEvent: log };
  const changeVisualization = (mode: VisualizationMode) => {
    if (mode === visualization) return;
    setVisualization(mode);
    log('visual.mode', `切换灯效：${mode === 'matrix' ? '8 × 64 灯光矩阵' : '液态光球'}`, { mode });
  };

  useEffect(() => { log('model.connection', `模型连接状态：${health}`, { status: health }, health === 'unavailable' ? 'warn' : 'info'); }, [health, log]);

  useEffect(() => { if (listening) setPreview(null); }, [listening]);
  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [voice.entries]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setImmersive(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const download = () => {
    const text = voice.entries.map((entry) => `[${dateTime(entry.timestamp)}] ${emotions[entry.emotion].label}\n${entry.text || entry.events.join('、')}`).join('\n\n');
    const url = URL.createObjectURL(new Blob([`Aura · 语音记录\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `aura-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setCopied(true);
  };

  return <div className={`app ${immersive ? 'is-immersive' : ''}`} style={variables}>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Aura 首页"><span className="brand-mark"><AudioLines size={18} strokeWidth={1.6} /></span><span>aura<span className="brand-period">.</span></span></a>
      <div className="header-right">
        <span className={`connection ${health}`} title={health === 'ready' ? '本地 SenseVoice 模型已就绪' : '正在检查本地模型连接'}>
          <span className="status-dot" />{health === 'ready' ? '本地模型已连接' : health === 'checking' ? '正在连接模型' : '本地模型未就绪'}
        </span>
        <span className="header-divider" />
        <button className="icon-button" aria-label="了解 Aura" onClick={() => helpRef.current?.showModal()}><CircleHelp size={19} /></button>
      </div>
    </header>

    <main>
      <section className="experience" aria-label="实时情绪可视化">
        <div className="intro">
          <div className="eyebrow"><span /> VOICE INTO FEELING</div>
          <h1>让情绪，<span>自然流动。</span></h1>
          <p>每一道声音，都有自己的颜色。<br className="mobile-break" /> 说说此刻的心情，看见声音里的你。</p>
        </div>

        <div className="visualizer-switch" role="group" aria-label="灯效显示模式">
          <button type="button" aria-pressed={visualization === 'orb'} onClick={() => changeVisualization('orb')}><Circle size={13} />液态光球</button>
          <button type="button" aria-pressed={visualization === 'matrix'} onClick={() => changeVisualization('matrix')}><Grid3X3 size={13} />灯光矩阵 <span>8 × 64</span></button>
        </div>

        <div className={`orb-stage ${visualization === 'matrix' ? 'matrix-stage' : ''}`}>
          <div className="orb-ambient" aria-hidden="true" />
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          <div className="stage-note"><span className={`live-indicator ${listening ? 'on' : ''}`} />{preview ? '灯效预览' : listening ? '正在聆听' : voice.phase === 'finishing' ? '正在完成识别' : '等待你的声音'}</div>
          <button className="icon-button expand-button" aria-label={immersive ? '退出沉浸模式' : '进入沉浸模式'} title="沉浸模式" onClick={() => setImmersive(!immersive)}>
            {immersive ? <Minimize size={17} /> : <Expand size={17} />}
          </button>
          <Suspense fallback={<div className="orb-loading"><LoaderCircle size={24} className="spin" /></div>}>
            {visualization === 'matrix' ? <LightMatrix {...visualProps} /> : <LiquidOrb {...visualProps} />}
          </Suspense>
          <div className="orb-shadow" aria-hidden="true" />
          <div className="emotion-readout" aria-live="polite">
            <span className="emotion-dot" />
            <span>{palette.label}</span><span className="emotion-english">{palette.english}</span>
          </div>
          <div className="orb-caption">{preview ? `${palette.description} · 效果预览` : palette.description}</div>
        </div>

        <div className="voice-controls">
          <MicrophoneSelector voice={voice} />
          <div className={`recording-capsule ${listening ? 'recording' : ''}`}>
            <div className="input-meter" aria-label={`麦克风音量 ${Math.round(voice.level * 100)}%`}>
              {voice.levels.map((value, index) => <i key={index} style={{ height: `${3 + Math.min(1, value * 2.2) * 22}px`, opacity: 0.3 + (index / 38) * 0.7 }} />)}
            </div>
            <span className="recording-divider" />
            <button className={`record-button ${listening ? 'is-recording' : ''}`} disabled={voice.phase === 'finishing'}
              onClick={() => { if (listening || voice.phase === 'requesting') void voice.stop(); else { setPreview(null); void voice.start(); } }}>
              {busy ? <LoaderCircle className="spin" size={17} /> : listening ? <Square size={13} fill="currentColor" /> : <Mic size={18} />}
              <span>{voice.phase === 'requesting' ? '取消连接' : voice.phase === 'finishing' ? '完成识别中' : listening ? '结束聆听' : '开始聆听'}</span>
            </button>
            <span className="recording-time">{clock(voice.elapsed)}</span>
          </div>
          <p className="recording-hint">
            {listening ? <><span className="hint-live-dot" />{voice.quiet ? '正在等你开口，静音片段不会识别' : voice.processing ? '正在理解你的声音…' : '自在地说，每 2.5 秒感受一次情绪'}</> : <><ShieldCheck size={13} />声音仅在本机处理，不保存录音</>}
          </p>
        </div>

        {voice.error && <div className="error-banner" role="alert"><span>{voice.error}</span><button className="icon-button" aria-label="关闭提示" onClick={voice.dismissError}><X size={16} /></button></div>}
        {health === 'unavailable' && !voice.error && <div className="model-notice" role="status">语音模型正在启动或暂时离线。你可以先体验下方灯效，连接恢复后即可录音。</div>}

        <div className="preview-area">
          <div className="preview-label"><Sparkles size={13} /><span>探索情绪光谱</span><span className="preview-line" /></div>
          <div className="emotion-options" aria-label="情绪灯效预览">
            {previewEmotions.map((key) => <button key={key} className={`emotion-option ${preview === key ? 'selected' : ''}`}
              style={{ '--swatch': emotions[key].color, '--swatch-end': emotions[key].secondary } as CSSProperties}
              disabled={voice.phase !== 'idle'} aria-pressed={preview === key} onClick={() => setPreview(preview === key ? null : key)}>
              <span className="color-swatch" /><span>{emotions[key].label}</span>
            </button>)}
          </div>
          <p className="preview-hint">{preview ? '当前为灯效预览，开始聆听后将跟随真实语音' : listening ? '灯效正跟随你的声音变化' : '轻点一种情绪，预览它的颜色与形态'}</p>
        </div>
      </section>

      <section className="transcript-section" aria-label="语音转写">
        <div className="transcript-heading">
          <div className="transcript-title"><AudioLines size={19} strokeWidth={1.7} /><h2>声音的记录</h2><span className="transcript-count">{voice.entries.length.toString().padStart(2, '0')}</span></div>
          <div className="transcript-actions">
            <span className="transcript-live"><span className={listening ? 'active' : ''} />{listening ? '实时转写' : '语音转写'}</span>
            <button className="icon-button" disabled={!voice.entries.length} aria-label="下载转写记录" title="下载转写记录" onClick={download}>{copied ? <Check size={16} /> : <ArrowDownToLine size={16} />}</button>
            <button className="icon-button" disabled={!voice.entries.length} aria-label="清空转写记录" title="清空转写记录" onClick={voice.clear}><Trash2 size={16} /></button>
          </div>
        </div>
        <div className="transcript-body" ref={transcriptRef} role="log" aria-live="polite" aria-relevant="additions" tabIndex={0}>
          {!voice.entries.length ? <div className="transcript-empty">
            <div className="empty-icon"><AudioLines size={24} strokeWidth={1.3} /></div>
            <p>{listening ? '在听，说说你的此刻。' : '你的每一句，都值得被听见。'}</p>
            <span>{listening ? '识别出的文字和情绪会出现在这里' : '点击「开始聆听」，让声音在这里留下痕迹'}</span>
          </div> : <div className="transcript-entries">
            {voice.entries.map((entry) => <article className="transcript-entry" key={entry.id}>
              <time dateTime={new Date(entry.timestamp).toISOString()}>{dateTime(entry.timestamp)}</time>
              <div className="entry-content"><p>{entry.text || entry.events.join('、')}</p>{entry.events.length > 0 && entry.text && <span className="event-tags">{entry.events.join(' · ')}</span>}</div>
              <span className="entry-emotion" style={{ '--entry-color': emotions[entry.emotion].color } as CSSProperties}><i />{emotions[entry.emotion].label}</span>
            </article>)}
          </div>}
          {voice.processing && <div className="transcribing"><span /><span /><span /><span className="transcribing-label">正在转写</span></div>}
        </div>
        <div className="transcript-footer"><span><ShieldCheck size={12} />仅保留当前页面最近 120 条记录</span><span>{language}<span className="footer-dot">·</span>{voice.latency === null ? '等待语音输入' : `最近推理 ${voice.latency} ms`}</span></div>
      </section>

      <MonitorPanel voice={voice} health={health} displayEmotion={emotion} preview={preview !== null} visualization={visualization} />
      <footer className="site-footer"><span>A little voice. A world of feeling.</span><span><Cpu size={13} /> SenseVoice<span className="footer-dot">/</span>本地驱动<ArrowUpRight size={12} /></span></footer>
    </main>

    <dialog ref={helpRef} className="about-dialog" onClick={(event) => { if (event.target === helpRef.current) helpRef.current.close(); }}>
      <button className="icon-button dialog-close" aria-label="关闭介绍" onClick={() => helpRef.current?.close()}><X size={20} /></button>
      <span className="about-mark"><AudioLines size={28} /></span><div className="eyebrow">MEET AURA</div>
      <h2>声音里，藏着光。</h2><p>Aura 将语音中的情绪，化作会呼吸的液态光球，或 8 × 64 灯光矩阵。</p>
      <div className="about-step"><Headphones size={21} /><div><strong>自在地说</strong><span>允许麦克风，正常说话。每 2.5 秒更新一次转写与情绪，识别结果还需少量推理时间。</span></div></div>
      <div className="about-step"><Sparkles size={21} /><div><strong>看见情绪</strong><span>在液态光球与灯光矩阵之间自由切换，颜色与律动跟随语音情绪变化。你也可以在开麦前，轻点情绪按钮预览灯效。</span></div></div>
      <div className="about-step"><ShieldCheck size={21} /><div><strong>留在本地</strong><span>声音在本地 SenseVoice 模型处理，不上传云端，也不保存录音。转写仅在当前页面保留。</span></div></div>
      <p className="about-note">情绪标签是模型对当前声音片段的判断，仅用于演示。无法判断时会显示「待辨识」。</p>
      <button className="about-done" onClick={() => helpRef.current?.close()}>开始体验 <MoveUpRight size={16} /></button>
    </dialog>
    <a className="scroll-cue" href="#root" aria-hidden="true" tabIndex={-1}><ChevronDown size={15} /></a>
  </div>;
}
