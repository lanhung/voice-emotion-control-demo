import { useEffect, useLayoutEffect, useRef } from 'react';
import { emotions } from '../../shared/emotions';
import type { VisualizationProps } from './visualization';

const ROWS = 8;
const COLUMNS = 64;
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

export default function LightMatrix({ emotion, level, active, source, onEvent }: VisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const input = useRef({ level, active });
  const colors = useRef([emotions.neutral.color, emotions.neutral.secondary, emotions.neutral.accent].map(rgb));
  const phase = useRef(0);
  const palette = emotions[emotion];

  useLayoutEffect(() => { input.current = { level, active }; }, [level, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const target = [palette.color, palette.secondary, palette.accent].map(rgb);
    const started = performance.now();
    let previous = started;
    let pending = true;
    let frame = 0;
    let width = 0;
    let height = 0;
    let strength = 0;
    onEvent('visual.target', `矩阵灯效目标：${palette.label} ${palette.color.toUpperCase()}`, {
      source, emotion, color: palette.color, secondary: palette.secondary, speed: palette.speed,
      renderer: 'canvas2d', rows: ROWS, columns: COLUMNS, reducedMotion: motion.matches,
    });

    const draw = (now: number) => {
      const step = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const blend = motion.matches ? 1 : 1 - Math.exp(-step * 8);
      let colorError = 0;
      colors.current.forEach((color, index) => color.forEach((channel, component) => {
        color[component] = channel + (target[index][component] - channel) * blend;
        colorError = Math.max(colorError, Math.abs(target[index][component] - color[component]));
      }));
      strength += (Math.max(0, Math.min(1, input.current.level)) - strength) * (1 - Math.exp(-step * 10));
      if (!motion.matches) phase.current += step * palette.speed * (input.current.active ? 1 : 0.55);
      const time = motion.matches ? 0 : phase.current;
      const energy = motion.matches ? 0 : strength;
      const cell = width / COLUMNS;
      context.clearRect(0, 0, width, height);

      // Sample a flowing ribbon at exactly 8 × 64 LED positions. Audio changes its spread and brightness.
      for (let column = 0; column < COLUMNS; column++) {
        const center = (ROWS - 1) / 2 + Math.sin(column * 0.14 - time) * (1.15 + energy * 0.65)
          + Math.sin(column * 0.3 + time * 0.65) * 0.45;
        for (let row = 0; row < ROWS; row++) {
          const distance = (row - center) / (1.3 + energy * 1.3);
          const pulse = 0.78 + Math.sin(column * 0.19 + time * 1.2) * 0.16;
          const brightness = Math.min(1, 0.1 + Math.exp(-distance * distance * 0.5) * (pulse + energy * 0.3));
          const secondary = (Math.sin(column * 0.1 + row * 0.45 - time * 0.4) + 1) * 0.24;
          const accent = (Math.cos(column * 0.16 - row * 0.5 + time * 0.6) + 1) * 0.12;
          const tint = colors.current[0].map((channel, index) => Math.round(
            channel * (1 - secondary - accent) + colors.current[1][index] * secondary + colors.current[2][index] * accent,
          )).join(',');
          const x = (column + 0.5) * cell;
          const y = (row + 0.5) * cell;
          const glow = context.createRadialGradient(x, y, 0, x, y, cell * 0.72);
          glow.addColorStop(0, `rgba(${tint},${brightness * 0.45})`);
          glow.addColorStop(1, `rgba(${tint},0)`);
          context.fillStyle = glow;
          context.fillRect(x - cell, y - cell, cell * 2, cell * 2);
          context.beginPath();
          context.arc(x, y, cell * 0.27, 0, Math.PI * 2);
          context.fillStyle = `rgba(${tint},${0.12 + brightness * 0.88})`;
          context.fill();
        }
      }

      if (pending && width > 0 && colorError < 1.5) {
        pending = false;
        onEvent('visual.applied', `矩阵主色已生效：${palette.label} ${palette.color.toUpperCase()}`, {
          source, emotion, color: palette.color, renderer: 'canvas2d', rows: ROWS, columns: COLUMNS,
          transitionMs: Math.round(now - started), colorError: colorError / 255,
        });
      }
    };
    const animate = (now: number) => { draw(now); frame = requestAnimationFrame(animate); };
    const refresh = () => {
      cancelAnimationFrame(frame);
      previous = performance.now();
      if (document.hidden) return;
      draw(previous);
      if (!motion.matches) frame = requestAnimationFrame(animate);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      refresh();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [emotion, onEvent, palette, source]);

  return <div className="light-matrix" role="img" aria-label={`${palette.label}情绪的 8 行 64 列灯光矩阵`}>
    <div className="matrix-frame">
      <canvas ref={canvasRef} width={1280} height={160} data-rows={ROWS} data-columns={COLUMNS} aria-hidden="true" />
    </div>
    <div className="matrix-caption" aria-hidden="true"><span>8 × 64<span className="matrix-caption-dot">·</span>512 颗灯珠</span><span>{source === 'preview' ? '情绪灯效预览' : active ? '情绪流光 · 随声律动' : '情绪流光 · 静候声音'}</span></div>
  </div>;
}
