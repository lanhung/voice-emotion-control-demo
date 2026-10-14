import { useCallback, useRef, useState } from 'react';
import type { LogEvent, MonitorEvent } from '../../shared/monitoring';

const MAX_EVENTS = 500;
export function useMonitor() {
  const eventsRef = useRef<MonitorEvent[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const index = useRef(0);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const log: LogEvent = useCallback((event, message, details = {}, level = 'info') => {
    const entry: MonitorEvent = { id: ++index.current, timestamp: new Date().toISOString(), level, event, message, sessionId: sessionIdRef.current, details };
    eventsRef.current = [...eventsRef.current, entry].slice(-MAX_EVENTS);
    setEvents(eventsRef.current);
    const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    write(`[Aura] ${event} · ${message}`, { sessionId: entry.sessionId, ...details });
  }, []);
  const clearLogs = useCallback(() => { eventsRef.current = []; setEvents([]); }, []);
  const exportLogs = useCallback(() => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), events: eventsRef.current }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `aura-monitor-${Date.now()}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);
  return { events, log, clearLogs, exportLogs, sessionIdRef };
}
