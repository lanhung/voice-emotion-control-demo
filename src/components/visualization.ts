import type { Emotion } from '../../shared/emotions';
import type { ReactionPhrase } from '../../shared/reaction';
import type { LogEvent } from '../../shared/monitoring';

export type VisualizationMode = 'orb' | 'matrix';
export interface VisualizationProps {
  emotion: Emotion;
  level: number;
  active: boolean;
  source: 'preview' | 'sensevoice' | 'idle';
  onEvent: LogEvent;
  reactionText: ReactionPhrase | null;
}
