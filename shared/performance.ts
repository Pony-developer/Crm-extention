import type { PerformanceSnapshot, PerformanceTask } from '../shared/types';

type DynamicsPage = {
  data?: { addOnLoad?: (handler: () => void) => void; entity?: { getEntityName?: () => string } };
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
  let timer = 0;

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
      startTime: resource.startTime,
    }));
    return {
      capturedAt: Date.now(),
      navigationStart: navigation?.startTime ?? 0,
      navigationToFormReady: formReadyAt,
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
    window.clearTimeout(timer);
    timer = window.setTimeout(() => publish(snapshot()), 150);
  };

  const observe = (type: string, target: PerformanceTask[]) => {
    if (!supported.includes(type)) return;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        const detail = entry as PerformanceEntry & { name?: string; attribution?: Array<{ name?: string; containerName?: string }> };
        target.push({
          startTime: entry.startTime,
          duration: entry.duration,
          kind: type === 'longtask' ? 'longtask' : 'event',
          attribution: detail.attribution?.map(item => item.containerName || item.name).filter(Boolean).join(', ') || detail.name,
        });
      }
      schedulePublish();
    });
    observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 50 } as PerformanceObserverInit : { type, buffered: true });
  };
  observe('longtask', longTasks);
  observe('event', eventTasks);

  const markReady = (source: PerformanceSnapshot['formLoadSource']) => {
    if (formReadyAt == null) formReadyAt = performance.now();
    formLoadSource = source;
    formLoadDuration = performance.now() - startedAt;
    schedulePublish();
  };
  page?.data?.addOnLoad?.(() => markReady('dynamics-event'));

  const readiness = window.setInterval(() => {
    if (page?.data?.entity?.getEntityName?.() && page?.ui?.getFormType?.() != null) {
      window.clearInterval(readiness);
      markReady('readiness-fallback');
    }
  }, 100);
  window.setTimeout(() => window.clearInterval(readiness), 30_000);
  window.addEventListener('load', schedulePublish, { once: true });
  window.setInterval(schedulePublish, 5_000);
  schedulePublish();
}
