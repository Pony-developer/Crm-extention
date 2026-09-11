export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext }
  | { type: 'REGISTER_PERFORMANCE'; snapshot: PerformanceSnapshot }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'RUN_REQUEST'; request: WebApiRequest }
  | { type: 'CANCEL_REQUEST'; requestId: string }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'CAPTURE_VISIBLE_TAB' }
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
  formId?: string;
  formType?: number;
  appId?: string;
  appUniqueName?: string;
}

export type ComponentType = 'table' | 'form' | 'view' | 'plugin-step' | 'cloud-flow';

export interface ComponentSearchResult {
  id: string;
  type: ComponentType;
  name: string;
  subtitle?: string;
  /** The record type used when the component is opened with Xrm.Navigation. */
  entityName?: string;
  /** Used for metadata, such as tables, which does not have an entity form. */
  url?: string;
}

export type PageBridgeRequest =
  | { action: 'context' }
  | { action: 'fields' }
  | { action: 'request'; payload: { method: string; path: string; body?: string } }
  | { action: 'searchComponents'; payload: { query: string; limit?: number } }
  | { action: 'openComponent'; payload: ComponentSearchResult };

export interface SavedEnvironment { id: string; name: string; url: string; kind: 'Dev' | 'Test' | 'Prod'; color: string; }

export type WebApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface WebApiHeader { name: string; value: string; }
export interface WebApiRequest {
  requestId: string;
  method: WebApiMethod;
  path: string;
  body?: string;
  headers?: WebApiHeader[];
}
export interface WebApiResponse { status: number; statusText: string; body: string; }

export interface RequestHistoryItem {
  id: string;
  timestamp: number;
  method: WebApiMethod;
  path: string;
  body?: string;
  headers: WebApiHeader[];
  status?: number;
  statusText?: string;
}
