export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'RUN_REQUEST'; request: WebApiRequest }
  | { type: 'CANCEL_REQUEST'; requestId: string }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'OPEN_PALETTE' };

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
