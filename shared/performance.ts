import type { PerformanceSnapshot, PerformanceTask } from '../shared/types';

type DynamicsPage = {
  data?: { addOnLoad?: (handler: () => void) => void; removeOnLoad?: (handler: () => void) => void; entity?: { getEntityName?: () => string } };
  ui?: { getFormType?: () => number };
};

/** Collects page-owned timings. This module must run in MAIN world. */
export function installPerformanceMonitor(page: DynamicsPage | undefined, publish: (snapshot: PerformanceSnapshot) => void) {
  const startedAt = performance.now();
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const longTasks: PerformanceTask[] = [];
  const eventTasks: PerformanceTask[] = [];
  let formReadyAt: number | undefined;
  let formLoadDuration: number | undefined;
  let formLoadSource: PerformanceSnapshot['formLoadSource'] = 'pending';
  const observers: PerformanceObserver[] = [];
  const timeoutIds = new Set<number>();
  const intervalIds = new Set<number>();
  let publishTimeout: number | undefined;
  let active = true;

  const setMonitorTimeout = (callback: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timeoutIds.delete(id);
      callback();
    }, delay);
    timeoutIds.add(id);
    return id;
  };
  const setMonitorInterval = (callback: () => void, delay: number) => {
    const id = window.setInterval(callback, delay);
    intervalIds.add(id);
    return id;
  };
  const clearMonitorInterval = (id: number) => {
    window.clearInterval(id);
    intervalIds.delete(id);
  };

  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const supportsLongTasks = supported.includes('longtask');
  const supportsEventTiming = supported.includes('event');

  const snapshot = (): PerformanceSnapshot => {
    const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(resource => ({
      name: resource.name.split('/').pop()?.split('?')[0] || resource.name,
      url: resource.name,
      initiatorType: resource.initiatorType || 'other',
      duration: resource.duration,
      transferSize: resource.transferSize,
      startOffset: resource.startTime,
    }));
    return {
      capturedAt: Date.now(),
      navigationStartOffset: navigation?.startTime ?? 0,
      navigationToFormReady: formReadyAt == null ? undefined : formReadyAt - (navigation?.startTime ?? 0),
      formLoadDuration,
      formLoadSource,
      resourceCount: resources.length,
      resources,
      longTasks: longTasks.slice(-200),
      eventTasks: eventTasks.slice(-200),
      supportsLongTasks,
      supportsEventTiming,
    };
  };
  const schedulePublish = () => {
    if (!active) return;
    if (publishTimeout !== undefined) {
      window.clearTimeout(publishTimeout);
      timeoutIds.delete(publishTimeout);
    }
    publishTimeout = setMonitorTimeout(() => {
      publishTimeout = undefined;
      if (active) publish(snapshot());
    }, 150);
  };

  const observe = (type: string, target: PerformanceTask[]) => {
    if (!supported.includes(type)) return;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        const detail = entry as PerformanceEntry & { name?: string; attribution?: Array<{ name?: string; containerName?: string }> };
        target.push({
          startOffset: entry.startTime,
          duration: entry.duration,
          kind: type === 'longtask' ? 'longtask' : 'event',
          attribution: detail.attribution?.map(item => item.containerName || item.name).filter(Boolean).join(', ') || detail.name,
        });
      }
      schedulePublish();
    });
    observers.push(observer);
    observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 50 } as PerformanceObserverInit : { type, buffered: true });
  };
  observe('longtask', longTasks);
  observe('event', eventTasks);

  const markReady = (source: PerformanceSnapshot['formLoadSource']) => {
    if (formReadyAt != null) return;
    formReadyAt = performance.now();
    formLoadSource = source;
    formLoadDuration = formReadyAt - startedAt;
    schedulePublish();
  };
  const onDynamicsLoad = () => markReady('dynamics-event');
  page?.data?.addOnLoad?.(onDynamicsLoad);

  const readiness = setMonitorInterval(() => {
    if (page?.data?.entity?.getEntityName?.() && page?.ui?.getFormType?.() != null) {
      clearMonitorInterval(readiness);
      markReady('readiness-fallback');
    }
  }, 100);
  setMonitorTimeout(() => clearMonitorInterval(readiness), 30_000);
  window.addEventListener('load', schedulePublish, { once: true });
  setMonitorInterval(schedulePublish, 5_000);
  schedulePublish();

  return () => {
    if (!active) return;
    active = false;
    observers.forEach(observer => observer.disconnect());
    observers.length = 0;
    page?.data?.removeOnLoad?.(onDynamicsLoad);
    timeoutIds.forEach(id => window.clearTimeout(id));
    timeoutIds.clear();
    intervalIds.forEach(id => window.clearInterval(id));
    intervalIds.clear();
    publishTimeout = undefined;
    window.removeEventListener('load', schedulePublish);
  };
}
