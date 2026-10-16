import { useEffect, useRef } from 'react';
import { emotions, type Emotion } from '../../shared/emotions';
import type { ReactionPhrase } from '../../shared/reaction';
import { createLiquidTextShape, liquidMorphProgress, type LiquidTextShape } from '../visualization/liquidText';
import type { VisualizationProps } from './visualization';

interface Props extends Pick<VisualizationProps, 'source' | 'onEvent' | 'reactionDecisionId' | 'onReactionPainted'> { text: ReactionPhrase; emotion: Emotion; reducedMotion: boolean; visible: boolean }

const shade = (hex: string, factor: number) => `rgb(${[1, 3, 5].map((offset) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor)).join(',')})`;

// A Canvas 2D droplet surface also works when WebGL is unavailable. It is mounted
// only for an accepted reply and shares its lifetime with the reaction controller.
export default function LiquidReply({ text, emotion, reducedMotion, visible, source, onEvent, reactionDecisionId, onReactionPainted }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(performance.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const surface = document.createElement('canvas');
    const paint = surface.getContext('2d');
    if (!paint) return;
    let width = 0;
    let height = 0;
    let shape: LiquidTextShape | null = null;
    let frame = 0;
    let disposed = false;
    let pending = true;
    let paintFrame = 0;
    let paintReported = false;
    const started = startedRef.current;

    const draw = (now: number) => {
      if (!shape) return;
      const palette = emotions[emotion];
      const progress = liquidMorphProgress(now - started, reducedMotion);
      const time = reducedMotion ? 0 : (now - started) / 1000;
      paint.clearRect(0, 0, width, height);
      paint.globalCompositeOperation = 'source-over';
      paint.fillStyle = '#fff';
      if (progress < 1) {
        const bend = Math.sin(progress * Math.PI);
        const startRadius = shape.radius * 1.9 / Math.sqrt(Math.max(1, shape.points.length));
        const radius = startRadius + (shape.dotRadius - startRadius) * progress;
        paint.beginPath();
        for (const point of shape.points) {
          const x = point.fromX + (point.x - point.fromX) * progress;
          const y = point.fromY + (point.y - point.fromY) * progress + point.bend * bend;
          paint.moveTo(x + radius, y);
          paint.arc(x, y, radius, 0, Math.PI * 2);
        }
        paint.fill();
      } else paint.drawImage(shape.mask, 0, 0);

      const top = height / 2 - shape.radius + (shape.top - (height / 2 - shape.radius)) * progress;
      const bottom = height / 2 + shape.radius + (shape.bottom - (height / 2 + shape.radius)) * progress;
      const gradient = paint.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, palette.accent);
      gradient.addColorStop(0.18, palette.secondary);
      gradient.addColorStop(0.45, palette.color);
      gradient.addColorStop(0.62, shade(palette.color, 0.58));
      gradient.addColorStop(0.82, palette.color);
      gradient.addColorStop(1, shade(palette.secondary, 0.65));
      paint.globalCompositeOperation = 'source-in';
      paint.fillStyle = gradient;
      paint.fillRect(0, 0, width, height);
      // Slow highlights flow over the joined letter surface, never moving the glyphs.
      paint.globalCompositeOperation = 'source-atop';
      for (let ribbon = 0; ribbon < 3; ribbon++) {
        const y = top + (bottom - top) * (0.15 + ribbon * 0.32);
        paint.beginPath();
        paint.moveTo(0, y);
        paint.bezierCurveTo(width * 0.3, y + Math.sin(time * 0.7 + ribbon) * 18,
          width * 0.65, y - 14, width, y + 8);
        paint.strokeStyle = ribbon === 1 ? '#173c5630' : '#ffffff75';
        paint.lineWidth = ribbon === 1 ? 5 : 2;
        paint.stroke();
      }
      paint.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, width, height);
      context.shadowColor = `${palette.color}35`;
      context.shadowBlur = 16;
      context.shadowOffsetY = 5;
      context.drawImage(surface, 0, 0, width, height);
      if (!paintReported && reactionDecisionId && visible && !document.hidden) {
        paintReported = true;
        paintFrame = requestAnimationFrame(() => { if (!document.hidden) onReactionPainted(reactionDecisionId); });
      }
      canvas.dataset.morph = progress === 1 ? 'text' : 'forming';
      if (pending && progress === 1) {
        pending = false;
        onEvent('visual.reply_applied', `液态文字已显示：${text}`, {
          source, emotion, text, color: palette.color, renderer: 'liquid-text', transitionMs: Math.round(now - started),
        });
      }
    };
    const animate = (now: number) => { draw(now); frame = requestAnimationFrame(animate); };
    const refresh = () => {
      cancelAnimationFrame(frame);
      draw(performance.now());
      if (visible && !reducedMotion) frame = requestAnimationFrame(animate);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width; height = bounds.height;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      surface.width = canvas.width; surface.height = canvas.height;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint.setTransform(dpr, 0, 0, dpr, 0, 0);
      shape = createLiquidTextShape(text, width, height);
      refresh();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    void document.fonts.load('750 96px "DM Sans"').then(() => { if (!disposed) resize(); }).catch(() => undefined);
    return () => { disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(paintFrame); observer.disconnect(); };
  }, [text, emotion, reducedMotion, visible, source, onEvent, reactionDecisionId, onReactionPainted]);

  return <canvas ref={canvasRef} className="liquid-reply" data-testid="liquid-reply" data-text={text} aria-hidden="true" />;
}
