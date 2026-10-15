import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisResult } from '../../shared/emotions';
import type { LogEvent } from '../../shared/monitoring';
import { requestReaction } from '../reaction/client';
import { ReactionStream, type ReactionState } from '../reaction/stream';

export type { ReactionState } from '../reaction/stream';

export function useReaction(log: LogEvent) {
  const [enabled, setEnabledState] = useState(false);
  const [state, setState] = useState<ReactionState>({ status: 'idle' });
  const stream = useMemo(() => new ReactionStream({ request: requestReaction, onState: setState, log }), [log]);
  const setEnabled = useCallback((value: boolean) => { setEnabledState(value); stream.setEnabled(value); }, [stream]);
  const begin = useCallback((sessionId: string) => stream.begin(sessionId), [stream]);
  const append = useCallback((sessionId: string, result: AnalysisResult) => stream.append(sessionId, result), [stream]);
  const complete = useCallback((sessionId: string) => stream.complete(sessionId), [stream]);
  const reset = useCallback(() => stream.reset(), [stream]);
  useEffect(() => () => stream.dispose(), [stream]);
  return { enabled, state, setEnabled, begin, append, complete, reset };
}
