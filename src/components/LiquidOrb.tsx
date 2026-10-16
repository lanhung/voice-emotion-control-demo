import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, MeshDistortMaterial } from '@react-three/drei';
import { Color, MathUtils, type Mesh, type MeshPhysicalMaterial } from 'three';
import { emotions } from '../../shared/emotions';
import type { VisualizationProps } from './visualization';
import LiquidReply from './LiquidReply';

interface OrbProps extends VisualizationProps { reducedMotion: boolean }
type LiquidMaterial = ComponentRef<typeof MeshDistortMaterial>;

function Orb({ emotion, level, active, reducedMotion, source, onEvent }: OrbProps) {
  const material = useRef<LiquidMaterial>(null);
  const mesh = useRef<Mesh>(null);
  const time = useRef(0);
  const target = useRef(new Color());
  const transition = useRef({ pending: true, started: performance.now() });
  const colors = useMemo(() => ({
    auraA: { value: new Color(emotions.neutral.color) },
    auraB: { value: new Color(emotions.neutral.secondary) },
    auraC: { value: new Color(emotions.neutral.accent) },
  }), []);
  const palette = emotions[emotion];
  useEffect(() => {
    transition.current = { pending: true, started: performance.now() };
    onEvent('visual.target', `灯效目标：${palette.label} ${palette.color.toUpperCase()}`, {
      source, emotion, color: palette.color, secondary: palette.secondary, speed: palette.speed, distort: palette.distort, reducedMotion,
    });
  }, [emotion, onEvent, palette, reducedMotion, source]);
  useLayoutEffect(() => {
    const current = material.current;
    if (!current) return;
    const physicalMaterial: MeshPhysicalMaterial = current;
    const original = physicalMaterial.onBeforeCompile.bind(physicalMaterial);
    // Extend Drei's liquid material with flowing, three-tone surface color.
    physicalMaterial.onBeforeCompile = (shader, renderer) => {
      original(shader, renderer);
      Object.assign(shader.uniforms, colors);
      shader.vertexShader = `varying vec3 vAuraPosition;\n${shader.vertexShader}`.replace('void main() {', 'void main() { vAuraPosition = position;');
      shader.fragmentShader = `varying vec3 vAuraPosition;\nuniform float time;\nuniform vec3 auraA;\nuniform vec3 auraB;\nuniform vec3 auraC;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 p = vAuraPosition;
        float t = time * 0.18;
        float warp = sin(p.x * 2.3 + p.z * 1.6 + t) * 0.5 + sin(p.y * 2.1 - p.z * 1.7 - t * 0.6) * 0.4;
        float flow = p.y * 1.3 + p.x * 0.5 + warp;
        vec3 tint = mix(auraA, auraB, smoothstep(-0.65, 0.7, sin(flow * 2.5 + t)) * 0.42);
        tint = mix(tint, auraC, smoothstep(0.1, 0.95, sin(p.x * 2.5 - p.y * 0.8 + warp - t)) * 0.24);
        float ribbon = smoothstep(0.72, 0.99, sin(flow * 5.0 + t));
        diffuseColor.rgb = mix(tint, tint * 0.48, ribbon * 0.6);
      `).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += tint * 0.12;');
    };
    current.customProgramCacheKey = () => 'aura-liquid-v2-saturated';
    current.needsUpdate = true;
    return () => { physicalMaterial.onBeforeCompile = original; current.needsUpdate = true; };
  }, [colors]);
  useFrame((_state, delta) => {
    const step = Math.min(delta, 0.05);
    time.current += step;
    if (material.current) {
      const blend = 1 - Math.exp(-step * 8);
      colors.auraA.value.lerp(target.current.set(palette.color), blend);
      colors.auraB.value.lerp(target.current.set(palette.secondary), blend);
      colors.auraC.value.lerp(target.current.set(palette.accent), blend);
      material.current.distort = MathUtils.damp(material.current.distort, reducedMotion ? 0.16 : palette.distort + level * 0.15, 4, step);
      target.current.set(palette.color);
      const colorError = Math.max(Math.abs(colors.auraA.value.r - target.current.r), Math.abs(colors.auraA.value.g - target.current.g), Math.abs(colors.auraA.value.b - target.current.b));
      if (transition.current.pending && colorError < 0.01) {
        transition.current.pending = false;
        onEvent('visual.applied', `主色已生效：${palette.label} ${palette.color.toUpperCase()}`, {
          source, emotion, color: palette.color, renderer: 'webgl', transitionMs: Math.round(performance.now() - transition.current.started),
          colorError, distort: material.current.distort,
        });
      }
    }
    if (mesh.current && !reducedMotion) {
      mesh.current.rotation.y += step * 0.075;
      mesh.current.rotation.z = Math.sin(time.current * 0.25) * 0.08;
      mesh.current.position.y = Math.sin(time.current * 0.75) * 0.055;
      const scale = MathUtils.damp(mesh.current.scale.x, 1 + level * 0.1, 3, step);
      mesh.current.scale.setScalar(scale);
    }
  });

  return <>
    <ambientLight intensity={0.8} />
    <directionalLight position={[0, 5, 2]} intensity={1.4} color="#ffffff" />
    <mesh ref={mesh} rotation={[0.2, 0, -0.1]}>
      <sphereGeometry args={[1.4, 96, 96]} />
      <MeshDistortMaterial ref={material} color="#ffffff" speed={reducedMotion ? 0 : palette.speed * (active ? 1 : 0.6)} distort={0.38}
        metalness={0.12} roughness={0.22} clearcoat={1} clearcoatRoughness={0.18}
        iridescence={0.12} iridescenceIOR={1.35} iridescenceThicknessRange={[100, 430]}
        envMapIntensity={0.65} />
    </mesh>
    <Environment resolution={128}>
      <color attach="background" args={['#929292']} />
      <Lightformer form="ring" intensity={3} color="#ffffff" position={[-3, 4, 4]} scale={[6, 2, 1]} target={[0, 0, 0]} />
      <Lightformer form="circle" intensity={1.5} color="#ffffff" position={[4, 2, -2]} scale={[4, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[-4, -2, -1]} scale={[4, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="ring" intensity={2} color="#ffffff" position={[1, 3, -4]} scale={4} target={[0, 0, 0]} />
    </Environment>
  </>;
}

function FallbackOrb() { return <div className="fallback-orb" aria-hidden="true"><i /><i /><i /></div>; }

function MonitoredFallback({ emotion, source, onEvent }: Pick<OrbProps, 'emotion' | 'source' | 'onEvent'>) {
  useEffect(() => {
    onEvent('visual.fallback', 'WebGL 不可用，已使用兼容灯效', { renderer: 'css' }, 'warn');
    onEvent('visual.applied', `兼容灯效主色：${emotions[emotion].label}`, { renderer: 'css', emotion, source, color: emotions[emotion].color });
  }, [emotion, source, onEvent]);
  return <FallbackOrb />;
}

class OrbBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function LiquidOrb(props: VisualizationProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    const visibility = () => setVisible(!document.hidden);
    change(); media.addEventListener('change', change); document.addEventListener('visibilitychange', visibility);
    return () => { media.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <div className={`orb-canvas ${props.reactionText ? 'is-replying' : ''}`} role="img"
    aria-label={props.reactionText ? `液态光球回应：${props.reactionText}` : `${emotions[props.emotion].label}情绪的液态光球`}>
    <div className="orb-surface" aria-hidden="true">
    <OrbBoundary fallback={<MonitoredFallback {...props} />}>
      <Suspense fallback={<FallbackOrb />}>
        <Canvas camera={{ position: [0, 0, 5.6], fov: 40 }} dpr={[1, 1.75]} frameloop={visible && !props.reactionText ? 'always' : 'never'}
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }} fallback={<FallbackOrb />}>
          <Orb {...props} reducedMotion={reducedMotion} />
        </Canvas>
      </Suspense>
    </OrbBoundary>
    </div>
    {props.reactionText && <LiquidReply key={props.reactionDecisionId} text={props.reactionText} emotion={props.emotion}
      source={props.source} onEvent={props.onEvent} reducedMotion={reducedMotion} visible={visible}
      reactionDecisionId={props.reactionDecisionId} onReactionPainted={props.onReactionPainted} />}
  </div>;
}
