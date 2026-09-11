export type ToolMessage =
  | { type: 'GET_CONTEXT' }
  | { type: 'REGISTER_CONTEXT'; context: CrmContext; frame: FrameRegistration }
  | { type: 'REGISTER_PERFORMANCE'; snapshot: PerformanceSnapshot }
  | { type: 'ACTIVE_CONTEXT_CHANGED'; context: CrmContext }
  | { type: 'GET_ACTIVE_CONTEXT' }
  | { type: 'GET_ACTIVE_PERFORMANCE' }
  | { type: 'RUN_REQUEST'; request: WebApiRequest }
  | { type: 'CANCEL_REQUEST'; requestId: string }
  | { type: 'GET_RELATIONSHIPS'; request: RelationshipsRequest }
  | { type: 'TOGGLE_THEME'; enabled: boolean }
  | { type: 'SET_THEME'; enabled: boolean }
  | { type: 'CAPTURE_VISIBLE_TAB' }
  | { type: 'OPEN_PALETTE' }
  | { type: 'OPEN_COMPONENT'; component: ComponentSearchResult };

/** Metadata used to choose the best Dynamics frame in a tab. `frameId` is
 * intentionally omitted because MessageSender.frameId is authoritative. */
export interface FrameRegistration {
  role: 'record';
  quality: number;
  timestamp: number;
}

export interface PerformanceResource {
  name: string;
  url: string;
  initiatorType: string;
  duration: number;
  transferSize: number;
  /** Absolute offset from the document's performance time origin. */
  startOffset: number;
}

export interface PerformanceTask {
  /** Absolute offset from the document's performance time origin. */
  startOffset: number;
  duration: number;
  kind: 'longtask' | 'event';
  /** Browser attribution only; it is not a Dynamics handler identity. */
  attribution?: string;
}

export interface PerformanceSnapshot {
  capturedAt: number;
  /** Absolute navigation-start offset from the document's performance time origin. */
  navigationStartOffset: number;
  /** Duration between navigation start and the moment the form became ready. */
  navigationToFormReady?: number;
  /** Duration between monitor installation and the moment the form became ready. */
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
  pageUrl?: string;
}

export interface Annotation {
  id: string;
  kind: 'arrow' | 'rectangle' | 'redact';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type RecordedStepContext = Pick<CrmContext,
  'pageUrl' | 'orgName' | 'entityName' | 'recordId' | 'formName'>;

export interface RecordedStep {
  id: string;
  description: string;
  timestamp: string;
  context: RecordedStepContext;
  screenshot?: string;
  annotations: Annotation[];
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

export interface FieldInfo {
  name: string;
  schema: string;
  type: string;
  required: string;
  dirty: boolean;
  controlNames: string[];
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

export interface HandshakeRequest { token: string; }
export interface HandshakeResponse { accepted: true; }
export interface CancelRequest { requestId: string; }
export interface ComponentSearchRequest { query: string; limit?: number; }

export interface RelationshipsRequest { logicalName: string; }
export interface OneToManyRelationshipMetadata {
  MetadataId?: string;
  SchemaName?: string;
  ReferencedEntity?: string;
  ReferencingEntity?: string;
}
export interface ManyToManyRelationshipMetadata {
  MetadataId?: string;
  SchemaName?: string;
  Entity1LogicalName?: string;
  Entity2LogicalName?: string;
}
export interface RelationshipsMetadata {
  oneToMany: OneToManyRelationshipMetadata[];
  manyToOne: OneToManyRelationshipMetadata[];
  manyToMany: ManyToManyRelationshipMetadata[];
}
export interface RelationshipsError { message: string; status?: number; }
export type RelationshipsResult =
  | { ok: true; data: RelationshipsMetadata }
  | { ok: false; error: RelationshipsError };

export interface FieldState {
  name: string;
  dirty: boolean;
  value?: unknown;
}

export interface AttributeChangePayload extends FieldState {}
export interface FieldsStatePayload { reason: string; fields: FieldState[]; }
export interface ContextChangedPayload { context: CrmContext; fields: FieldInfo[]; }

export interface PageBridgeActionMap {
  handshake: { payload: HandshakeRequest; result: HandshakeResponse };
  context: { payload: null; result: CrmContext };
  fields: { payload: null; result: FieldInfo[] };
  request: { payload: WebApiRequest; result: WebApiResponse };
  cancelRequest: { payload: CancelRequest; result: boolean };
  searchComponents: { payload: ComponentSearchRequest; result: ComponentSearchResult[] };
  getRelationships: { payload: RelationshipsRequest; result: RelationshipsResult };
  openComponent: { payload: ComponentSearchResult; result: boolean };
}

export type PageBridgeAction = keyof PageBridgeActionMap;
export type PageBridgePayload<A extends PageBridgeAction> = PageBridgeActionMap[A]['payload'];
export type PageBridgeResult<A extends PageBridgeAction> = PageBridgeActionMap[A]['result'];

interface PageBridgeEnvelope {
  channel: 'dynamics-toolkit';
  id: string;
}

type BridgeRequestBody<A extends PageBridgeAction> = PageBridgeEnvelope & {
  direction: 'request';
  action: A;
  payload: PageBridgePayload<A>;
};

export type AuthenticatedPageBridgeAction = Exclude<PageBridgeAction, 'handshake'>;
export type AuthenticatedPageBridgeRequest<A extends AuthenticatedPageBridgeAction> =
  BridgeRequestBody<A> & { token: string };
export type PageBridgeRequestFor<A extends PageBridgeAction> = A extends 'handshake'
  ? BridgeRequestBody<A> & { token?: never }
  : A extends AuthenticatedPageBridgeAction
    ? AuthenticatedPageBridgeRequest<A>
    : never;

/** A correlated, discriminated union generated from the bridge contract. */
export type PageBridgeRequest = {
  [A in PageBridgeAction]: PageBridgeRequestFor<A>
}[PageBridgeAction];

export type PageBridgeSuccessResponse = {
  [A in PageBridgeAction]: PageBridgeEnvelope & {
    direction: 'response'; action: A; token: string; result: PageBridgeResult<A>;
  }
}[PageBridgeAction];

export type PageBridgeResponse = PageBridgeSuccessResponse | (PageBridgeEnvelope & {
  direction: 'response';
  action: PageBridgeRequest['action'] | 'unknown';
  token: string;
  error: string;
});

export type PageBridgeEvent =
  | { channel: 'dynamics-toolkit'; direction: 'event'; event: 'attribute-change'; payload: AttributeChangePayload }
  | { channel: 'dynamics-toolkit'; direction: 'event'; event: 'fields-state'; payload: FieldsStatePayload }
  | { channel: 'dynamics-toolkit'; direction: 'event'; event: 'context-changed'; payload: ContextChangedPayload };

export interface PageBridgePerformanceEvent {
  channel: 'dynamics-toolkit';
  direction: 'performance';
  snapshot: PerformanceSnapshot;
}

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
