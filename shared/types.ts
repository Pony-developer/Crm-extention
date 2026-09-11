export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'RUN_REQUEST'; method: string; path: string; body?: string }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'CAPTURE_VISIBLE_TAB' }
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
  pageUrl?: string;
}

export type Annotation = {
  id: string;
  kind: 'arrow' | 'rectangle' | 'redact';
  x1: number; y1: number; x2: number; y2: number;
};

export interface RecordedStep {
  id: string;
  description: string;
  timestamp: string;
  context: Pick<CrmContext, 'pageUrl' | 'orgName' | 'entityName' | 'recordId' | 'formName'>;
  screenshot?: string;
  annotations: Annotation[];
}

export interface SavedEnvironment { id: string; name: string; url: string; kind: 'Dev' | 'Test' | 'Prod'; color: string; }
