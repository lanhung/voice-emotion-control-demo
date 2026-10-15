import type { ReactionState } from '../hooks/useReaction';

export default function ReactionBadge({ state, enabled }: { state: ReactionState; enabled: boolean }) {
  return <div className={`reaction-badge ${state.status}`} role="status" aria-live="polite" aria-atomic="true" data-testid="reaction-badge">
    {enabled && state.status === 'replied' && <span lang="en" className="reaction-text">{state.text}</span>}
    {enabled && state.status === 'error' && <span>{state.message}</span>}
  </div>;
}
