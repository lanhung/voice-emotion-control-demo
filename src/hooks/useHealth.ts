import { useEffect, useState } from 'react';
import type { HealthResponse } from '../../shared/emotions';

export function useHealth() {
  const [status, setStatus] = useState<'checking' | HealthResponse['status']>('checking');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        const health = await response.json() as HealthResponse;
        if (active) setStatus(response.ok && health.status === 'ready' ? 'ready' : 'unavailable');
      } catch { if (active) setStatus('unavailable'); }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 10_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  return status;
}
