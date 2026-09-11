export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'RUN_REQUEST'; method: string; path: string; body?: string }
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

export interface FieldInfo {
  name: string;
  schema: string;
  type: string;
  required: string;
  dirty: boolean;
}

export type DataverseMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface DataverseResponse {
  status: number;
  statusText: string;
  body: string;
}

interface BridgeEnvelope {
  channel: 'dynamics-toolkit';
  id: string;
}

export type BridgeRequest =
  | (BridgeEnvelope & { direction: 'request'; action: 'handshake'; payload: { token: string } })
  | (BridgeEnvelope & { direction: 'request'; action: 'context'; token: string; payload: null })
  | (BridgeEnvelope & { direction: 'request'; action: 'fields'; token: string; payload: null })
  | (BridgeEnvelope & { direction: 'request'; action: 'request'; token: string; payload: { method: DataverseMethod; path: string; body?: string } });

export type BridgeSuccessResponse =
  | (BridgeEnvelope & { direction: 'response'; action: 'handshake'; token: string; result: { accepted: true } })
  | (BridgeEnvelope & { direction: 'response'; action: 'context'; token: string; result: CrmContext })
  | (BridgeEnvelope & { direction: 'response'; action: 'fields'; token: string; result: FieldInfo[] })
  | (BridgeEnvelope & { direction: 'response'; action: 'request'; token: string; result: DataverseResponse });

export type BridgeErrorResponse = BridgeEnvelope & {
  direction: 'response';
  action: BridgeRequest['action'] | 'unknown';
  token?: string;
  error: string;
};

export type BridgeResponse = BridgeSuccessResponse | BridgeErrorResponse;

export interface XrmAttribute {
  getName(): string;
  getAttributeType(): string;
  getRequiredLevel(): string;
  getIsDirty(): boolean;
}

export interface XrmEntity {
  attributes?: { forEach(callback: (attribute: XrmAttribute) => void): void };
  getEntityName?(): string;
  getId?(): string;
  getPrimaryAttributeValue?(): string;
}

export interface XrmApi {
  Utility?: {
    getGlobalContext?(): {
      getClientUrl(): string;
      organizationSettings?: { uniqueName?: string };
    };
  };
  Page?: {
    data?: { entity?: XrmEntity };
    ui?: {
      formSelector?: { getCurrentItem?(): { getLabel?(): string } | null };
      getFormType?(): number;
    };
  };
}

export interface SavedEnvironment { id: string; name: string; url: string; kind: 'Dev' | 'Test' | 'Prod'; color: string; }
