import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ChevronDown, Mic, RefreshCw, Trash2 } from 'lucide-react';
import type { useVoice } from '../hooks/useVoice';
import { emotions, type Emotion } from '../../shared/emotions';

interface MonitorProps { voice: ReturnType<typeof useVoice>; health: string; displayEmotion: Emotion; preview: boolean }
export default function MonitorPanel({ voice, health, displayEmotion, preview }: MonitorProps) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const last = voice.lastResult;
  const m = voice.metrics;
  const filtered = voice.events.filter((entry) => filter === 'all' || (filter === 'errors' ? entry.level !== 'info'
    : filter === 'model' ? ['request', 'recognition', 'emotion'].some((prefix) => entry.event.startsWith(prefix))
    : entry.event.startsWith(filter))).slice(-120);
  const rendered = [...voice.events].reverse().find((entry) => entry.event === 'visual.applied');
  const renderedCurrent = rendered?.details.emotion === displayEmotion;
  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [voice.events, follow, open, filter]);

  return <section className="monitor-panel" aria-label="实时监控">
    <div className="monitor-heading">
      <button className="monitor-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="monitor-content">
        <Activity size={18} /><span>实时监控</span><span className={`monitor-live ${voice.phase === 'listening' ? 'on' : ''}`}>{voice.phase === 'listening' ? 'LIVE' : 'READY'}</span>
        <ChevronDown size={16} className={open ? 'is-open' : ''} />
      </button>
      <div className="monitor-tools">
        <button disabled={!voice.events.length} onClick={voice.exportLogs} aria-label="导出监控日志"><ArrowDownToLine size={14} />导出日志</button>
        <button className="icon-button" disabled={!voice.events.length} onClick={voice.clearLogs} aria-label="清空监控日志"><Trash2 size={14} /></button>
      </div>
    </div>
    {open && <div id="monitor-content">
      <div className="monitor-stages">
        <span className={voice.phase === 'listening' ? 'active' : ''}><i />麦克风 {voice.inputInfo?.state === 'running' ? '采集中' : '未采集'}</span><b>→</b>
        <span><i />2.5 秒分段</span><b>→</b><span className={health === 'ready' ? 'active' : ''}><i />SenseVoice {health === 'ready' ? '就绪' : '未连接'}</span><b>→</b>
        <span className={renderedCurrent ? 'active' : ''}><i />灯效 {renderedCurrent ? '已应用' : '切换中'}</span>
      </div>
      <div className="monitor-metrics">
        <div><span>输入电平</span><strong data-testid="input-db">{voice.phase === 'listening' ? voice.signal.dbfs.toFixed(1) : '—'} <small>dBFS</small></strong>
          <div className="db-meter"><i style={{ width: `${Math.max(0, Math.min(100, (voice.signal.dbfs + 80) / 80 * 100))}%` }} /><b style={{ left: `${(voice.thresholdDb + 80) / 80 * 100}%` }} /></div>
        </div>
        <div><span>采集 / 提交 / 返回</span><strong>{m.captured} <small>/</small> {m.submitted} <small>/</small> {m.completed}</strong><small>静音跳过 {m.skipped} · 排队 {m.queued} · 失败 {m.failed}</small></div>
        <div><span>模型推理 / 请求往返</span><strong>{last?.inference?.inferenceMs ?? '—'} <small>/</small> {m.roundTripMs ?? '—'} <small>ms</small></strong><small>上次片段 {m.lastSequence ? `#${m.lastSequence}` : '—'}</small></div>
        <div><span>模型原始情绪标签</span><strong className="tag-value" data-testid="model-emotion-tag">{last?.emotionTag ?? '等待语音'}</strong><small>显示：{emotions[displayEmotion].label} · {preview ? '手动预览' : last ? '语音识别' : '初始灯效'}</small></div>
      </div>
      <div className="monitor-device"><Mic size={14} /><span>{voice.inputInfo?.label ?? '开麦后显示实际输入设备'}</span>
        <span>{voice.inputInfo ? `${voice.inputInfo.captureRate} Hz → 16000 Hz · ${voice.inputInfo.channels ?? 1} 声道 · AGC ${voice.inputInfo.autoGainControl ? '开' : '关'}` : '默认关闭自动增益，保留声音强弱变化'}</span>
      </div>
      <div className="monitor-settings">
        <label><input type="checkbox" checked={voice.skipSilence} onChange={(event) => voice.setSkipSilence(event.target.checked)} />跳过静音</label>
        <label className="threshold-setting">门限 <input type="range" aria-label="静音门限" min={-70} max={-25} step={1} disabled={!voice.skipSilence}
          value={voice.thresholdDb} onChange={(event) => voice.setThresholdDb(Number(event.target.value))} /><output>{voice.thresholdDb} dBFS</output></label>
        <label><input type="checkbox" checked={voice.autoGain} disabled={voice.phase !== 'idle'} onChange={(event) => voice.setAutoGain(event.target.checked)} />自动增益</label>
      </div>
      <p className="monitor-tip">轻声说话被跳过时，将门限调低；关闭「跳过静音」可检查所有音频片段。</p>
      <div className="monitor-result">
        <span className="result-swatch" style={{ background: emotions[displayEmotion].color }} />
        <div><strong>{preview ? '正在预览灯效' : m.sameEmotionCount >= 2 ? `模型连续 ${m.sameEmotionCount} 段返回「${emotions[voice.emotion].label}」，主色保持不变` : last ? `最近模型标签：${last.emotionTag ?? '未知'} → ${emotions[last.emotion].label}` : '开麦后可检查模型判断与实际灯效是否一致'}</strong>
          <code data-testid="raw-tags">{last?.tags?.length ? last.tags.map((tag) => `<|${tag}|>`).join(' ') : '等待 SenseVoice 原始标签'}</code>
        </div>
        <span className="render-color">{emotions[displayEmotion].color.toUpperCase()}<small>{renderedCurrent ? `${rendered?.details.renderer === 'css' ? '兼容' : 'WebGL'} 灯效已应用` : '等待渲染确认'}</small></span>
      </div>
      <div className="monitor-log-toolbar">
        <label>事件日志 <select aria-label="日志筛选" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部事件</option><option value="errors">警告与错误</option><option value="model">识别与情绪</option><option value="audio">音频采集</option><option value="visual">灯效变化</option>
        </select></label>
        <label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />自动滚动</label>
      </div>
      <div className="monitor-log" ref={logRef} aria-label="监控事件列表" tabIndex={0}>
        {!filtered.length && <p className="monitor-empty">等待事件。点击「开始聆听」后，这里会记录完整处理过程。</p>}
        {filtered.map((entry) => <details key={entry.id} className={`monitor-event ${entry.level}`} data-event={entry.event}>
          <summary><time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}.{entry.timestamp.slice(20, 23)}</time>
            <span className="log-level">{entry.level.toUpperCase()}</span><span className="log-message">{entry.message}</span><code>{entry.event}</code></summary>
          <pre>{JSON.stringify({ sessionId: entry.sessionId, ...entry.details }, null, 2)}</pre>
        </details>)}
      </div>
      <div className="monitor-footer"><span>保留最近 500 条 · 当前显示 {filtered.length} 条 · 点击事件查看参数</span><code title={voice.sessionId ?? ''}>SESSION {voice.sessionId?.slice(0, 8) ?? '—'}</code></div>
    </div>}
  </section>;
}

export function MicrophoneSelector({ voice }: { voice: ReturnType<typeof useVoice> }) {
  return <div className="microphone-selector"><Mic size={12} />
    <select aria-label="输入麦克风" value={voice.selectedDeviceId} disabled={voice.phase !== 'idle'} onChange={(event) => {
      voice.setSelectedDeviceId(event.target.value);
      voice.log('settings.device', '已选择输入设备，下次开麦生效', { label: event.target.selectedOptions[0]?.text });
    }}><option value="">系统默认麦克风</option>{voice.devices.filter((device) => device.deviceId && device.deviceId !== 'default').map((device, index) =>
      <option value={device.deviceId} key={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}</select>
    <button className="icon-button" aria-label="刷新麦克风列表" disabled={voice.phase !== 'idle'} onClick={() => { void voice.refreshDevices(); }}><RefreshCw size={12} /></button>
  </div>;
}
