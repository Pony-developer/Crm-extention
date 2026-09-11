export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext; frame: ContextFrame }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'RUN_REQUEST'; method: string; path: string; body?: string }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'OPEN_PALETTE' };

export interface ContextFrame {
  url: string;
  role: 'top-level-entity-form' | 'embedded-entity-form';
  timestamp: number;
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
