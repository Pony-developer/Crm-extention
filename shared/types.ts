export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext }
  | { type: 'REGISTER_PERFORMANCE'; snapshot: PerformanceSnapshot }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'GET_ACTIVE_PERFORMANCE' }
  | { type: 'RUN_REQUEST'; method: string; path: string; body?: string }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'OPEN_PALETTE' };

export interface PerformanceResource {
  name: string;
  url: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  startTime: number;
}

export interface PerformanceTask {
  startTime: number;
  duration: number;
  kind: 'longtask' | 'event';
  /** Browser attribution only; it is not a Dynamics handler identity. */
  attribution?: string;
}

export interface PerformanceSnapshot {
  capturedAt: number;
  navigationStart: number;
  navigationToFormReady?: number;
  formLoadDuration?: number;
  formLoadSource: 'dynamics-event' | 'readiness-fallback' | 'pending';
  resourceCount: number;
  resources: PerformanceResource[];
  longTasks: PerformanceTask[];
  eventTasks: PerformanceTask[];
  supportsLongTasks: boolean;
  supportsEventTiming: boolean;
}

export interface CrmContext {
  connected: boolean;
  orgUrl?: string;
  orgName?: string;
  entityName?: string;
  entityDisplayName?: string;
  recordId?: string;
  recordName?: string;
  formName?: string;
  formType?: number;
}

export interface SavedEnvironment { id: string; name: string; url: string; kind: 'Dev' | 'Test' | 'Prod'; color: string; }
