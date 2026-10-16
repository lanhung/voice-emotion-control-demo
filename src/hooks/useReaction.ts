import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult } from '../../shared/emotions';
import type { LogEvent } from '../../shared/monitoring';
import { acknowledgeReaction, requestReaction } from '../reaction/client';
import { ReactionStream, type ReactionState } from '../reaction/stream';

export type { ReactionState } from '../reaction/stream';

export function useReaction(log: LogEvent) {
  const [enabled, setEnabledState] = useState(false);
  const [state, setState] = useState<ReactionState>({ status: 'idle' });
  const stream = useMemo(() => new ReactionStream({ request: requestReaction, acknowledge: acknowledgeReaction, onState: setState, log }), [log]);
  const setEnabled = useCallback((value: boolean) => { setEnabledState(value); stream.setEnabled(value); }, [stream]);
  const begin = useCallback((sessionId: string) => stream.begin(sessionId), [stream]);
  const append = useCallback((sessionId: string, result: AnalysisResult, generation?: number) => stream.append(sessionId, result, generation), [stream]);
  const captureGeneration = useCallback(() => stream.captureGeneration(), [stream]);
  const complete = useCallback((sessionId: string) => stream.complete(sessionId), [stream]);
  const reset = useCallback(() => stream.reset(), [stream]);
  const painted = useCallback((decisionId: string) => stream.painted(decisionId), [stream]);
  useEffect(() => {
    const visibility = () => stream.setVisible(!document.hidden);
    const leave = () => stream.reset();
    visibility();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); stream.dispose(); };
  }, [stream]);
  return { enabled, state, setEnabled, begin, append, complete, reset, painted, captureGeneration };
}
