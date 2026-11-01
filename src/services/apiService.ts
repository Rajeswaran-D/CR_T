import type {
  PurchaseOrder,
  ProductMasterItem,
  CategoryTemplate,
  RectificationAction,
  AuditLogEntry,
  SystemConfig,
  CancellationRequest
} from '../types';
import { getStorageConfig } from './storageContract';

const config = getStorageConfig();
const BASE_URL = config.apiBaseUrl.replace(/\/$/, '');

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Organization-Id': config.organizationId
  };
}

export interface HealthResponse {
  status: string;
  dbConnected: boolean;
  storageProvider: string;
  uptime?: number;
  devFallback?: boolean;
}

export interface DbStatusResponse {
  connected: boolean;
  storageProvider: string;
  stateKeysCount: number;
  ordersCount: number;
}

// ---------------------------------------------------------------------------
// Health & Diagnostics
// ---------------------------------------------------------------------------

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/health`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
  return res.json();
}

export async function fetchDbStatus(): Promise<DbStatusResponse> {
  const res = await fetch(`${BASE_URL}/db/status`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`DB status failed with status ${res.status}`);
  return res.json();
}

export async function initDbSchema(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/db/init-schema`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Init schema failed with status ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Shared State Gateway
// ---------------------------------------------------------------------------

export async function fetchSharedState(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/shared-state`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Fetch shared-state failed with status ${res.status}`);
  return res.json();
}

export async function saveSharedStatePayload(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE_URL}/shared-state`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Save shared-state failed with status ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Purchase Orders REST Client
// ---------------------------------------------------------------------------

export async function fetchOrders(): Promise<PurchaseOrder[]> {
  const res = await fetch(`${BASE_URL}/orders`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch orders: ${res.statusText}`);
  return res.json();
}

export async function fetchOrderById(id: string): Promise<PurchaseOrder> {
  const res = await fetch(`${BASE_URL}/orders/${encodeURIComponent(id)}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Order not found: ${res.statusText}`);
  return res.json();
}

export async function createOrder(po: PurchaseOrder): Promise<PurchaseOrder> {
  const res = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(po)
  });
  if (!res.ok) throw new Error(`Failed to create order: ${res.statusText}`);
  return res.json();
}

export async function updateOrder(id: string, po: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
  const res = await fetch(`${BASE_URL}/orders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(po)
  });
  if (!res.ok) throw new Error(`Failed to update order: ${res.statusText}`);
  return res.json();
}

export async function deleteOrder(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to delete order: ${res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Products, Templates, Config, Cancellations
// ---------------------------------------------------------------------------

export async function fetchProducts(): Promise<ProductMasterItem[]> {
  const res = await fetch(`${BASE_URL}/products`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch products: ${res.statusText}`);
  return res.json();
}

export async function createProduct(prod: ProductMasterItem): Promise<ProductMasterItem> {
  const res = await fetch(`${BASE_URL}/products`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(prod)
  });
  if (!res.ok) throw new Error(`Failed to create product: ${res.statusText}`);
  return res.json();
}

export async function fetchTemplates(): Promise<CategoryTemplate[]> {
  const res = await fetch(`${BASE_URL}/templates`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.statusText}`);
  return res.json();
}

export async function createTemplate(tmpl: CategoryTemplate): Promise<CategoryTemplate> {
  const res = await fetch(`${BASE_URL}/templates`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(tmpl)
  });
  if (!res.ok) throw new Error(`Failed to create template: ${res.statusText}`);
  return res.json();
}

export async function fetchConfig(): Promise<SystemConfig> {
  const res = await fetch(`${BASE_URL}/config`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch system config: ${res.statusText}`);
  return res.json();
}

export async function updateConfig(cfg: SystemConfig): Promise<SystemConfig> {
  const res = await fetch(`${BASE_URL}/config`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(cfg)
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.statusText}`);
  return res.json();
}

export async function fetchAuditLogs(): Promise<AuditLogEntry[]> {
  const res = await fetch(`${BASE_URL}/audit-log`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch audit logs: ${res.statusText}`);
  return res.json();
}

export async function createAuditLog(entry: AuditLogEntry): Promise<AuditLogEntry> {
  const res = await fetch(`${BASE_URL}/audit-log`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(entry)
  });
  if (!res.ok) throw new Error(`Failed to create audit log: ${res.statusText}`);
  return res.json();
}

export async function fetchRectifications(): Promise<RectificationAction[]> {
  const res = await fetch(`${BASE_URL}/rectifications`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch rectifications: ${res.statusText}`);
  return res.json();
}

export async function fetchCancellations(): Promise<CancellationRequest[]> {
  const res = await fetch(`${BASE_URL}/cancellations`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch cancellations: ${res.statusText}`);
  return res.json();
}

export async function createCancellation(cancellation: CancellationRequest): Promise<CancellationRequest> {
  const res = await fetch(`${BASE_URL}/cancellations`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(cancellation)
  });
  if (!res.ok) throw new Error(`Failed to submit cancellation: ${res.statusText}`);
  return res.json();
}
