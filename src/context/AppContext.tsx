import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type {
  Role,
  PurchaseOrder,
  ProductLine,
  CategoryTemplate,
  RectificationAction,
  AuditLogEntry,
  SystemConfig,
  MilestoneStatus,
  DelayCategory,
  ProductMasterItem,
  Milestone,
  Subdivision,
  CancellationRequest,
  MaterialItem
} from '../types';
import { ROLE_PERMISSIONS, isMilestoneOwnedByRole, canRoleManageSubdivision } from '../types';
import {
  INITIAL_PURCHASE_ORDERS,
  INITIAL_TEMPLATES,
  INITIAL_RECTIFICATIONS,
  INITIAL_AUDIT_LOG,
  INITIAL_CONFIG,
  INITIAL_PRODUCTS
} from '../data/mockData';
import {
  recalculateProductLine,
  generateSuggestedRectifications,
  addDays,
  todayLocal,
  isValidDateString,
  chainAnchorDate,
  validateEventDate,
  normalizeMaterialDates,
  resolveLineMaterials,
  buildTemplateSchedule,
  getOrderDeliveryDate,
  getDaysDifference,
  calculateMilestonesFromBOM
} from '../services/calculationEngine';
import { getSharedStateEndpoint, getStorageConfig, STORAGE_KEYS, type StorageKey } from '../services/storageContract';

interface AppContextType {
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  purchaseOrders: PurchaseOrder[];
  products: ProductMasterItem[];
  templates: CategoryTemplate[];
  rectifications: RectificationAction[];
  auditLog: AuditLogEntry[];
  config: SystemConfig;
  isOffline: boolean;
  setIsOffline: (offline: boolean) => void;

  // Actions
  createProduct: (newProduct: Partial<ProductMasterItem>) => { success: boolean; id?: string };
  updateProduct: (productId: string, updates: Partial<ProductMasterItem>) => { success: boolean; error?: string };
  deleteProduct: (productId: string) => { success: boolean; error?: string };
  updateMilestoneEvent: (params: {
    poId: string;
    productLineId: string;
    milestoneKey: string;
    eventType: 'start' | 'complete';
    eventDate: string;
    targetEndDate?: string;
    user: string;
    docRef: string;
    backdateReason?: string;
    approvalRef?: string;
    drawingNo?: string;
    ecnNo?: string;
    delayCategory?: DelayCategory;
    delayOwner?: string;
    delayReason?: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    grnNumber?: string;
  }) => { success: boolean; error?: string };

  batchUpdateMilestoneEvents: (items: Array<{
    poId: string;
    productLineId: string;
    milestoneKey: string;
    eventType: 'start' | 'complete';
    eventDate: string;
    targetEndDate?: string;
    user: string;
    docRef: string;
    backdateReason?: string;
    approvalRef?: string;
    drawingNo?: string;
    ecnNo?: string;
    delayCategory?: DelayCategory;
    delayOwner?: string;
    delayReason?: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    grnNumber?: string;
  }>) => { success: boolean; error?: string; count?: number };

  acceptMilestone: (params: { poId: string; productLineId: string; milestoneKey: string; user: string }) => { success: boolean; error?: string };

  updateOrderStatus: (params: {
    poId: string;
    productLineId?: string;
    stageKey: string;
    statusAction: 'In Progress' | 'Completed';
    workNotes: string;
    completionDate?: string;
    user: string;
  }) => { success: boolean; error?: string };

  updateMaterialItem: (params: {
    poId: string;
    productLineId: string;
    materialId: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    grnNumber?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    inspectionNotes?: string;
    user: string;
    docRef: string;
  }) => { success: boolean; error?: string };

  addBaselineRevision: (params: {
    poId: string;
    reason: string;
    docRef: string;
    user: string;
    baselineStartDate?: string;
    changes: { lineId: string; milestoneKey: string; newDuration: number }[];
    milestoneFlows?: {
      lineId: string;
      milestones: { key: string; name: string; durationDays: number }[];
    }[];
    autoFit?: boolean;
  }) => { success: boolean; error?: string };

  approveRectification: (actionId: string, decision: 'Accepted' | 'Rejected', decisionNotes: string, user: string) => void;

  createPurchaseOrder: (newPo: Partial<PurchaseOrder>) => { success: boolean; poId?: string; error?: string };
  importPurchaseOrders: (newPos: PurchaseOrder[], replaceExisting?: boolean) => { success: boolean; count: number; error?: string };

  closePurchaseOrder: (poId: string, closureNotes: string, user: string) => { success: boolean; error?: string };
  requestPOCancellation: (params: { poId: string; reason: string; requestedBy?: string }) => { success: boolean; error?: string };
  approvePOCancellation: (params: { poId: string; actionType: 'cancel' | 'delete'; decisionNotes?: string }) => { success: boolean; error?: string };
  rejectPOCancellation: (params: { poId: string; decisionNotes: string }) => { success: boolean; error?: string };
  deletePurchaseOrder: (poId: string, reason?: string) => { success: boolean; error?: string };
  pendingCancellationCount: number;

  updateTemplates: (newTemplates: CategoryTemplate[]) => void;
  updateConfig: (newConfig: SystemConfig) => void;
  resetToDefaultData: () => void;
  refreshData: () => void;
  showBlueprintModal: boolean;
  setShowBlueprintModal: (show: boolean) => void;

  // Subdivision CRUD
  // TODO: enforce server-side in org-api adapter
  addSubdivision: (params: {
    poId: string;
    productLineId: string;
    milestoneId: string;
    milestoneKey: string;
    title: string;
    ownerLabel?: string;
    targetStart?: string;
    targetEnd?: string;
  }) => { success: boolean; error?: string };
  updateSubdivision: (params: {
    poId: string;
    productLineId: string;
    milestoneId: string;
    subdivisionId: string;
    updates: Partial<Omit<Subdivision, 'id' | 'milestoneId' | 'createdAt'>>;
  }) => { success: boolean; error?: string };
  deleteSubdivision: (params: {
    poId: string;
    productLineId: string;
    milestoneId: string;
    subdivisionId: string;
  }) => { success: boolean; error?: string };

  // Permission helper (derived from activeRole + ROLE_PERMISSIONS)
  canDo: (action: keyof typeof ROLE_PERMISSIONS[Role]) => boolean;
  backendStatus: 'connected' | 'offline' | 'mysql';
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const sharedStateKeys = STORAGE_KEYS;
const PENDING_SHARED_SYNC_STORAGE_KEY = 'cft_pending_shared_sync';
type PendingSharedSync = Partial<Record<StorageKey, string>>;

const readPendingSharedSync = (): PendingSharedSync => {
  try {
    const raw = localStorage.getItem(PENDING_SHARED_SYNC_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as PendingSharedSync : {};
  } catch {
    return {};
  }
};

const markPendingSharedSync = (key: StorageKey, serialized: string) => {
  try {
    const pending = readPendingSharedSync();
    pending[key] = serialized;
    localStorage.setItem(PENDING_SHARED_SYNC_STORAGE_KEY, JSON.stringify(pending));
  } catch { }
};

const clearPendingSharedSync = (key: StorageKey, serialized: string) => {
  try {
    const pending = readPendingSharedSync();
    if (pending[key] !== serialized) return;
    delete pending[key];
    if (Object.keys(pending).length > 0) {
      localStorage.setItem(PENDING_SHARED_SYNC_STORAGE_KEY, JSON.stringify(pending));
    } else {
      localStorage.removeItem(PENDING_SHARED_SYNC_STORAGE_KEY);
    }
  } catch { }
};

// Broadcasts the outcome of server persistence attempts so the UI can show a
// truthful status: a failed save flips the Header badge to "Offline"; a
// successful save restores "Connected". localStorage writes are only an offline
// cache and never count as a successful server save.
export const STORAGE_SYNC_EVENT = 'cft:storage-sync';
const emitStorageSyncStatus = (ok: boolean) => {
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_SYNC_EVENT, { detail: { ok } }));
  } catch { }
};

const deleteOrderOnServer = (poId: string) => {
  const config = getStorageConfig();
  fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/orders/${encodeURIComponent(poId)}`, {
    method: 'DELETE',
    headers: {
      'X-Organization-Id': config.organizationId
    }
  })
    .then(res => {
      // 404 means the backend responded but had no row — still "reachable".
      if (res.ok || res.status === 404) emitStorageSyncStatus(true);
      else console.warn(`[Storage Sync Warning] DELETE order returned status ${res.status}`);
    })
    .catch(err => {
      console.warn('[Storage Sync Network Error] Failed to delete order:', err);
    });
};

// Multi-tab real-time broadcast channel for instantaneous zero-latency sync across all open tabs
const crossTabChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('cft_tracker_cross_tab_channel')
  : null;

// Ids deleted from this tab or sibling tabs. Strips these for 60s so a
// stale server snapshot cannot re-render the row across any tab.
const LOCAL_TOMBSTONE_TTL_MS = 120_000;
const recentlyDeletedOrders = new Map<string, number>();

const rememberDeletedOrder = (poId: string) => {
  recentlyDeletedOrders.set(poId, Date.now());
  try {
    const list: string[] = JSON.parse(localStorage.getItem('cft_deleted_order_ids') || '[]');
    if (!list.includes(poId)) {
      list.push(poId);
      localStorage.setItem('cft_deleted_order_ids', JSON.stringify(list));
    }
  } catch { }
  if (crossTabChannel) {
    try {
      crossTabChannel.postMessage({ type: 'CFT_PO_DELETED', poId });
    } catch { }
  }
};

const stripRecentlyDeleted = (orders: PurchaseOrder[]): PurchaseOrder[] => {
  const now = Date.now();
  for (const [id, ts] of recentlyDeletedOrders) {
    if (now - ts > LOCAL_TOMBSTONE_TTL_MS) recentlyDeletedOrders.delete(id);
  }
  let localDeletedIds: string[] = [];
  try {
    localDeletedIds = JSON.parse(localStorage.getItem('cft_deleted_order_ids') || '[]');
  } catch { }
  const deletedSet = new Set([...recentlyDeletedOrders.keys(), ...localDeletedIds]);
  if (deletedSet.size === 0) return orders;
  return orders.filter(o => !deletedSet.has(o.id));
};

/**
 * Ensures any date value (whether valid ISO YYYY-MM-DD, a Date object, or legacy truncated
 * string like "Wed Oct 14") is converted safely to a strict YYYY-MM-DD calendar string.
 */
export function sanitizeDateStr(val: any, fallback?: string): string {
  if (!val) return fallback || '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return fallback || '';
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str) return fallback || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}$/.test(str)) {
    const currentYear = new Date().getFullYear();
    const withYear = `${str} ${currentYear}`;
    const p = new Date(withYear);
    if (!isNaN(p.getTime())) {
      const m = String(p.getMonth() + 1).padStart(2, '0');
      const d = String(p.getDate()).padStart(2, '0');
      return `${currentYear}-${m}-${d}`;
    }
  }
  const parsed = new Date(val);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return fallback || todayLocal();
}

const saveSharedState = async (key: StorageKey, value: unknown): Promise<boolean> => {
  const config = getStorageConfig();
  const endpoint = getSharedStateEndpoint(config);
  const serialized = JSON.stringify(value);
  const body = JSON.stringify({ [key]: value });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Organization-Id': config.organizationId
        },
        body
      });
      if (res.ok) {
        clearPendingSharedSync(key, serialized);
        emitStorageSyncStatus(true);
        return true;
      }
      if (attempt === 2) {
        console.warn(`[Storage Sync Warning] PUT ${endpoint} returned status ${res.status}`);
      }
    } catch (err) {
      if (attempt === 2) {
        console.warn(`[Storage Sync Network Error] Failed to persist ${key} to ${endpoint}:`, err);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
  }
  return false;
};
const getPurchaseOrderStatus = (productLines: PurchaseOrder['productLines'], isClosed = false): PurchaseOrder['status'] => {
  if (isClosed) return 'Closed';
  if (productLines.length > 0 && productLines.every(line => (line.milestones || []).length > 0 && line.status === 'Completed')) return 'Completed';
  if (productLines.some(line => line.status === 'Delayed' || (line.overallVarianceDays || 0) > 0)) return 'Delayed';
  if (productLines.some(line => line.status === 'At Risk')) return 'At Risk';
  return 'In Progress';
};

/**
 * Recomputes a PO's rollup status after its lines changed without clobbering a
 * terminal/pending state (Baseline Pending, Closed, Cancelled).
 */
const withRefreshedStatus = (po: PurchaseOrder, productLines: PurchaseOrder['productLines']): PurchaseOrder => {
  const isBaselineDone = productLines.length > 0 && productLines.every(line => {
    const pm = (line.milestones || []).find(m => m.key === 'pm_baseline' || m.key === 'baseline_review' || m.stageOrder === 3);
    return pm?.status === 'Completed' || Boolean(pm?.actualEndDate) || (pm?.completionPct === 100);
  });
  const hasSubsequentProgress = productLines.some(line =>
    (line.milestones || []).some(m => m.stageOrder > 3 && (m.status === 'Completed' || Boolean(m.actualStartDate) || Boolean(m.actualEndDate)))
  );
  const stillPendingBaseline = (po.status === 'Baseline Pending') && !isBaselineDone && !hasSubsequentProgress;

  const cleanLines = stillPendingBaseline
    ? productLines.map(line => ({
      ...line,
      overallVarianceDays: 0,
      status: (line.milestones.some(m => m.status === 'In Progress') ? 'In Progress' : 'On Track') as MilestoneStatus,
      milestones: line.milestones.map(m => ({
        ...m,
        varianceDays: 0
      }))
    }))
    : productLines;

  return {
    ...po,
    productLines: cleanLines,
    status: po.isCancelled || po.status === 'Cancelled'
      ? 'Cancelled'
      : po.isClosed
        ? 'Closed'
        : stillPendingBaseline
          ? 'Baseline Pending'
          : getPurchaseOrderStatus(cleanLines, po.isClosed),
    lastUpdatedAt: new Date().toISOString()
  };
};

/** Reads the stored risk thresholds so load-time recalculation matches the configured ones. */
function loadConfigThresholds(): { atRisk: number; delayed: number } {
  try {
    const saved = localStorage.getItem('cft_config');
    if (saved) {
      const cfg = JSON.parse(saved) as SystemConfig;
      return {
        atRisk: cfg.atRiskThresholdDays ?? 3,
        delayed: cfg.delayedThresholdDays ?? 7
      };
    }
  } catch {
    // fall through to defaults
  }
  return { atRisk: 3, delayed: 7 };
}

const STAGE_ORDER_MAP: Record<string, number> = {
  po_from_customer: 1,
  corb_release: 2,
  pm_baseline: 3,
  baseline_review: 3,
  bom_release: 4,
  wo_release: 5,
  sub_supplier_po: 6,
  material_receipt: 7,
  raw_material: 7,
  machining: 8,
  assembly: 9,
  fg: 10,
  qc_pass: 10,
  customer_inspection: 11,
  painting: 12,
  trn: 13,
  shipment: 14
};

const ALIGNED_14_STAGES = [
  { key: 'po_from_customer', name: '1. Customer Purchase Order (PO)', durationDays: 1 },
  { key: 'corb_release', name: '2. CORB Release', durationDays: 2 },
  { key: 'pm_baseline', name: '3. Baseline Review & Planning', durationDays: 3 },
  { key: 'bom_release', name: '4. BOM Release', durationDays: 4 },
  { key: 'wo_release', name: '5. Work Order Release', durationDays: 2 },
  { key: 'sub_supplier_po', name: '6. Sub-Supplier PO', durationDays: 3 },
  { key: 'material_receipt', name: '7. Material Receipt (GRN)', durationDays: 14 },
  { key: 'machining', name: '8. Machining', durationDays: 14 },
  { key: 'assembly', name: '9. Assembly', durationDays: 5 },
  { key: 'fg', name: '10. FG', durationDays: 2 },
  { key: 'customer_inspection', name: '11. Customer Inspection', durationDays: 2 },
  { key: 'painting', name: '12. Painting', durationDays: 2 },
  { key: 'trn', name: '13. TRN', durationDays: 1 },
  { key: 'shipment', name: '14. Final Shipment & Dispatch', durationDays: 5 },
];

function repairMilestonesTo14Aligned(
  existingMilestones: Milestone[],
  poDate: string,
  lineId: string,
  targetEndDate?: string,
  materials?: MaterialItem[]
): Milestone[] {
  const cleanExistingMilestones = existingMilestones || [];
  const start = poDate && isValidDateString(poDate) ? poDate : todayLocal();
  const rawMaterialLeadTime = materials && materials.length > 0
    ? Math.max(...materials.map(m => m.leadTimeDays))
    : 14;

  // If the product line already has 14 fully initialized milestones with committed baseline dates,
  // preserve the established baseline schedule without wiping or re-scaling, ensuring consecutive continuity.
  const hasFullCommitted14 = cleanExistingMilestones.length === 14 &&
    cleanExistingMilestones.every(m => m.key === 'corb_release' || (m.committedBaselineStartDate && m.committedBaselineEndDate));

  if (hasFullCommitted14) {
    let runningChainDate = start;
    return ALIGNED_14_STAGES.map((def, idx) => {
      const existing = cleanExistingMilestones.find(m => m.key === def.key || (m.key === 'baseline_review' && def.key === 'pm_baseline') || (m.key === 'qc_pass' && def.key === 'fg')) || cleanExistingMilestones[idx];
      // Imported spreadsheets are authoritative for each explicit baseline date.
      // Do not rebuild a contiguous chain here: real tracker plans may contain
      // gaps or out-of-order anchors, and regenerating them changes the Excel plan.
      const isCorb = def.key === 'corb_release';
      const msStart = isCorb ? '' : (existing.committedBaselineStartDate || (idx === 0 ? start : runningChainDate));
      const isMatStage = def.key === 'material_receipt' || def.key === 'raw_material';
      const baseDur = isCorb ? 0 : (isMatStage && rawMaterialLeadTime > 0
        ? Math.max(existing.committedDurationDays || def.durationDays, rawMaterialLeadTime)
        : Math.max(1, existing.committedDurationDays || def.durationDays));
      const msEnd = isCorb ? '' : (existing.committedBaselineEndDate || addDays(msStart, baseDur - 1));
      if (!isCorb) {
        runningChainDate = addDays(msEnd, 1);
      }

      const isStage1 = def.key === 'po_from_customer' || idx === 0;
      const currentStageNum = STAGE_ORDER_MAP[def.key] || (idx + 1);
      const hasLaterProgress = cleanExistingMilestones.some(m => {
        const order = STAGE_ORDER_MAP[m.key] || m.stageOrder || 0;
        return order > currentStageNum && (m.status === 'Completed' || Boolean(m.actualEndDate) || Boolean(m.actualStartDate) || m.status === 'In Progress');
      });
      const stage1Start = isStage1
        ? (existing?.actualStartDate || poDate || msStart)
        : isCorb
          ? undefined
          : (existing?.actualStartDate || (hasLaterProgress ? (existing?.committedBaselineStartDate || msStart) : undefined));
      const stage1End = isStage1
        ? (existing?.actualEndDate || stage1Start || poDate || msStart)
        : isCorb
          ? existing?.actualEndDate
          : (existing?.actualEndDate || (hasLaterProgress ? (existing?.committedBaselineEndDate || msEnd) : undefined));
      const isEffectivelyCompleted = isStage1
        ? true
        : isCorb
          ? Boolean(existing?.actualEndDate)
          : (def.key === 'pm_baseline' || def.key === 'baseline_review')
            ? (Boolean(existing?.actualEndDate) && existing?.status === 'Completed')
            : (Boolean(stage1End) || (hasLaterProgress && Boolean(stage1Start)));

      return {
        ...existing,
        id: existing.id || `ms-${lineId}-${def.key}`,
        key: def.key,
        name: def.name,
        stageOrder: idx + 1,
        committedBaselineStartDate: msStart,
        committedBaselineEndDate: msEnd,
        committedDurationDays: baseDur,
        actualStartDate: stage1Start,
        actualEndDate: stage1End,
        forecastStartDate: isCorb ? '' : (existing.forecastStartDate || stage1Start || msStart),
        forecastEndDate: isCorb ? (existing?.actualEndDate || '') : (existing.forecastEndDate || stage1End || msEnd),
        varianceDays: (isStage1 || isCorb) ? 0 : (existing?.varianceDays || 0),
        status: isEffectivelyCompleted ? ('Completed' as MilestoneStatus) : (stage1Start ? ('In Progress' as MilestoneStatus) : (existing?.status || ('Not Started' as MilestoneStatus))),
        completionPct: isEffectivelyCompleted ? 100 : (stage1Start ? Math.max(existing?.completionPct || 50, 50) : (existing?.completionPct || 0)),
        docRef: isStage1 ? (existing?.docRef || 'PO-INTAKE') : existing?.docRef
      };
    });
  }

  // Otherwise, construct new aligned 14 stages while protecting physical material lead times
  const rawDurations = ALIGNED_14_STAGES.map(s => {
    return (s.key === 'material_receipt' || s.key === 'raw_material') && rawMaterialLeadTime > 0
      ? Math.max(s.durationDays, rawMaterialLeadTime)
      : s.durationDays;
  });

  const targetTotalDays = targetEndDate && isValidDateString(targetEndDate) && targetEndDate > start
    ? Math.max(ALIGNED_14_STAGES.length, getDaysDifference(start, targetEndDate) + 1)
    : null;

  let scaledDurations = [...rawDurations];
  if (targetTotalDays) {
    const matIdx = ALIGNED_14_STAGES.findIndex(s => s.key === 'material_receipt');
    const protectedMat = Math.min(rawMaterialLeadTime, Math.max(1, targetTotalDays - (ALIGNED_14_STAGES.length - 1)));
    const nonMatRawDays = rawDurations.reduce((sum, d, idx) => idx === matIdx ? sum : sum + d, 0);
    const remainingTargetDays = Math.max(ALIGNED_14_STAGES.length - 1, targetTotalDays - protectedMat);
    let allocatedNonMatDays = 0;
    const nonMatCount = ALIGNED_14_STAGES.length - 1;
    let nonMatSeen = 0;

    scaledDurations = rawDurations.map((rawD, idx) => {
      if (idx === matIdx) return protectedMat;
      nonMatSeen++;
      if (nonMatSeen === nonMatCount) {
        return Math.max(1, remainingTargetDays - allocatedNonMatDays);
      }
      const prop = Math.max(1, Math.round((rawD / (nonMatRawDays || 1)) * remainingTargetDays));
      allocatedNonMatDays += prop;
      return prop;
    });
  }

  let runningDate = start;
  return ALIGNED_14_STAGES.map((def, idx) => {
    const existing = cleanExistingMilestones.find(m => m.key === def.key || (m.key === 'baseline_review' && def.key === 'pm_baseline') || (m.key === 'qc_pass' && def.key === 'fg')) || cleanExistingMilestones[idx];
    const isCorb = def.key === 'corb_release';
    const duration = isCorb ? 0 : scaledDurations[idx];
    const msStart = isCorb ? '' : runningDate;
    const msEnd = isCorb ? '' : addDays(msStart, Math.max(1, duration) - 1);
    if (!isCorb) {
      runningDate = addDays(msEnd, 1);
    }
    const isStage1 = def.key === 'po_from_customer' || idx === 0;
    const currentStageNum = STAGE_ORDER_MAP[def.key] || (idx + 1);
    const hasLaterProgress = cleanExistingMilestones.some(m => {
      const order = STAGE_ORDER_MAP[m.key] || m.stageOrder || 0;
      return order > currentStageNum && (m.status === 'Completed' || Boolean(m.actualEndDate) || Boolean(m.actualStartDate) || m.status === 'In Progress');
    });
    const isCorbCompleted = isCorb && Boolean(existing?.actualEndDate) && existing?.status === 'Completed';
    const stage1Start = isStage1
      ? (existing?.actualStartDate || poDate || msStart)
      : isCorb
        ? undefined
        : (existing?.actualStartDate || (hasLaterProgress ? (existing?.committedBaselineStartDate || msStart) : undefined));
    const stage1End = isStage1
      ? (existing?.actualEndDate || stage1Start || poDate || msStart)
      : isCorb
        ? (isCorbCompleted ? existing?.actualEndDate : undefined)
        : (existing?.actualEndDate || (hasLaterProgress ? (existing?.committedBaselineEndDate || msEnd) : undefined));
    const isEffectivelyCompleted = isStage1
      ? true
      : isCorb
        ? isCorbCompleted
        : (def.key === 'pm_baseline' || def.key === 'baseline_review')
          ? (Boolean(existing?.actualEndDate) && existing?.status === 'Completed')
          : (Boolean(stage1End) || (hasLaterProgress && Boolean(stage1Start)));

    return {
      id: `ms-${lineId}-${def.key}`,
      key: def.key,
      name: def.name,
      stageOrder: idx + 1,
      defaultDurationDays: duration,
      committedBaselineStartDate: msStart,
      committedBaselineEndDate: msEnd,
      committedDurationDays: duration,
      actualStartDate: stage1Start,
      actualEndDate: stage1End,
      forecastStartDate: isCorb ? '' : (existing?.forecastStartDate || stage1Start || msStart),
      forecastEndDate: isCorb ? (existing?.actualEndDate || '') : (existing?.forecastEndDate || stage1End || msEnd),
      varianceDays: (isStage1 || isCorb) ? 0 : (existing?.varianceDays || 0),
      status: isEffectivelyCompleted ? ('Completed' as MilestoneStatus) : (stage1Start ? ('In Progress' as MilestoneStatus) : (existing?.status || ('Not Started' as MilestoneStatus))),
      completionPct: isEffectivelyCompleted ? 100 : (stage1Start ? Math.max(existing?.completionPct || 50, 50) : (existing?.completionPct || 0)),
      docRef: isStage1 ? (existing?.docRef || 'PO-INTAKE') : existing?.docRef,
      delayCategory: existing?.delayCategory,
      delayOwner: existing?.delayOwner,
      delayReason: existing?.delayReason
    };
  });
}

const normalizeMilestoneFlows = (orders: PurchaseOrder[], todayStr: string): PurchaseOrder[] => orders.map(po => {
  const cleanPoDate = sanitizeDateStr(po.poDate, todayStr);
  const cleanCommittedDate = sanitizeDateStr(po.committedDeliveryDate, cleanPoDate);
  const cleanRevisedDate = sanitizeDateStr(po.revisedDeliveryDate, cleanCommittedDate);

  const recalculatedLines = po.productLines.map(line => {
    const cleanMs = (line.milestones || []).map(m => ({
      ...m,
      committedBaselineStartDate: m.key === 'corb_release' ? '' : sanitizeDateStr(m.committedBaselineStartDate, cleanPoDate),
      committedBaselineEndDate: m.key === 'corb_release' ? '' : sanitizeDateStr(m.committedBaselineEndDate, cleanCommittedDate),
      actualStartDate: m.key === 'corb_release' ? undefined : (m.actualStartDate ? sanitizeDateStr(m.actualStartDate) : undefined),
      actualEndDate: m.actualEndDate ? sanitizeDateStr(m.actualEndDate) : undefined,
      forecastStartDate: m.key === 'corb_release' ? '' : sanitizeDateStr(m.forecastStartDate, cleanPoDate),
      forecastEndDate: m.key === 'corb_release' ? (m.actualEndDate ? sanitizeDateStr(m.actualEndDate) : '') : sanitizeDateStr(m.forecastEndDate, cleanCommittedDate),
    }));
    const cleanMats = (line.materials || []).map(mat => ({
      ...mat,
      orderedDate: mat.orderedDate ? sanitizeDateStr(mat.orderedDate) : undefined,
      expectedDate: mat.expectedDate ? sanitizeDateStr(mat.expectedDate) : undefined,
      dispatchedDate: mat.dispatchedDate ? sanitizeDateStr(mat.dispatchedDate) : undefined,
      receivedDate: mat.receivedDate ? sanitizeDateStr(mat.receivedDate) : undefined,
    }));

    const milestones = repairMilestonesTo14Aligned(cleanMs, cleanPoDate, line.id, cleanCommittedDate, cleanMats);
    const materials = normalizeMaterialDates(cleanMats, todayStr);

    const syncedLine = applyMaterialProgress({ ...line, materials, milestones });
    const { atRisk, delayed } = loadConfigThresholds();
    return recalculateProductLine(syncedLine, todayStr, atRisk, delayed);
  });

  const maxFinalForecast = recalculatedLines.reduce((latest, l) => {
    const lastMs = (l.milestones || []).slice(-1)[0];
    const end = lastMs?.actualEndDate || lastMs?.forecastEndDate || lastMs?.committedBaselineEndDate;
    if (!latest) return end || '';
    return end && end > latest ? end : latest;
  }, '');

  const isBaselineDone = recalculatedLines.length > 0 && recalculatedLines.every(line => {
    const pm = (line.milestones || []).find(m => m.key === 'pm_baseline' || m.key === 'baseline_review' || m.stageOrder === 3);
    return pm?.status === 'Completed' || Boolean(pm?.actualEndDate) || (pm?.completionPct === 100);
  });
  const hasSubsequentProgress = recalculatedLines.some(line =>
    (line.milestones || []).some(m => m.stageOrder > 3 && (m.status === 'Completed' || Boolean(m.actualStartDate) || Boolean(m.actualEndDate)))
  );
  const stillPendingBaseline = (po.status === 'Baseline Pending') && !isBaselineDone && !hasSubsequentProgress;

  const productLines = stillPendingBaseline
    ? recalculatedLines.map(line => ({
      ...line,
      overallVarianceDays: 0,
      status: (line.milestones.some(m => m.status === 'In Progress') ? 'In Progress' : 'On Track') as MilestoneStatus,
      milestones: line.milestones.map(m => ({
        ...m,
        varianceDays: 0
      }))
    }))
    : recalculatedLines;

  return {
    ...po,
    poDate: cleanPoDate,
    committedDeliveryDate: cleanCommittedDate,
    revisedDeliveryDate: stillPendingBaseline
      ? cleanCommittedDate
      : ((maxFinalForecast && maxFinalForecast > cleanCommittedDate) ? maxFinalForecast : cleanRevisedDate),
    productLines,
    status: po.isCancelled || po.status === 'Cancelled'
      ? 'Cancelled'
      : po.isClosed ? 'Closed' : stillPendingBaseline ? 'Baseline Pending' : getPurchaseOrderStatus(productLines, po.isClosed)
  };
});

/**
 * Syncs the material_receipt / raw_material milestones from the material items.
 */
function applyMaterialProgress(line: ProductLine): ProductLine {
  const materials = line.materials;
  if (!materials || materials.length === 0) return line;

  const receivedMaterials = materials.filter(m => Boolean(m.receivedDate));
  const allReceived = receivedMaterials.length === materials.length;
  const allPassed = materials.every(m => m.inspectionResult === 'Passed');
  const firstOrderedDate = materials.filter(m => m.orderedDate).map(m => m.orderedDate!).sort()[0];
  const lastReceivedDate = receivedMaterials.map(m => m.receivedDate!).sort().slice(-1)[0];

  const milestones = line.milestones.map(ms => {
    if (ms.key === 'material_receipt' || ms.key === 'raw_material') {
      const isCompleted = allReceived && (allPassed || materials.length === 0);
      const isStarted = receivedMaterials.length > 0 || Boolean(firstOrderedDate);
      return {
        ...ms,
        status: isCompleted ? ('Completed' as MilestoneStatus) : isStarted ? ('In Progress' as MilestoneStatus) : ms.status,
        actualStartDate: ms.actualStartDate || firstOrderedDate,
        actualEndDate: isCompleted ? (ms.actualEndDate || lastReceivedDate || todayLocal()) : ms.actualEndDate,
        completionPct: isCompleted ? 100 : isStarted ? Math.max(ms.completionPct || 0, Math.round((receivedMaterials.length / materials.length) * 100)) : ms.completionPct
      };
    }
    return ms;
  });

  return { ...line, milestones };
}

/**
 * Sub-task target windows must sit inside their milestone and obey start <= end.
 * Target dates are plans, so a future date is fine — only actual events are
 * bounded by today. Shared by add/update so the panel and the store enforce
 * the same rule.
 */
export function _validateSubdivisionDates(
  targetStart: string | undefined,
  targetEnd: string | undefined,
  orders: PurchaseOrder[],
  poId: string,
  lineId: string,
  milestoneId: string
): string | undefined {
  for (const [label, value] of [['target start', targetStart], ['target end', targetEnd]] as const) {
    if (value && !isValidDateString(value)) {
      return `Invalid ${label}. Expected a real calendar date (YYYY-MM-DD).`;
    }
  }
  if (targetStart && targetEnd && targetStart > targetEnd) {
    return 'Date Sync Error: Target start cannot be after the target end.';
  }
  const hostMs = orders.find(p => p.id === poId)
    ?.productLines.find(l => l.id === lineId)
    ?.milestones.find(m => m.id === milestoneId);
  if (hostMs) {
    const winStart = hostMs.forecastStartDate || hostMs.committedBaselineStartDate;
    const winEnd = hostMs.forecastEndDate || hostMs.committedBaselineEndDate;
    if (targetStart && winStart && targetStart < winStart) {
      return `Date Sync Error: Target start cannot be before the milestone start (${winStart}).`;
    }
    if (targetEnd && winEnd && targetEnd > winEnd) {
      return `Date Sync Error: Target end cannot be after the milestone end (${winEnd}).`;
    }
  }
  return undefined;
}

const LEGACY_MOCK_PATTERNS = [
  'po-101',
  'po-102',
  'CFT-PO-2026-0891',
  'CFT-PO-2026-0904',
  'CFT-PO-2026-8471',
  'CFT-PO-2026-6671',
  'CFT-PO-2026-5394'
];

function isLegacyMockPO(po: any): boolean {
  if (!po) return true;
  if (LEGACY_MOCK_PATTERNS.includes(po.id)) return true;
  if (po.poNumber && LEGACY_MOCK_PATTERNS.some(num => po.poNumber.includes(num))) return true;
  return false;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // TODO: enforce server-side in org-api adapter — activeRole is client-only until authenticated backend exists
  const [activeRole, setActiveRoleState] = useState<Role>(() => {
    try {
      const saved = localStorage.getItem('cft_active_role');
      if (saved) return saved as Role;
    } catch { }
    return 'Project Management';
  });

  const setActiveRole = (role: Role) => {
    setActiveRoleState(role);
    try {
      localStorage.setItem('cft_active_role', role);
    } catch { }
  };
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => {
    try {
      const saved = localStorage.getItem('cft_pos');
      if (saved) {
        const parsed: PurchaseOrder[] = JSON.parse(saved);
        const clean = parsed.filter(po => !isLegacyMockPO(po));
        return normalizeMilestoneFlows(clean, todayLocal());
      }
      return [];
    } catch {
      return [];
    }
  });

  const [products, setProducts] = useState<ProductMasterItem[]>(() => {
    try {
      const saved = localStorage.getItem('cft_products');
      return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  const [templates, setTemplates] = useState<CategoryTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('cft_templates');
      const parsed: CategoryTemplate[] = saved ? JSON.parse(saved) : INITIAL_TEMPLATES;
      // Filter or fallback to ensure only the 2 distinct design types exist
      if (Array.isArray(parsed) && parsed.length === 2 && parsed.some(t => t.designType === 'Existing Design') && parsed.some(t => t.designType === 'New Design')) {
        return parsed;
      }
      return INITIAL_TEMPLATES;
    } catch {
      return INITIAL_TEMPLATES;
    }
  });

  const [rectifications, setRectifications] = useState<RectificationAction[]>(() => {
    try {
      const saved = localStorage.getItem('cft_rectifications');
      const parsed: RectificationAction[] = saved ? JSON.parse(saved) : INITIAL_RECTIFICATIONS;
      return parsed.filter(r => r.id !== 'rect-101-1' && r.id !== 'rect-101-2');
    } catch {
      return INITIAL_RECTIFICATIONS;
    }
  });

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem('cft_audit');
      const parsed: AuditLogEntry[] = saved ? JSON.parse(saved) : INITIAL_AUDIT_LOG;
      return parsed.filter(a => !a.id.startsWith('audit-'));
    } catch {
      return INITIAL_AUDIT_LOG;
    }
  });

  const [config, setConfig] = useState<SystemConfig>(() => {
    try {
      const saved = localStorage.getItem('cft_config');
      return saved ? JSON.parse(saved) : INITIAL_CONFIG;
    } catch {
      return INITIAL_CONFIG;
    }
  });

  const purchaseOrdersRef = useRef<PurchaseOrder[]>([]);
  useEffect(() => { purchaseOrdersRef.current = purchaseOrders; }, [purchaseOrders]);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [showBlueprintModal, setShowBlueprintModal] = useState<boolean>(false);
  const [sharedStateReady, setSharedStateReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'connected' | 'offline' | 'mysql'>('connected');
  const backendFailureCountRef = useRef(0);
  const backendSuccessCountRef = useRef(0);

  // A single failed PUT or an out-of-order polling response must not make the
  // connectivity badge flap. Require consecutive evidence before changing the
  // displayed state while still surfacing a sustained outage promptly.
  const recordBackendStatus = (ok: boolean) => {
    if (ok) {
      backendFailureCountRef.current = 0;
      backendSuccessCountRef.current += 1;
      if (backendSuccessCountRef.current >= 2) setBackendStatus('connected');
      return;
    }
    backendSuccessCountRef.current = 0;
    backendFailureCountRef.current += 1;
    if (backendFailureCountRef.current >= 3) setBackendStatus('offline');
  };

  // Echo-guard: the serialized value last pushed to localStorage/server per key.
  // Prevents the live-sync poll from applying our own data back over newer
  // in-flight edits (the classic read-modify-write clobber), and stops the
  // save effects from re-PUTting unchanged data in an endless echo loop.
  const lastPushedRef = useRef<Partial<Record<StorageKey, string>>>({});
  const pendingSharedWritesRef = useRef<Set<StorageKey>>(new Set());

  const persistState = (key: StorageKey, value: unknown) => {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
    } catch (e) {
      console.error(`Failed to write to localStorage for key ${key}:`, e);
    }
    // Broadcast immediately across all open tabs
    if (crossTabChannel) {
      try {
        crossTabChannel.postMessage({
          type: 'CFT_SYNC_KEY',
          key,
          serialized,
          timestamp: Date.now()
        });
      } catch { }
    }
    if (lastPushedRef.current[key] === serialized) return;
    lastPushedRef.current[key] = serialized;
    markPendingSharedSync(key, serialized);
    pendingSharedWritesRef.current.add(key);
    void saveSharedState(key, value).finally(() => {
      pendingSharedWritesRef.current.delete(key);
    });
  };

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Keep every open tab synchronized with the shared local-storage state.
  useEffect(() => {
    const SYNC_INTERVAL_MS = 10_000;
    let syncRequestInFlight = false;

    const applyStoredState = (key: string, value: string | null) => {
      if (value === null) return;
      // Anything we apply is, by definition, the newest known value for this key:
      // if our state serializes back to exactly this, the save effect must not
      // re-PUT it (that echo is what used to clobber in-flight edits).
      lastPushedRef.current[key as StorageKey] = value;
      try {
        switch (key) {
          case 'cft_pos': {
            const raw = JSON.parse(value);
            const clean = Array.isArray(raw) ? raw.filter((p: any) => !isLegacyMockPO(p)) : [];
            const normalized = normalizeMilestoneFlows(clean, todayLocal());
            const normalizedJson = JSON.stringify(normalized);
            if (purchaseOrdersRef.current && purchaseOrdersRef.current.length > 0 && JSON.stringify(purchaseOrdersRef.current) === normalizedJson) {
              return;
            }
            purchaseOrdersRef.current = normalized;
            setPurchaseOrders(normalized);
            break;
          }
          case 'cft_products':
            setProducts(JSON.parse(value));
            break;
          case 'cft_templates': {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) && parsed.length === 2 && parsed.some((t: any) => t.designType === 'Existing Design') && parsed.some((t: any) => t.designType === 'New Design')) {
              setTemplates(parsed);
            } else {
              setTemplates(INITIAL_TEMPLATES);
            }
            break;
          }
          case 'cft_rectifications':
            setRectifications(JSON.parse(value));
            break;
          case 'cft_audit':
            setAuditLog(JSON.parse(value));
            break;
          case 'cft_config':
            setConfig(JSON.parse(value));
            break;
          default:
            break;
        }
      } catch (error) {
        console.error(`Failed to synchronize ${key} from shared storage:`, error);
      }
    };

    const syncFromStorage = () => {
      sharedStateKeys
        .forEach(key => applyStoredState(key, localStorage.getItem(key)));
    };

    const syncFromServer = async () => {
      if (syncRequestInFlight || document.visibilityState !== 'visible') return;
      syncRequestInFlight = true;
      try {
        const config = getStorageConfig();
        const endpoint = getSharedStateEndpoint(config);
        const pendingSharedSync = readPendingSharedSync();
        for (const [pendingKey, pendingSerialized] of Object.entries(pendingSharedSync)) {
          if (!pendingSerialized || !sharedStateKeys.includes(pendingKey as StorageKey)) continue;
          try {
            await saveSharedState(pendingKey as StorageKey, JSON.parse(pendingSerialized));
          } catch {
            // Keep the durable pending record and protect local state below.
          }
        }
        const response = await fetch(endpoint, {
          headers: { 'X-Organization-Id': config.organizationId }
        });
        if (!response.ok) {
          setSharedStateReady(true);
          recordBackendStatus(false);
          return;
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          setSharedStateReady(true);
          recordBackendStatus(false);
          return;
        }
        recordBackendStatus(true);
        const sharedState = await response.json() as Record<string, unknown>;
        Object.entries(sharedState).forEach(([key, value]) => {
          if (!sharedStateKeys.some(storageKey => storageKey === key)) return;
          let serialized = JSON.stringify(value);

          // A poll can overlap a local save. Keep the local snapshot until that
          // save finishes; otherwise an older server response can briefly erase
          // an edit before the next poll restores it.
          if (pendingSharedWritesRef.current.has(key as StorageKey)) return;

          // Skip our own echo: the server is only reflecting what this tab pushed.
          if (lastPushedRef.current[key as StorageKey] === serialized) return;
          // No-op: server matches what is already on disk for this key.
          if (serialized === localStorage.getItem(key)) {
            lastPushedRef.current[key as StorageKey] = serialized;
            return;
          }

          if (key === 'cft_pos') {
            // Once connected, the server snapshot is authoritative for every
            // device. LocalStorage is device-local cache, not a second source of
            // truth; merging it here caused two public devices to diverge.
            const rawSharedOrders = (Array.isArray(value) ? value : []) as PurchaseOrder[];
            serialized = JSON.stringify(stripRecentlyDeleted(rawSharedOrders));
            if (lastPushedRef.current[key as StorageKey] === serialized) return;
          }
          localStorage.setItem(key, serialized);
          applyStoredState(key, serialized);
        });
        setSharedStateReady(true);
      } catch {
        // Local storage remains the offline fallback.
        setSharedStateReady(true);
        recordBackendStatus(false);
      } finally {
        syncRequestInFlight = false;
      }
    };

    const handleFocus = () => { syncFromStorage(); void syncFromServer(); };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key) applyStoredState(event.key, event.newValue);
      else syncFromStorage();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromStorage();
        void syncFromServer();
      }
    };

    let handleChannelMessage: ((event: MessageEvent) => void) | null = null;
    if (crossTabChannel) {
      handleChannelMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'CFT_SYNC_KEY' && data.key && data.serialized) {
          applyStoredState(data.key, data.serialized);
        } else if (data.type === 'CFT_PO_DELETED' && data.poId) {
          rememberDeletedOrder(data.poId);
          setPurchaseOrders(prev => prev.filter(p => p.id !== data.poId));
        } else if (data.type === 'CFT_REQUEST_LATEST') {
          try {
            crossTabChannel.postMessage({
              type: 'CFT_REPLY_LATEST',
              states: {
                cft_pos: localStorage.getItem('cft_pos'),
                cft_products: localStorage.getItem('cft_products'),
                cft_templates: localStorage.getItem('cft_templates'),
                cft_rectifications: localStorage.getItem('cft_rectifications'),
                cft_audit: localStorage.getItem('cft_audit'),
                cft_config: localStorage.getItem('cft_config')
              }
            });
          } catch { }
        } else if (data.type === 'CFT_REPLY_LATEST' && data.states) {
          Object.entries(data.states).forEach(([k, s]) => {
            if (typeof s === 'string' && s) {
              applyStoredState(k, s);
            }
          });
        }
      };
      crossTabChannel.addEventListener('message', handleChannelMessage);
      try {
        crossTabChannel.postMessage({ type: 'CFT_REQUEST_LATEST' });
      } catch { }
    }

    // Seed the echo-guard with what is already persisted so restored state
    // is not immediately re-PUT to the server as a "change".
    sharedStateKeys.forEach(key => {
      const current = localStorage.getItem(key);
      if (current !== null) lastPushedRef.current[key] = current;
    });

    const handleStorageSyncStatus = (event: Event) => {
      const ok = (event as CustomEvent<{ ok?: boolean }>)?.detail?.ok === true;
      recordBackendStatus(ok);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(STORAGE_SYNC_EVENT, handleStorageSyncStatus);
    syncFromStorage();
    void syncFromServer();
    const serverSyncTimer = window.setInterval(() => { void syncFromServer(); }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(STORAGE_SYNC_EVENT, handleStorageSyncStatus);
      if (crossTabChannel && handleChannelMessage) {
        crossTabChannel.removeEventListener('message', handleChannelMessage);
      }
      window.clearInterval(serverSyncTimer);
    };
  }, []);

  // Save changes to localStorage
  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_pos', purchaseOrders);
  }, [purchaseOrders, sharedStateReady]);

  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_products', products);
  }, [products, sharedStateReady]);

  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_templates', templates);
  }, [templates, sharedStateReady]);

  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_rectifications', rectifications);
  }, [rectifications, sharedStateReady]);

  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_audit', auditLog);
  }, [auditLog, sharedStateReady]);

  useEffect(() => {
    if (!sharedStateReady) return;
    persistState('cft_config', config);
  }, [config, sharedStateReady]);


  const addAudit = (user: string, role: Role, poNumber: string, action: string, docRef: string, details: string, productLine?: string, backdateReason?: string) => {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      user,
      role,
      poNumber,
      productLine,
      action,
      docRef,
      details,
      backdateReason
    };
    setAuditLog(prev => [entry, ...prev]);
  };

  const acceptMilestone = ({ poId, productLineId, milestoneKey, user }: { poId: string; productLineId: string; milestoneKey: string; user: string }) => {
    if (!isMilestoneOwnedByRole(milestoneKey, activeRole)) {
      return { success: false, error: 'Unauthorized: This milestone belongs to another role.' };
    }

    const updatedPOs = purchaseOrders.map(po => po.id !== poId || po.isClosed ? po : ({
      ...po,
      productLines: po.productLines.map(line => line.id !== productLineId ? line : ({
        ...line,
        milestones: line.milestones.map(milestone => milestone.key !== milestoneKey ? milestone : ({
          ...milestone,
          acceptedBy: user,
          acceptedAt: new Date().toISOString()
        }))
      })),
      lastUpdatedBy: user,
      lastUpdatedAt: new Date().toISOString()
    }));

    setPurchaseOrders(updatedPOs);
    persistState('cft_pos', updatedPOs);
    return { success: true };
  };

  /**
   * Cascades the completion date of a milestone into the next milestone's start date,
   * and propagates forecast dates through all subsequent not-yet-completed milestones.
   * This keeps the milestone chain consistent regardless of which endpoint triggered the update.
   */
  const cascadeNextMilestoneStart = (
    msList: Milestone[],
    completedIndex: number,
    completionDate: string,
    user: string
  ): Milestone[] => {
    const result = [...msList];
    for (let i = completedIndex + 1; i < result.length; i++) {
      const ms = result[i];
      if (ms.status === 'Completed') break; // stop at already-completed milestones
      if (ms.key === 'corb_release') {
        result[i] = {
          ...ms,
          committedBaselineStartDate: '',
          committedBaselineEndDate: '',
          committedDurationDays: 0,
          forecastStartDate: '',
          forecastEndDate: ms.actualEndDate || ''
        };
        continue;
      }

      const prevMs = result[i - 1];
      const prevEnd = prevMs.actualEndDate || prevMs.forecastEndDate || completionDate;

      if (i === completedIndex + 1) {
        // The immediate next milestone:
        // Do not force start date before committed baseline start date if previous milestone ended early
        const bStart = ms.committedBaselineStartDate;
        const bEnd = ms.committedBaselineEndDate;
        const newStartDate = ms.actualStartDate
          ? (ms.actualStartDate < prevEnd ? prevEnd : ms.actualStartDate)
          : (bStart && prevEnd < bStart ? bStart : prevEnd);
        const startShift = (bStart && newStartDate > bStart) ? getDaysDifference(bStart, newStartDate) : 0;
        result[i] = {
          ...ms,
          actualStartDate: ms.status === 'In Progress' ? newStartDate : ms.actualStartDate,
          forecastStartDate: newStartDate,
          forecastEndDate: ms.actualEndDate || (
            startShift > 0 && bEnd
              ? addDays(bEnd, startShift)
              : (bEnd || addDays(newStartDate, ms.committedDurationDays - 1))
          ),
          lastUpdatedBy: user,
          lastUpdatedAt: new Date().toISOString()
        };
      } else {
        // Subsequent milestones: cascade forecast dates
        const prevResult = result[i - 1];
        const bStart = ms.committedBaselineStartDate;
        const bEnd = ms.committedBaselineEndDate;
        const prevEnd = prevResult.forecastEndDate || prevResult.committedBaselineEndDate;
        const cascadeStart = (bStart && prevEnd && prevEnd <= bStart) ? bStart : (prevEnd || bStart);
        const startShift = (bStart && cascadeStart && cascadeStart > bStart) ? getDaysDifference(bStart, cascadeStart) : 0;
        const cascadeEnd = ms.actualEndDate || (
          startShift > 0 && bEnd
            ? addDays(bEnd, startShift)
            : (bEnd || (cascadeStart ? addDays(cascadeStart, ms.committedDurationDays - 1) : ''))
        );
        result[i] = {
          ...ms,
          forecastStartDate: cascadeStart,
          forecastEndDate: cascadeEnd
        };
      }
    }
    return result;
  };

  const batchUpdateMilestoneEvents = (items: Array<{
    poId: string;
    productLineId: string;
    milestoneKey: string;
    eventType: 'start' | 'complete';
    eventDate: string;
    targetEndDate?: string;
    user: string;
    docRef: string;
    backdateReason?: string;
    approvalRef?: string;
    drawingNo?: string;
    ecnNo?: string;
    delayCategory?: DelayCategory;
    delayOwner?: string;
    delayReason?: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    grnNumber?: string;
  }>): { success: boolean; error?: string; count?: number } => {
    if (items.length === 0) return { success: true, count: 0 };
    const todayStr = todayLocal();

    // 1. Validate all update items first
    for (const item of items) {
      if (!isMilestoneOwnedByRole(item.milestoneKey, activeRole)) {
        return { success: false, error: 'Unauthorized: You do not have permission to modify this milestone.' };
      }
      if (!isValidDateString(item.eventDate)) {
        return { success: false, error: 'Invalid event date. Expected a valid YYYY-MM-DD date.' };
      }
      const po = purchaseOrders.find(p => p.id === item.poId);
      if (!po) return { success: false, error: 'PO not found' };
      if (po.isClosed) return { success: false, error: 'Cannot modify closed Purchase Order.' };

      const line = po.productLines.find(l => l.id === item.productLineId);
      if (!line) return { success: false, error: 'Product Line not found' };

      const ms = line.milestones.find(m => m.key === item.milestoneKey);
      if (!ms) return { success: false, error: 'Milestone not found' };

      const currentMsIndex = line.milestones.findIndex(m => m.key === item.milestoneKey);
      const prevMs = currentMsIndex > 0 ? line.milestones[currentMsIndex - 1] : null;
      const prevActualEnd = prevMs?.actualEndDate || prevMs?.forecastEndDate;
      const duration = Math.max(1, ms.committedDurationDays || 1);

      const baselineStart = ms.committedBaselineStartDate;
      const baselineEnd = ms.committedBaselineEndDate;

      const isMaterialStage = ms.key === 'material_receipt';
      const criticalMat = line.materials?.find(m => m.isCriticalPath) || line.materials?.[0];
      const matLeadTime = (criticalMat && typeof criticalMat.leadTimeDays === 'number' && criticalMat.leadTimeDays > 0)
        ? criticalMat.leadTimeDays
        : (ms.committedDurationDays || duration);

      let isNewDelayCausedByStage = false;
      let newDelayDays = 0;
      let revisedTargetLimit = '';

      const chainedEarliest = prevActualEnd ? addDays(prevActualEnd, 1) : undefined;
      const targetStart = (baselineStart && chainedEarliest && chainedEarliest > baselineStart)
        ? chainedEarliest
        : (ms.forecastStartDate || baselineStart || chainedEarliest || '');

      if (item.milestoneKey === 'corb_release' || ms.key === 'corb_release' || ms.stageOrder === 2) {
        // Stage 2 (CORB Release) has no planned baseline dates and is strictly a gate capturing
        // the completion date that anchors subsequent BOM baseline planning. It never incurs delay variance.
        isNewDelayCausedByStage = false;
        newDelayDays = 0;
        revisedTargetLimit = '';
      } else if (isMaterialStage) {
        const targetDelivery = targetStart ? addDays(targetStart, Math.max(0, matLeadTime - 1)) : (ms.forecastEndDate || baselineEnd || '');
        const crossingLine = item.expectedDate || targetDelivery || baselineEnd || '';

        if (item.eventType === 'start') {
          const effectiveOrder = item.orderedDate || item.eventDate;
          newDelayDays = (targetStart && effectiveOrder && effectiveOrder > targetStart)
            ? getDaysDifference(targetStart, effectiveOrder)
            : 0;
          isNewDelayCausedByStage = newDelayDays > 0;
          revisedTargetLimit = targetStart;
        } else {
          // Rule: Expected delivery date is the crossing line for Stage 7 delay calculation
          const effectiveReceipt = item.receivedDate || item.eventDate;
          newDelayDays = (crossingLine && effectiveReceipt && effectiveReceipt > crossingLine)
            ? getDaysDifference(crossingLine, effectiveReceipt)
            : 0;
          isNewDelayCausedByStage = newDelayDays > 0;
          revisedTargetLimit = crossingLine;
        }
      } else if (item.eventType === 'start') {
        const totalDelay = (baselineStart && item.eventDate > baselineStart)
          ? getDaysDifference(baselineStart, item.eventDate)
          : 0;
        const inheritedDelay = (baselineStart && targetStart && targetStart > baselineStart)
          ? Math.min(totalDelay, getDaysDifference(baselineStart, targetStart))
          : 0;
        newDelayDays = (targetStart && item.eventDate > targetStart)
          ? getDaysDifference(targetStart, item.eventDate)
          : Math.max(0, totalDelay - inheritedDelay);
        isNewDelayCausedByStage = newDelayDays > 0;
        revisedTargetLimit = targetStart;
      } else {
        const effectiveStart = ms.actualStartDate || targetStart;
        const baselineDuration = (baselineStart && baselineEnd) ? Math.max(1, getDaysDifference(baselineStart, baselineEnd) + 1) : duration;
        const targetEnd = ms.forecastEndDate || (effectiveStart ? addDays(effectiveStart, baselineDuration - 1) : baselineEnd);
        newDelayDays = (targetEnd && item.eventDate > targetEnd)
          ? getDaysDifference(targetEnd, item.eventDate)
          : 0;
        isNewDelayCausedByStage = newDelayDays > 0;
        revisedTargetLimit = targetEnd || baselineEnd || '';
      }

      if (isNewDelayCausedByStage && !item.delayReason?.trim()) {
        return {
          success: false,
          error: `A delay reason is required for ${line.productName} (Stage ${ms.stageOrder}: ${ms.name.replace(/^\d+\.\s*/, '')}) because the date entered (${item.eventDate}) adds +${newDelayDays}d new delay beyond its scheduled plan (${revisedTargetLimit}).`
        };
      }

      const activeMsIndex = line.milestones.findIndex(m => m.status !== 'Completed' && !m.actualEndDate && m.completionPct !== 100);
      if (item.eventType === 'start' && (ms.status === 'Completed' || Boolean(ms.actualEndDate) || ms.completionPct === 100)) {
        return { success: false, error: `Milestone '${ms.name}' on ${line.productName} is already completed.` };
      }
      if (currentMsIndex > activeMsIndex && activeMsIndex >= 0) {
        const activeMs = line.milestones[activeMsIndex];
        return {
          success: false,
          error: `Sequence Validation Failure: Complete '${activeMs?.name || 'the current milestone'}' before updating '${ms.name}'.`
        };
      }
      if (currentMsIndex > 0) {
        const prevMs = line.milestones[currentMsIndex - 1];
        const isPrevComplete = prevMs.status === 'Completed' || Boolean(prevMs.actualEndDate) || prevMs.completionPct === 100;
        if (item.eventType === 'complete' && !isPrevComplete) {
          return {
            success: false,
            error: `Sequence Validation Failure: Milestone '${prevMs.name}' must be marked Completed before '${ms.name}' can be completed.`
          };
        }
      }

      const dateCheck = validateEventDate({
        milestones: line.milestones,
        index: currentMsIndex,
        eventType: item.eventType,
        eventDate: item.eventDate,
        todayStr
      });
      if (!dateCheck.ok) {
        return { success: false, error: `${line.productName}: ${dateCheck.error}` };
      }

      if (item.eventType === 'complete' && item.milestoneKey === 'raw_material') {
        const missingReceipt = line.materials.filter(material => !material.receivedDate);
        if (missingReceipt.length > 0) {
          return { success: false, error: 'Raw Material Procurement can be completed only after every material is marked Received in Raw Materials.' };
        }
      }
      if (item.eventType === 'complete' && item.milestoneKey === 'incoming_inspection') {
        const pendingInspection = line.materials.filter(material => material.inspectionResult !== 'Passed');
        if (pendingInspection.length > 0) {
          return { success: false, error: 'Incoming Inspection can be completed only after every material is marked Passed in Raw Materials.' };
        }
      }
      if (item.milestoneKey === 'production' && item.eventType === 'start') {
        const designMs = line.milestones.find(m => m.key === 'design_approval');
        if (designMs && designMs.status !== 'Completed') {
          return {
            success: false,
            error: `Dependency Violation: Production cannot start because Design Stage '${designMs.name}' is not yet completed/approved.`
          };
        }
        const pendingCritical = line.materials.filter(m => m.isCriticalPath && m.inspectionResult !== 'Passed');
        if (pendingCritical.length > 0) {
          return {
            success: false,
            error: `Dependency Violation: Critical path materials pending GRN passed inspection: ${pendingCritical.map(m => m.itemCode).join(', ')}.`
          };
        }
      }
    }

    // 2. Perform atomic batch update across all targeted POs and product lines
    const updatedPOs = purchaseOrders.map(p => {
      const itemsForPO = items.filter(it => it.poId === p.id);
      if (itemsForPO.length === 0) return p;

      const updatedLines = p.productLines.map(l => {
        const item = itemsForPO.find(it => it.productLineId === l.id);
        if (!item) return l;

        // Ensure milestones are canonically sorted: 1. po_from_customer, 2. corb_release, 3. pm_baseline ...
        const sortedMilestones = [...l.milestones].sort((a, b) => {
          const oA = STAGE_ORDER_MAP[a.key] || a.stageOrder || 0;
          const oB = STAGE_ORDER_MAP[b.key] || b.stageOrder || 0;
          return oA - oB;
        });

        const currentMsIndex = sortedMilestones.findIndex(m => m.key === item.milestoneKey);
        let updatedMsList = sortedMilestones.map((m, sIdx) => {
          if (m.key !== item.milestoneKey) return { ...m, stageOrder: sIdx + 1 };

          const newMs = { ...m, stageOrder: sIdx + 1 };
          if (item.eventType === 'start') {
            newMs.actualStartDate = item.eventDate;
            newMs.forecastStartDate = item.eventDate;
            newMs.forecastEndDate = item.targetEndDate || m.actualEndDate || addDays(item.eventDate, m.committedDurationDays - 1);
            newMs.status = 'In Progress' as MilestoneStatus;
          } else {
            if (!newMs.actualStartDate) {
              const anchor = chainAnchorDate(sortedMilestones, currentMsIndex, todayStr);
              newMs.actualStartDate = anchor && anchor <= item.eventDate ? anchor : item.eventDate;
            }
            newMs.actualEndDate = item.eventDate;
            newMs.forecastEndDate = item.eventDate;
            newMs.status = 'Completed' as MilestoneStatus;
            newMs.completionPct = 100;
            if (item.milestoneKey === 'corb_release') {
              newMs.varianceDays = 0;
              newMs.delayCategory = undefined;
              newMs.delayOwner = undefined;
              newMs.delayReason = undefined;
            }
          }

          if (item.approvalRef) newMs.approvalReference = item.approvalRef;
          if (item.drawingNo) newMs.drawingNumber = item.drawingNo;
          if (item.ecnNo) newMs.ecnNumber = item.ecnNo;
          if (item.milestoneKey !== 'corb_release') {
            if (item.delayCategory) newMs.delayCategory = item.delayCategory;
            if (item.delayOwner) newMs.delayOwner = item.delayOwner;
            if (item.delayReason && !item.delayReason.startsWith('Inherited') && !item.delayReason.startsWith('Cascaded')) {
              newMs.delayReason = item.delayReason;
            }
          }

          newMs.lastUpdatedBy = item.user;
          newMs.lastUpdatedAt = new Date().toISOString();
          newMs.docRef = item.docRef;
          if (item.backdateReason) newMs.backdateReason = item.backdateReason;

          return newMs;
        });

        // When completing or starting a milestone, auto-complete any uncompleted preceding milestones
        // NOTE: Stage 3 (pm_baseline) is a manual baseline approval step and must NEVER be auto-completed
        if (item.eventType === 'complete' || item.eventType === 'start') {
          for (let pIdx = 0; pIdx < currentMsIndex; pIdx++) {
            const pm = updatedMsList[pIdx];
            if (pm.key === 'pm_baseline' || pm.key === 'baseline_review') continue;
            if (!pm.actualEndDate || pm.status !== 'Completed') {
              const prevCompletedEnd = pIdx > 0
                ? (updatedMsList[pIdx - 1].actualEndDate || updatedMsList[pIdx - 1].forecastEndDate || p.poDate || todayStr)
                : (p.poDate || todayStr);
              const pStart = pm.actualStartDate || pm.committedBaselineStartDate || prevCompletedEnd;
              const pEnd = pm.actualEndDate || pm.committedBaselineEndDate || (pStart ? addDays(pStart, Math.max(0, pm.committedDurationDays - 1)) : item.eventDate);
              updatedMsList[pIdx] = {
                ...pm,
                actualStartDate: pStart,
                actualEndDate: pEnd,
                forecastStartDate: pStart,
                forecastEndDate: pEnd,
                status: 'Completed' as MilestoneStatus,
                completionPct: 100,
                docRef: pm.docRef || (pIdx === 0 ? 'PO-INTAKE' : 'PM-AUTO-APPROVED')
              };
            }
          }
        }
        if (item.milestoneKey === 'corb_release' && item.eventType === 'complete') {
          const { milestones: recalcedBOM } = calculateMilestonesFromBOM({
            milestones: updatedMsList,
            poDate: p.poDate || todayStr,
            corbEndDate: item.eventDate,
            deliveryDate: p.committedDeliveryDate,
            materials: l.materials
          });
          updatedMsList = recalcedBOM.map(m => {
            if (m.key === 'corb_release') {
              return {
                ...m,
                actualEndDate: item.eventDate,
                forecastEndDate: item.eventDate,
                status: 'Completed' as MilestoneStatus,
                completionPct: 100,
                varianceDays: 0
              };
            }
            return m;
          });
        } else if (item.eventType === 'complete') {
          updatedMsList = cascadeNextMilestoneStart(updatedMsList, currentMsIndex, item.eventDate, item.user);
        }

        // Update line materials if material receipt data provided
        let updatedMaterials = l.materials;
        if ((item.milestoneKey === 'material_receipt' || item.milestoneKey === 'raw_material') && l.materials && l.materials.length > 0) {
          updatedMaterials = l.materials.map(mat => ({
            ...mat,
            orderedDate: item.orderedDate || mat.orderedDate || (item.eventType === 'start' ? item.eventDate : undefined),
            expectedDate: item.expectedDate || mat.expectedDate || (item.orderedDate ? addDays(item.orderedDate, Math.max(0, (mat.leadTimeDays || 14) - 1)) : undefined),
            receivedDate: item.eventType === 'complete' ? (item.receivedDate || item.eventDate) : mat.receivedDate,
            inspectionResult: item.inspectionResult || mat.inspectionResult || (item.eventType === 'complete' ? 'Passed' : mat.inspectionResult || 'Pending')
          }));
        }

        const syncedLine = applyMaterialProgress({ ...l, milestones: updatedMsList, materials: updatedMaterials });
        const tempLine = { ...syncedLine };
        const recalced = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
        if (p.status === 'Baseline Pending') {
          return {
            ...recalced,
            overallVarianceDays: 0,
            milestones: recalced.milestones.map(m => {
              if (m.key === 'corb_release') {
                return { ...m, varianceDays: 0, delayReason: undefined, delayCategory: undefined, delayOwner: undefined };
              }
              if (!m.actualStartDate && !m.actualEndDate) {
                return { ...m, varianceDays: 0, delayReason: undefined, delayCategory: undefined, delayOwner: undefined, status: 'Not Started' as MilestoneStatus };
              }
              return m;
            })
          };
        }
        return recalced;
      });

      const maxFinalForecast = updatedLines.reduce((latest, l) => {
        const lastMs = (l.milestones || []).slice(-1)[0];
        const end = lastMs?.actualEndDate || lastMs?.forecastEndDate || lastMs?.committedBaselineEndDate;
        if (!latest) return end || '';
        return end && end > latest ? end : latest;
      }, '');

      const refreshed = withRefreshedStatus(p, updatedLines);

      return {
        ...refreshed,
        revisedDeliveryDate: (maxFinalForecast && maxFinalForecast > p.committedDeliveryDate) ? maxFinalForecast : p.committedDeliveryDate,
        lastUpdatedBy: itemsForPO[0]?.user || activeRole,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updatedPOs);
    persistState('cft_pos', updatedPOs);

    // 3. Log audit events & check rectifications for each updated line
    for (const item of items) {
      const po = purchaseOrders.find(p => p.id === item.poId);
      const line = po?.productLines.find(l => l.id === item.productLineId);
      const ms = line?.milestones.find(m => m.key === item.milestoneKey);
      if (po && line && ms) {
        addAudit(
          item.user,
          activeRole,
          po.poNumber,
          item.eventType === 'start' ? `START_MILESTONE_${item.milestoneKey.toUpperCase()}` : `COMPLETE_MILESTONE_${item.milestoneKey.toUpperCase()}`,
          item.docRef,
          `Marked milestone ${ms.name} on ${line.productName} as ${item.eventType === 'start' ? 'Started' : 'Completed'} on date ${item.eventDate}.`,
          line.lineNumber,
          item.backdateReason
        );

        if (item.delayCategory) {
          const updatedLine = updatedPOs.find(p => p.id === item.poId)?.productLines.find(l => l.id === item.productLineId);
          const updatedMs = updatedLine?.milestones.find(m => m.key === item.milestoneKey);
          if (updatedMs && (updatedMs.status === 'At Risk' || updatedMs.status === 'Delayed')) {
            const newRects = generateSuggestedRectifications(po.poNumber, updatedLine!, updatedMs, item.delayCategory);
            setRectifications(prev => [...newRects, ...prev]);
          }
        }
      }
    }

    return { success: true, count: items.length };
  };

  const updateMilestoneEvent = (params: {
    poId: string;
    productLineId: string;
    milestoneKey: string;
    eventType: 'start' | 'complete';
    eventDate: string;
    targetEndDate?: string;
    user: string;
    docRef: string;
    backdateReason?: string;
    approvalRef?: string;
    drawingNo?: string;
    ecnNo?: string;
    delayCategory?: DelayCategory;
    delayOwner?: string;
    delayReason?: string;
  }) => {
    return batchUpdateMilestoneEvents([params]);
  };

  const updateOrderStatus = ({
    poId,
    productLineId,
    stageKey,
    statusAction,
    workNotes,
    completionDate,
    user
  }: {
    poId: string;
    productLineId?: string;
    stageKey: string;
    statusAction: 'In Progress' | 'Completed';
    workNotes: string;
    completionDate?: string;
    user: string;
  }) => {
    if (!isMilestoneOwnedByRole(stageKey, activeRole)) {
      return { success: false, error: 'Unauthorized: You do not have permission to modify this stage.' };
    }
    const todayStr = todayLocal();
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return { success: false, error: 'Order not found' };
    if (po.isClosed) return { success: false, error: 'Cannot update closed order.' };

    // When a specific line is targeted (Update Status modal), only that line
    // is validated and updated — otherwise every line moves together.
    const targetLines = productLineId
      ? po.productLines.filter(l => l.id === productLineId)
      : po.productLines;
    if (productLineId && targetLines.length === 0) {
      return { success: false, error: 'Product Line not found' };
    }

    if (completionDate && !isValidDateString(completionDate)) {
      return { success: false, error: 'Invalid date. Expected a valid YYYY-MM-DD date.' };
    }
    const effectiveDate = completionDate || todayStr;

    const invalidStage = targetLines.some(line => {
      const stageIndex = line.milestones.findIndex(ms => ms.key === stageKey);
      if (stageIndex < 0) return false;
      const activeIndex = line.milestones.findIndex(ms => ms.status !== 'Completed');
      return stageIndex !== activeIndex;
    });
    if (invalidStage) {
      return { success: false, error: 'Sequence Validation Failure: Update the current active milestone before moving to a later stage.' };
    }

    if (statusAction === 'Completed' && stageKey === 'raw_material') {
      const missingReceipt = targetLines.flatMap(line => line.materials).filter(material => !material.receivedDate);
      if (missingReceipt.length > 0) {
        return { success: false, error: 'Raw Material Procurement can be completed only after every material is marked Received in Raw Materials.' };
      }
    }
    if (statusAction === 'Completed' && stageKey === 'incoming_inspection') {
      const pendingInspection = targetLines.flatMap(line => line.materials).filter(material => material.inspectionResult !== 'Passed');
      if (pendingInspection.length > 0) {
        return { success: false, error: 'Incoming Inspection can be completed only after every material is marked Passed in Raw Materials.' };
      }
    }

    // Validate the date chain for EVERY target line up-front through the shared
    // validator. A stage update must apply atomically: either every target line
    // accepts the date, or none does.
    for (const line of targetLines) {
      const msIndex = line.milestones.findIndex(m => m.key === stageKey);
      if (msIndex < 0) continue;

      const check = validateEventDate({
        milestones: line.milestones,
        index: msIndex,
        eventType: statusAction === 'Completed' ? 'complete' : 'start',
        eventDate: effectiveDate,
        todayStr
      });
      if (!check.ok) {
        return { success: false, error: `${check.error} (line ${line.lineNumber})` };
      }
    }

    const updatedPOs = purchaseOrders.map(p => {
      if (p.id !== poId) return p;

      const updatedLines = p.productLines.map(line => {
        if (productLineId && line.id !== productLineId) return line;

        const msIndex = line.milestones.findIndex(m => m.key === stageKey);
        if (msIndex === -1) return line;

        let updatedMsList = line.milestones.map((ms, idx) => {
          if (idx === msIndex) {
            const updatedMs = { ...ms };
            if (statusAction === 'Completed') {
              updatedMs.status = 'Completed' as MilestoneStatus;
              updatedMs.completionPct = 100;
              updatedMs.actualEndDate = effectiveDate;
              updatedMs.forecastEndDate = effectiveDate;
              if (stageKey === 'corb_release') {
                updatedMs.varianceDays = 0;
              }
              // Preserve the recorded start, or derive one from the chain
              // anchor — never after the completion date, never in the future.
              if (!updatedMs.actualStartDate) {
                const anchor = chainAnchorDate(line.milestones, msIndex, todayStr);
                const candidates = [anchor, ms.committedBaselineStartDate]
                  .filter((d): d is string => Boolean(d) && (d as string) <= effectiveDate);
                updatedMs.actualStartDate = candidates.length > 0
                  ? candidates.sort().slice(-1)[0]
                  : effectiveDate;
              }
              updatedMs.forecastStartDate = updatedMs.actualStartDate;
            } else {
              // 'In Progress': start at the recorded event date (chain-synced >= prev end)
              updatedMs.status = 'In Progress' as MilestoneStatus;
              updatedMs.actualStartDate = effectiveDate;
              updatedMs.forecastStartDate = effectiveDate;
              updatedMs.forecastEndDate = ms.actualEndDate || addDays(effectiveDate, ms.committedDurationDays - 1);
              if (workNotes) updatedMs.docRef = workNotes;
            }
            updatedMs.lastUpdatedBy = user;
            updatedMs.lastUpdatedAt = new Date().toISOString();
            return updatedMs;
          }
          return ms;
        });

        // After completing a milestone, cascade the completion date to the next milestone
        if (statusAction === 'Completed') {
          if (stageKey === 'corb_release') {
            const { milestones: recalcedBOM } = calculateMilestonesFromBOM({
              milestones: updatedMsList,
              poDate: p.poDate || todayStr,
              corbEndDate: effectiveDate,
              deliveryDate: p.committedDeliveryDate,
              materials: line.materials
            });
            updatedMsList = recalcedBOM.map(m => {
              if (m.key === 'corb_release') {
                return {
                  ...m,
                  actualEndDate: effectiveDate,
                  forecastEndDate: effectiveDate,
                  status: 'Completed' as MilestoneStatus,
                  completionPct: 100,
                  varianceDays: 0
                };
              }
              return m;
            });
          } else {
            updatedMsList = cascadeNextMilestoneStart(updatedMsList, msIndex, effectiveDate, user);
          }
        }

        // Material receipts drive raw_material / incoming_inspection state —
        // re-sync them so completing a prior stage (e.g. PO review) instantly
        // reflects material progress instead of waiting for the next edit.
        let workingLine: ProductLine = applyMaterialProgress({ ...line, milestones: updatedMsList });

        const tempLine = { ...workingLine };
        const recalculated = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
        if (p.status === 'Baseline Pending') {
          return {
            ...recalculated,
            overallVarianceDays: 0,
            milestones: recalculated.milestones.map(m => {
              if (m.key === 'corb_release') {
                return { ...m, varianceDays: 0, delayReason: undefined, delayCategory: undefined, delayOwner: undefined };
              }
              if (!m.actualStartDate && !m.actualEndDate) {
                return { ...m, varianceDays: 0, delayReason: undefined, delayCategory: undefined, delayOwner: undefined, status: 'Not Started' as MilestoneStatus };
              }
              return m;
            })
          };
        }
        const recalculatedTarget = recalculated.milestones.find(ms => ms.key === stageKey);
        const hasCalculatedDelay = recalculatedTarget?.status === 'Delayed' || (recalculatedTarget?.varianceDays || 0) > 0;

        if (hasCalculatedDelay && recalculatedTarget) {
          recalculatedTarget.delayReason = workNotes || `Delay calculated from the ${stageKey} date entered: ${effectiveDate}.`;
        }

        return recalculated;
      });

      const maxFinalForecast = updatedLines.reduce((latest, l) => {
        const lastMs = (l.milestones || []).slice(-1)[0];
        const end = lastMs?.actualEndDate || lastMs?.forecastEndDate || lastMs?.committedBaselineEndDate;
        if (!latest) return end || '';
        return end && end > latest ? end : latest;
      }, '');

      const refreshed = withRefreshedStatus(p, updatedLines);
      return {
        ...refreshed,
        revisedDeliveryDate: (maxFinalForecast && maxFinalForecast > p.committedDeliveryDate) ? maxFinalForecast : p.committedDeliveryDate,
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updatedPOs);
    persistState('cft_pos', updatedPOs);
    addAudit(
      user,
      activeRole,
      po.poNumber,
      `UPDATE_STAGE_${stageKey.toUpperCase()}`,
      workNotes ? 'STATUS-NOTE' : 'DIRECT-UPDATE',
      `Updated order status for stage '${stageKey}' to '${statusAction}'. Notes: ${workNotes || 'No notes provided.'}`
    );

    return { success: true };
  };

  const updateMaterialItem = ({
    poId,
    productLineId,
    materialId,
    orderedDate,
    expectedDate,
    receivedDate,
    grnNumber,
    inspectionResult,
    inspectionNotes,
    user,
    docRef
  }: {
    poId: string;
    productLineId: string;
    materialId: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    grnNumber?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    inspectionNotes?: string;
    user: string;
    docRef: string;
  }) => {
    const todayStr = todayLocal();

    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return { success: false, error: 'PO not found' };
    if (po.isClosed) return { success: false, error: 'Cannot update materials on a closed Purchase Order.' };

    const line = po.productLines.find(l => l.id === productLineId);
    if (!line) return { success: false, error: 'Product Line not found' };
    if (!line.materials.some(m => m.id === materialId)) return { success: false, error: 'Material item not found' };

    const dateFields: [string, string | undefined][] = [
      ['Ordered date', orderedDate],
      ['Expected date', expectedDate],
      ['Received date', receivedDate]
    ];
    for (const [label, value] of dateFields) {
      if (value && !isValidDateString(value)) {
        return { success: false, error: `Invalid ${label.toLowerCase()}. Expected a valid YYYY-MM-DD date.` };
      }
    }

    // Explicit form semantics: '' CLEARS a date, a value SETS it, undefined
    // (field not part of this form) keeps the stored one. This replaces the
    // old empty-means-keep merge that made stuck legacy dates unfixable.
    const existingMaterial = line.materials.find(m => m.id === materialId)!;
    const effectiveOrdered = orderedDate !== undefined ? (orderedDate || undefined) : existingMaterial.orderedDate;
    const effectiveExpected = expectedDate !== undefined ? (expectedDate || undefined) : existingMaterial.expectedDate;
    const effectiveReceived = receivedDate !== undefined ? (receivedDate || undefined) : existingMaterial.receivedDate;

    // Delivery dates are physically impossible before the order was placed.
    if (effectiveOrdered && effectiveExpected && effectiveExpected < effectiveOrdered) {
      return { success: false, error: `Date Sync Error: Expected delivery date (${effectiveExpected}) cannot be before the ordered date (${effectiveOrdered}).` };
    }
    if (effectiveOrdered && effectiveReceived && effectiveReceived < effectiveOrdered) {
      return { success: false, error: `Date Sync Error: Received date (${effectiveReceived}) cannot be before the ordered date (${effectiveOrdered}).` };
    }

    const updatedPOs = purchaseOrders.map(p => {
      if (p.id !== poId) return p;
      const updatedLines = p.productLines.map(l => {
        if (l.id !== productLineId) return l;

        const updatedMats = l.materials.map(m => {
          if (m.id !== materialId) return m;
          return {
            ...m,
            orderedDate: effectiveOrdered,
            expectedDate: effectiveExpected,
            receivedDate: effectiveReceived,
            grnNumber: grnNumber !== undefined
              ? (grnNumber || undefined)
              : (effectiveReceived ? (m.grnNumber || `GRN-${effectiveReceived.replace(/-/g, '')}`) : undefined),
            inspectionResult: inspectionResult || m.inspectionResult,
            inspectionNotes: inspectionNotes !== undefined ? (inspectionNotes || undefined) : m.inspectionNotes,
            updatedBy: user,
            updatedAt: new Date().toISOString()
          };
        });

        // Material receipts drive raw_material / incoming_inspection state
        // (sequence-gated inside the helper so out-of-order data is never
        // fabricated and later wiped by the sequence normalizer).
        const syncedLine = applyMaterialProgress({ ...l, materials: updatedMats });
        const receiptMs = syncedLine.milestones.find(m => m.key === 'material_receipt' || m.key === 'raw_material');
        let milestonesToCalc = syncedLine.milestones;
        if (receiptMs && receiptMs.actualEndDate && receiptMs.status === 'Completed') {
          const rIdx = syncedLine.milestones.findIndex(m => m.id === receiptMs.id);
          milestonesToCalc = cascadeNextMilestoneStart(syncedLine.milestones, rIdx, receiptMs.actualEndDate, user);
        }
        const tempLine = { ...syncedLine, milestones: milestonesToCalc };
        return recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
      });

      const refreshed = withRefreshedStatus(p, updatedLines);
      return {
        ...refreshed,
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updatedPOs);
    persistState('cft_pos', updatedPOs);

    addAudit(
      user,
      activeRole,
      po.poNumber,
      'UPDATE_MATERIAL_ITEM',
      docRef,
      `Updated material item status for ${materialId}. GRN: ${grnNumber || 'N/A'}, Inspection: ${inspectionResult || 'Pending'}.`
    );

    return { success: true };
  };

  const addBaselineRevision = ({
    poId,
    reason,
    docRef,
    user,
    baselineStartDate,
    changes,
    milestoneFlows,
    autoFit
  }: {
    poId: string;
    reason: string;
    docRef: string;
    user: string;
    baselineStartDate?: string;
    changes: { lineId: string; milestoneKey: string; newDuration: number }[];
    milestoneFlows?: {
      lineId: string;
      milestones: { key: string; name: string; durationDays: number }[];
    }[];
    autoFit?: boolean;
  }) => {
    if (activeRole !== 'Project Manager (PM Baseline)' && activeRole !== 'Project Management') {
      return { success: false, error: 'Only the Project Manager (PM Baseline) role can approve or edit the baseline.' };
    }
    const todayStr = todayLocal();
    const targetPO = purchaseOrders.find(p => p.id === poId);
    if (!targetPO) return { success: false, error: 'PO not found' };

    if (baselineStartDate && !isValidDateString(baselineStartDate)) {
      return { success: false, error: 'Invalid baseline start date. Expected a valid YYYY-MM-DD date.' };
    }

    if (milestoneFlows) {
      for (const flow of milestoneFlows) {
        if (!flow.milestones || flow.milestones.length === 0) {
          return { success: false, error: `Custom flow for ${flow.lineId} must contain at least one milestone.` };
        }
        for (const flowMs of flow.milestones) {
          if (!Number.isFinite(flowMs.durationDays) || flowMs.durationDays < 1) {
            return { success: false, error: `Duration for milestone '${flowMs.name || flowMs.key}' must be at least 1 day.` };
          }
        }
      }
    }

    // Only block if the PO is fully closed or completed — do NOT block on 'In Progress'
    // because re-baseline (Rev 1, Rev 2...) must be possible before actual work starts.
    if (targetPO.isClosed || targetPO.status === 'Completed') {
      return { success: false, error: 'Cannot revise baseline for a closed or completed order.' };
    }

    const isInitialApproval = targetPO.status === 'Baseline Pending';
    if (isInitialApproval) {
      const corbIncomplete = targetPO.productLines.some(line => {
        const corb = line.milestones.find(m => m.key === 'corb_release');
        return !corb || (!corb.actualEndDate && corb.status !== 'Completed' && corb.completionPct !== 100);
      });
      if (corbIncomplete) {
        return { success: false, error: 'Cannot approve master baseline: Stage 2 (CORB Release) must be completed across all product lines first.' };
      }
    }
    const flowAlreadyStarted = !isInitialApproval && targetPO.productLines.some(line =>
      line.milestones.some(ms => ms.stageOrder > 3 && Boolean(ms.actualStartDate || ms.actualEndDate))
    );
    if (flowAlreadyStarted) {
      return { success: false, error: 'Baseline is locked after flow start. Continue updating milestones without changing the approved plan.' };
    }

    const updatedPOs = purchaseOrders.map(p => {
      if (p.id !== poId) return p;

      const newRevNum = (p.revisions || []).length;
      const revisionChangeDetails: any[] = [];

      const updatedLines = p.productLines.map(line => {
        const lineChanges = changes.filter(c => c.lineId === line.id);
        const customFlow = milestoneFlows?.find(flow => flow.lineId === line.id);

        if (customFlow) {
          let flowMilestones = [...customFlow.milestones];
          if (line.designType === 'Existing Design') {
            flowMilestones = flowMilestones.filter(flowMs => flowMs.key !== 'design_approval');
          } else {
            const designFlowMs = flowMilestones.find(flowMs => flowMs.key === 'design_approval') || {
              key: 'design_approval',
              name: 'Design Review & Customer Approval',
              durationDays: 25
            };
            flowMilestones = [
              designFlowMs,
              ...flowMilestones.filter(flowMs => flowMs.key !== 'design_approval')
            ];
          }

          let runningDate = baselineStartDate || line.milestones[0]?.committedBaselineStartDate || todayStr;
          let updatedMsList = flowMilestones.map((flowMs, index) => {
            const existingMs = line.milestones.find(ms => ms.key === flowMs.key);
            const duration = Math.max(1, flowMs.durationDays);
            const startDate = runningDate;
            const endDate = addDays(startDate, duration - 1);
            runningDate = addDays(endDate, 1);

            revisionChangeDetails.push({
              lineId: line.id,
              milestoneKey: flowMs.key,
              oldDuration: existingMs?.committedDurationDays || 0,
              newDuration: duration,
              oldBaselineEnd: existingMs?.committedBaselineEndDate || '',
              newBaselineEnd: endDate
            });

            return existingMs ? {
              ...existingMs,
              name: flowMs.name.trim() || existingMs.name,
              stageOrder: index + 1,
              defaultDurationDays: duration,
              committedBaselineStartDate: startDate,
              committedBaselineEndDate: endDate,
              committedDurationDays: duration
            } : {
              id: `ms-${line.id}-${flowMs.key}`,
              key: flowMs.key,
              name: flowMs.name.trim() || 'Custom Milestone',
              stageOrder: index + 1,
              defaultDurationDays: duration,
              committedBaselineStartDate: startDate,
              committedBaselineEndDate: endDate,
              committedDurationDays: duration,
              forecastStartDate: startDate,
              forecastEndDate: endDate,
              varianceDays: 0,
              status: 'Not Started' as MilestoneStatus,
              completionPct: 0
            };
          });

          // Ensure Stage 1 and Stage 2 completion in multi-product custom flows
          if (targetPO.status === 'Baseline Pending' || isInitialApproval) {
            const poIdx = updatedMsList.findIndex(m => m.key === 'po_from_customer');
            if (poIdx >= 0) {
              const poDateVal = targetPO.poDate || todayStr;
              updatedMsList[poIdx] = {
                ...updatedMsList[poIdx],
                actualStartDate: poDateVal,
                actualEndDate: poDateVal,
                status: 'Completed' as MilestoneStatus,
                completionPct: 100
              };
            }

            const pmIdx = updatedMsList.findIndex(m => m.key === 'pm_baseline' || m.key === 'baseline_review');
            if (pmIdx >= 0) {
              const pmStart = updatedMsList[pmIdx].actualStartDate || updatedMsList[pmIdx].committedBaselineStartDate || todayStr;
              const pmEnd = isInitialApproval
                ? (updatedMsList[pmIdx].committedBaselineEndDate || todayStr)
                : (todayStr > updatedMsList[pmIdx].committedBaselineEndDate ? todayStr : updatedMsList[pmIdx].committedBaselineEndDate);
              updatedMsList[pmIdx] = {
                ...updatedMsList[pmIdx],
                actualStartDate: pmStart,
                actualEndDate: pmEnd,
                forecastStartDate: pmStart,
                forecastEndDate: pmEnd,
                status: 'Completed' as MilestoneStatus,
                completionPct: 100,
                docRef: docRef || 'PM-BL-APPROVED'
              };
              updatedMsList = cascadeNextMilestoneStart(updatedMsList, pmIdx, pmEnd, user);
            }
          }

          const tempLine = { ...line, milestones: updatedMsList };
          const recalced = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
          if (isInitialApproval) {
            return {
              ...recalced,
              overallVarianceDays: 0,
              status: 'In Progress' as MilestoneStatus,
              milestones: recalced.milestones.map(m => ({
                ...m,
                varianceDays: 0,
                delayReason: undefined,
                delayCategory: undefined,
                delayOwner: undefined
              }))
            };
          }
          return recalced;
        }

        if (lineChanges.length === 0 && !baselineStartDate && !isInitialApproval) return line;

        const corbMs = line.milestones.find(m => m.key === 'corb_release');
        const corbEndDateVal = corbMs?.actualEndDate || corbMs?.committedBaselineEndDate || targetPO.poDate || todayStr;
        const customDurationsMap: Record<string, number> = {};
        lineChanges.forEach(c => {
          customDurationsMap[c.milestoneKey] = c.newDuration;
        });

        // Calculate baseline schedule starting from BOM Release as per last date (complete) of CORB,
        // and calculated with contractual delivery date (or custom durations without scaling if autoFit is false)
        const { milestones: updatedMsListRaw } = calculateMilestonesFromBOM({
          milestones: line.milestones,
          poDate: targetPO.poDate || todayStr,
          corbEndDate: baselineStartDate || corbEndDateVal,
          deliveryDate: targetPO.committedDeliveryDate,
          materials: line.materials,
          customDurations: Object.keys(customDurationsMap).length > 0 ? customDurationsMap : undefined,
          autoFit
        });

        let updatedMsList = updatedMsListRaw;

        updatedMsList.forEach(newMs => {
          const oldMs = line.milestones.find(m => m.key === newMs.key);
          if (oldMs && (oldMs.committedDurationDays !== newMs.committedDurationDays || oldMs.committedBaselineEndDate !== newMs.committedBaselineEndDate)) {
            revisionChangeDetails.push({
              lineId: line.id,
              milestoneKey: newMs.key,
              oldDuration: oldMs.committedDurationDays,
              newDuration: newMs.committedDurationDays,
              oldBaselineEnd: oldMs.committedBaselineEndDate,
              newBaselineEnd: newMs.committedBaselineEndDate
            });
          }
        });

        // Upon initial PM baseline approval, mark Stage 3 (pm_baseline) as completed and cascade to Stage 4 for ALL product lines
        if (targetPO.status === 'Baseline Pending' || isInitialApproval) {
          const poIdx = updatedMsList.findIndex(m => m.key === 'po_from_customer');
          if (poIdx >= 0) {
            const poDateVal = targetPO.poDate || todayStr;
            updatedMsList[poIdx] = {
              ...updatedMsList[poIdx],
              actualStartDate: poDateVal,
              actualEndDate: poDateVal,
              status: 'Completed' as MilestoneStatus,
              completionPct: 100
            };
          }

          const pmIdx = updatedMsList.findIndex(m => m.key === 'pm_baseline' || m.key === 'baseline_review');
          if (pmIdx >= 0) {
            const pmStart = updatedMsList[pmIdx].actualStartDate || updatedMsList[pmIdx].committedBaselineStartDate || corbEndDateVal;
            const pmEnd = isInitialApproval
              ? (updatedMsList[pmIdx].committedBaselineEndDate || corbEndDateVal)
              : (todayStr > updatedMsList[pmIdx].committedBaselineEndDate ? todayStr : updatedMsList[pmIdx].committedBaselineEndDate);
            updatedMsList[pmIdx] = {
              ...updatedMsList[pmIdx],
              actualStartDate: pmStart,
              actualEndDate: pmEnd,
              forecastStartDate: pmStart,
              forecastEndDate: pmEnd,
              status: 'Completed' as MilestoneStatus,
              completionPct: 100,
              docRef: docRef || 'PM-BL-APPROVED',
              delayReason: reason
            };
            updatedMsList = cascadeNextMilestoneStart(updatedMsList, pmIdx, pmEnd, user);
          }
        }

        const tempLine = { ...line, milestones: updatedMsList };
        const recalced = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
        if (isInitialApproval) {
          return {
            ...recalced,
            overallVarianceDays: 0,
            status: 'In Progress' as MilestoneStatus,
            milestones: recalced.milestones.map(m => ({
              ...m,
              varianceDays: 0,
              delayReason: (m.key === 'pm_baseline' || m.key === 'baseline_review') ? reason : undefined,
              delayCategory: (m.key === 'pm_baseline' || m.key === 'baseline_review') ? 'Baseline Planning' : undefined,
              delayOwner: undefined
            }))
          };
        }
        return recalced;
      });

      const newRev = {
        revNumber: newRevNum,
        requestedBy: user,
        approvedBy: user,
        approvedAt: new Date().toISOString(),
        reason,
        docRef,
        changes: revisionChangeDetails
      };
      const recalculatedDeliveryDate = updatedLines
        .map(line => line.milestones[line.milestones.length - 1]?.committedBaselineEndDate)
        .filter((date): date is string => Boolean(date))
        .sort()
        .slice(-1)[0];

      const maxFinalForecast = updatedLines
        .map(line => line.milestones[line.milestones.length - 1]?.forecastEndDate)
        .filter((date): date is string => Boolean(date))
        .sort()
        .slice(-1)[0];

      const finalBaselineDelivery = recalculatedDeliveryDate || p.committedDeliveryDate;
      const finalRevisedDelivery = (maxFinalForecast && maxFinalForecast > finalBaselineDelivery)
        ? maxFinalForecast
        : finalBaselineDelivery;

      const finalLines = updatedLines.map(line => ({
        ...line,
        milestones: line.milestones.map((m, mIdx) => {
          if (m.key === 'pm_baseline' || m.key === 'baseline_review' || m.stageOrder === 3 || mIdx === 2) {
            return {
              ...m,
              delayReason: reason || m.delayReason,
              delayCategory: m.delayCategory || 'Baseline Revision'
            };
          }
          return m;
        })
      }));

      return {
        ...p,
        status: p.status === 'Baseline Pending' ? 'In Progress' : getPurchaseOrderStatus(finalLines, p.isClosed),
        committedDeliveryDate: finalBaselineDelivery,
        revisedDeliveryDate: finalRevisedDelivery,
        revisions: [...(p.revisions || []), newRev],
        productLines: finalLines,
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updatedPOs);
    persistState('cft_pos', updatedPOs);

    const po = purchaseOrders.find(p => p.id === poId);
    addAudit(
      user,
      activeRole,
      po?.poNumber || '',
      `APPROVE_BASELINE_REV_${(po?.revisions || []).length || 1}`,
      docRef,
      `Approved baseline duration revision. Reason: ${reason}`
    );

    return { success: true };
  };

  const approveRectification = (actionId: string, decision: 'Accepted' | 'Rejected', decisionNotes: string, user: string) => {
    setRectifications(prev => prev.map(a => {
      if (a.id !== actionId) return a;
      return {
        ...a,
        status: decision === 'Accepted' ? 'Accepted' : 'Rejected',
        decisionBy: user,
        decisionAt: new Date().toISOString(),
        decisionNotes
      };
    }));

    const act = rectifications.find(r => r.id === actionId);
    if (act) {
      addAudit(
        user,
        activeRole,
        act.poNumber,
        `RECTIFICATION_${decision.toUpperCase()}`,
        'SYSTEM-RECT-LOG',
        `Rectification action '${act.title}' was ${decision.toLowerCase()} by ${user}. Notes: ${decisionNotes}`
      );
    }
  };

  const createPurchaseOrder = (newPoData: Partial<PurchaseOrder>): { success: boolean; poId?: string; error?: string } => {
    const id = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const poNumber = (newPoData.poNumber || '').trim();
    if (!poNumber) {
      return { success: false, error: 'PO Number is required. Please provide a valid PO Identifier.' };
    }

    // Validate provided PO Number is strictly unique (case-insensitive & whitespace trimmed)
    const isDuplicate = purchaseOrders.some(
      p => p.poNumber.trim().toLowerCase() === poNumber.toLowerCase()
    );
    if (isDuplicate) {
      return {
        success: false,
        error: `Duplicate PO Number: Purchase Order "${poNumber}" already exists in the system. PO Numbers must be strictly unique.`
      };
    }

    const customerName = (newPoData.customerName || '').trim();
    if (!customerName) {
      return { success: false, error: 'Customer Name is required. Please enter the customer or client organization.' };
    }

    if (!newPoData.poDate || !isValidDateString(newPoData.poDate)) {
      return { success: false, error: 'PO Start Date is required and must be a valid date.' };
    }

    if (!newPoData.productLines || newPoData.productLines.length === 0) {
      return { success: false, error: 'At least one product line is required.' };
    }

    for (let idx = 0; idx < newPoData.productLines.length; idx++) {
      const line = newPoData.productLines[idx];
      if (!line.productName || !line.productName.trim()) {
        return { success: false, error: `Product line ${idx + 1} must have a valid product name or description.` };
      }
      if (!line.qty || line.qty < 1 || isNaN(Number(line.qty))) {
        return { success: false, error: `Product line ${idx + 1} quantity must be a positive number (minimum 1).` };
      }
    }

    const todayStr = todayLocal();
    const effectivePoDate = newPoData.poDate;

    // Build initial product lines with raw materials
    const rawLines = (newPoData.productLines || []).map((line, idx) => {
      const lineId = `line-${id}-${idx + 1}`;
      const designType = line.designType || 'Existing Design';
      const tmpl = templates.find(t => t.categoryName === line.category && t.designType === designType)
        || templates.find(t => t.designType === designType)
        || templates[0];

      const catalogItem = products.find(p => p.productName === line.productName);
      const lineMaterials = resolveLineMaterials({
        providedMaterials: line.materials,
        catalogItem,
        qty: line.qty || 1,
        lineId
      });

      return {
        lineId,
        lineNumber: `LINE-${String(idx + 1).padStart(2, '0')}`,
        productName: line.productName || 'Standard Flow Valve Line',
        category: line.category || 'High-Pressure Control Valves',
        qty: line.qty || 1,
        designType,
        materials: lineMaterials,
        template: tmpl
      };
    });

    // Derive unified PO Master Baseline duration envelope across all products
    const maxMatLeadTime = Math.max(
      ...rawLines.flatMap(l => l.materials.map(m => m.leadTimeDays)),
      14
    );

    const masterProductLines = rawLines.map((raw) => {
      const milestones = buildTemplateSchedule({
        template: raw.template,
        designType: raw.designType,
        materials: raw.materials.length > 0 ? raw.materials : [{ leadTimeDays: maxMatLeadTime } as any],
        startDate: effectivePoDate,
        lineId: raw.lineId,
        targetEndDate: newPoData.committedDeliveryDate
      });

      // Milestone 1 (Customer Purchase Order Intake) is completed upon order creation in the PO module
      const initialMilestones = milestones.map((m, mIdx) => {
        if (mIdx === 0 || m.key === 'po_from_customer') {
          return {
            ...m,
            actualStartDate: effectivePoDate,
            actualEndDate: effectivePoDate,
            forecastStartDate: effectivePoDate,
            forecastEndDate: effectivePoDate,
            status: 'Completed' as MilestoneStatus,
            completionPct: 100,
            docRef: newPoData.contractReviewRef || 'PO-AUTO-INTAKE'
          };
        }
        if (m.key === 'corb_release') {
          return {
            ...m,
            committedBaselineStartDate: '',
            committedBaselineEndDate: '',
            committedDurationDays: 0,
            actualStartDate: undefined,
            actualEndDate: undefined,
            forecastStartDate: '',
            forecastEndDate: '',
            status: 'Not Started' as MilestoneStatus,
            completionPct: 0
          };
        }
        return m;
      });

      const cascadedMilestones = cascadeNextMilestoneStart(initialMilestones, 0, effectivePoDate, activeRole);

      const tempLine = {
        id: raw.lineId,
        lineNumber: raw.lineNumber,
        productName: raw.productName,
        category: raw.category,
        qty: raw.qty,
        designType: raw.designType,
        milestones: cascadedMilestones,
        materials: raw.materials,
        overallVarianceDays: 0,
        status: 'In Progress' as MilestoneStatus
      };

      const recalced = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
      return {
        ...recalced,
        overallVarianceDays: 0,
        status: 'In Progress' as MilestoneStatus,
        milestones: recalced.milestones.map((m, mIdx) => ({
          ...m,
          varianceDays: 0,
          delayReason: undefined,
          delayCategory: undefined,
          delayOwner: undefined,
          status: (m.key === 'po_from_customer' || m.stageOrder === 1 || mIdx === 0) ? ('Completed' as MilestoneStatus) : ('Not Started' as MilestoneStatus),
          actualEndDate: (m.key === 'po_from_customer' || m.stageOrder === 1 || mIdx === 0) ? m.actualEndDate : (m.key === 'corb_release' ? undefined : m.actualEndDate)
        }))
      };
    });

    const productLines = masterProductLines;

    // The committed delivery date must cover the SLOWEST line, not just line 1.
    const calculatedDeliveryDate = getOrderDeliveryDate(productLines, effectivePoDate);
    const poDeliveryDate = newPoData.committedDeliveryDate && isValidDateString(newPoData.committedDeliveryDate)
      ? newPoData.committedDeliveryDate
      : calculatedDeliveryDate;

    const newPO: PurchaseOrder = {
      id,
      poNumber,
      customerName,
      customerPoRef: (newPoData.customerPoRef || '').trim() || `PO-REF-${Date.now()}`,
      poDate: effectivePoDate,
      bookedAmount: typeof newPoData.bookedAmount === 'number' ? newPoData.bookedAmount : (newPoData.bookedAmount ? parseFloat(String(newPoData.bookedAmount)) : undefined),
      contractReviewRef: (newPoData.contractReviewRef || '').trim() || `CR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      committedDeliveryDate: poDeliveryDate,
      revisedDeliveryDate: poDeliveryDate,
      status: 'Baseline Pending',
      productLines,
      revisions: [
        {
          revNumber: 0,
          requestedBy: activeRole,
          approvedBy: activeRole,
          approvedAt: new Date().toISOString(),
          reason: 'Initial schedule generated from category template.',
          docRef: newPoData.contractReviewRef || 'CR-2026-0900',
          changes: []
        }
      ],
      attachments: [],
      createdBy: activeRole,
      createdAt: new Date().toISOString(),
      lastUpdatedBy: activeRole,
      lastUpdatedAt: new Date().toISOString(),
      isClosed: false,
      isLd: Boolean(newPoData.isLd)
    };

    const newPOsList = [newPO, ...purchaseOrders];
    setPurchaseOrders(newPOsList);
    persistState('cft_pos', newPOsList);

    addAudit(
      'System',
      activeRole,
      poNumber,
      'CREATE_PO',
      newPO.contractReviewRef,
      `Created Purchase Order with ${productLines.length} product line(s).`
    );

    return { success: true, poId: id };
  };

  const importPurchaseOrders = (
    newPos: PurchaseOrder[],
    replaceExisting: boolean = false
  ): { success: boolean; count: number; error?: string } => {
    if (!newPos || newPos.length === 0) {
      return { success: false, count: 0, error: 'No purchase orders to import.' };
    }

    const existingIndexMap = new Map<string, number>();
    const updatedList = [...purchaseOrders];
    updatedList.forEach((p, idx) => {
      existingIndexMap.set(p.poNumber.trim().toLowerCase(), idx);
    });

    const newEntries: PurchaseOrder[] = [];
    const skipped: string[] = [];
    let importedCount = 0;

    // Two incoming POs with the same number would otherwise overwrite each other (or
    // produce two "-IMP" rows from one spreadsheet). Reject the batch instead.
    const seenIncoming = new Set<string>();
    for (const po of newPos) {
      const key = po.poNumber.trim().toLowerCase();
      if (seenIncoming.has(key)) {
        return {
          success: false,
          count: 0,
          error: `The import contains PO number "${po.poNumber}" more than once. Remove the duplicate rows and try again.`
        };
      }
      seenIncoming.add(key);
    }

    // Every PO number already taken, including ones generated earlier in this batch.
    const takenKeys = new Set(existingIndexMap.keys());
    newPos.forEach(po => takenKeys.add(po.poNumber.trim().toLowerCase()));

    /**
     * Picks the first free "<po>-IMP", "<po>-IMP-2", ... number.
     * The old code always appended "-IMP", so re-importing the same file stacked
     * identical duplicates (-IMP, -IMP, -IMP) instead of distinct orders.
     */
    const nextAvailablePoNumber = (basePoNumber: string): string => {
      // Re-importing an exported "-IMP" number must not produce "PO-X-IMP-IMP".
      const base = basePoNumber.trim().replace(/-(IMP|IMP-\d+)$/i, '');
      let candidate = `${base}-IMP`;
      let counter = 2;
      while (takenKeys.has(candidate.trim().toLowerCase())) {
        candidate = `${base}-IMP-${counter}`;
        counter++;
      }
      takenKeys.add(candidate.trim().toLowerCase());
      return candidate;
    };

    /**
     * Keeps stable IDs from the record being replaced so references held elsewhere
     * (selected order, cancellation requests, subdivisions, rectifications) survive
     * the overwrite. Work already recorded by users is carried across by position/key.
     */
    const mergeOntoExisting = (incoming: PurchaseOrder, existing: PurchaseOrder): PurchaseOrder => {
      const existingLines = existing.productLines || [];
      // Match by line number first so a reordered spreadsheet cannot attach one
      // product's subdivisions to a different product; fall back to position.
      const previousByNumber = new Map(
        existingLines.map(prev => [String(prev.lineNumber || '').toUpperCase(), prev])
      );
      const productLines = (incoming.productLines || []).map((line, lineIdx) => {
        const previousLine = previousByNumber.get(String(line.lineNumber || '').toUpperCase())
          || existingLines[lineIdx];
        if (!previousLine) return line;
        const previousMilestones = new Map((previousLine.milestones || []).map(m => [m.key, m]));
        return {
          ...line,
          id: previousLine.id,
          milestones: (line.milestones || []).map(ms => {
            const previous = previousMilestones.get(ms.key);
            if (!previous) return ms;
            return {
              ...ms,
              id: previous.id,
              subdivisions: previous.subdivisions ?? ms.subdivisions,
              assemblySubTabs: previous.assemblySubTabs ?? ms.assemblySubTabs
            };
          })
        };
      });
      return {
        ...incoming,
        id: existing.id,
        createdAt: existing.createdAt,
        // PO-level governance state belongs to the user, not to the imported sheet.
        // Taking these from `incoming` silently re-opened closed orders and dropped
        // pending cancellations or attachment metadata.
        isClosed: existing.isClosed,
        status: existing.isClosed ? existing.status : incoming.status,
        closureNotes: existing.closureNotes,
        isCancelled: existing.isCancelled,
        cancelledAt: existing.cancelledAt,
        cancelledBy: existing.cancelledBy,
        cancellationReason: existing.cancellationReason,
        cancellationRequest: existing.cancellationRequest,
        attachments: existing.attachments,
        revisions: [...(existing.revisions || []), ...(incoming.revisions || [])],
        productLines
      };
    };

    /**
     * A closed, cancelled, or cancellation-pending order must not be overwritten by a
     * spreadsheet import — that would silently reverse a governance decision.
     */
    const isProtectedRecord = (po: PurchaseOrder): boolean =>
      Boolean(po.isClosed || po.isCancelled || po.cancellationRequest?.status === 'Pending');

    newPos.forEach(incomingPo => {
      const key = incomingPo.poNumber.trim().toLowerCase();
      const existingIdx = existingIndexMap.get(key);

      if (existingIdx !== undefined) {
        if (replaceExisting) {
          const existingPo = updatedList[existingIdx];
          if (isProtectedRecord(existingPo)) {
            skipped.push(existingPo.poNumber);
            return;
          }
          updatedList[existingIdx] = mergeOntoExisting(incomingPo, existingPo);
          importedCount++;
        } else {
          newEntries.push({
            ...incomingPo,
            poNumber: nextAvailablePoNumber(incomingPo.poNumber)
          });
          importedCount++;
        }
      } else {
        newEntries.push(incomingPo);
        importedCount++;
        takenKeys.add(key);
      }
    });

    const finalList = [...newEntries, ...updatedList];
    setPurchaseOrders(finalList);
    persistState('cft_pos', finalList);

    addAudit(
      'System',
      activeRole,
      `BATCH-IMPORT-${importedCount}`,
      'BULK_IMPORT_PO',
      'CSV-EXCEL-IMPORT',
      skipped.length > 0
        ? `Bulk imported ${importedCount} purchase orders; skipped ${skipped.length} protected order(s): ${skipped.join(', ')}.`
        : `Bulk imported ${importedCount} purchase orders into active system pipeline.`
    );

    if (skipped.length > 0) {
      return {
        success: false,
        count: importedCount,
        error: `${skipped.length} order(s) were skipped because they are Closed, Cancelled, or have a pending cancellation request: ${skipped.join(', ')}. Re-open them first if you really need to overwrite.`
      };
    }

    return { success: true, count: importedCount };
  };

  const closePurchaseOrder = (poId: string, closureNotes: string, user: string) => {
    // Strict Role-Based Governance: Only PM Baseline and Project Management (Admin) can close orders
    const isAllowedRole = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';
    if (!isAllowedRole) {
      return {
        success: false,
        error: `Permission Denied: Only Project Manager (PM Baseline) or Project Management (Admin) can formally sign off and close completed purchase orders. Current role: ${activeRole}`
      };
    }

    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) {
      return { success: false, error: 'Purchase Order not found.' };
    }

    const allMilestonesCompleted = po.productLines.every(line =>
      line.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
    );

    if (!allMilestonesCompleted) {
      return {
        success: false,
        error: 'Cannot close purchase order: All milestones across all product lines must be completed first.'
      };
    }

    const updated = purchaseOrders.map(p => {
      if (p.id !== poId) return p;
      return {
        ...p,
        isClosed: true,
        status: 'Closed' as any,
        closureNotes,
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
    addAudit(user, activeRole, po.poNumber, 'CLOSE_PO', 'PO-CLOSE-SIGN', `Closed PO with notes: ${closureNotes}`);
    return { success: true };
  };

  const requestPOCancellation = ({ poId, reason, requestedBy }: { poId: string; reason: string; requestedBy?: string }) => {
    if (!reason?.trim()) {
      return { success: false, error: 'A cancellation reason is mandatory.' };
    }
    const targetPO = purchaseOrders.find(p => p.id === poId);
    if (!targetPO) return { success: false, error: 'Purchase Order not found.' };

    const user = requestedBy || `${activeRole} User`;
    const cancellationRequest: CancellationRequest = {
      id: `CR-${Date.now().toString().slice(-6)}`,
      poId,
      poNumber: targetPO.poNumber,
      customerName: targetPO.customerName,
      requestedBy: user,
      requestedRole: activeRole,
      requestedAt: new Date().toISOString(),
      reason: reason.trim(),
      status: 'Pending'
    };

    const updated = purchaseOrders.map(p => {
      if (p.id !== poId) return p;
      return {
        ...p,
        cancellationRequest,
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
    addAudit(user, activeRole, targetPO.poNumber, 'REQUEST_CANCEL_PO', 'CR-SUBMIT', `Submitted order cancellation request: "${reason.trim()}"`);
    return { success: true };
  };

  const approvePOCancellation = ({ poId, actionType, decisionNotes }: { poId: string; actionType: 'cancel' | 'delete'; decisionNotes?: string }) => {
    const targetPO = purchaseOrders.find(p => p.id === poId);
    if (!targetPO) return { success: false, error: 'Purchase Order not found.' };

    if (actionType === 'delete') {
      const updated = purchaseOrders.filter(p => p.id !== poId);
      rememberDeletedOrder(poId);
      setPurchaseOrders(updated);
      persistState('cft_pos', updated);
      // Without the server DELETE the MySQL row survives and the 2s poll
      // resurrects the order in every tab within seconds.
      deleteOrderOnServer(poId);
      addAudit(activeRole, activeRole, targetPO.poNumber, 'DELETE_PO_APPROVED', 'ADMIN-DELETE', `Approved cancellation and permanently deleted PO ${targetPO.poNumber}. Notes: ${decisionNotes || 'Approved by Admin.'}`);
      return { success: true };
    }

    // actionType === 'cancel'
    const updated = purchaseOrders.map(p => {
      if (p.id !== poId) return p;
      const updatedReq: CancellationRequest = p.cancellationRequest ? {
        ...p.cancellationRequest,
        status: 'Approved',
        decisionBy: activeRole,
        decisionAt: new Date().toISOString(),
        decisionNotes: decisionNotes || undefined,
        actionTaken: 'Cancelled'
      } : {
        id: `CR-${Date.now().toString().slice(-6)}`,
        poId,
        poNumber: p.poNumber,
        customerName: p.customerName,
        requestedBy: `${activeRole} User`,
        requestedRole: activeRole,
        requestedAt: new Date().toISOString(),
        reason: decisionNotes || 'Direct Admin Cancellation',
        status: 'Approved',
        decisionBy: activeRole,
        decisionAt: new Date().toISOString(),
        decisionNotes: decisionNotes || undefined,
        actionTaken: 'Cancelled'
      };

      return {
        ...p,
        isClosed: true,
        isCancelled: true,
        status: 'Cancelled' as any,
        cancelledAt: new Date().toISOString(),
        cancelledBy: activeRole,
        cancellationReason: decisionNotes || p.cancellationRequest?.reason || 'Cancelled by Administrator',
        closureNotes: `Cancelled by Admin: ${decisionNotes || p.cancellationRequest?.reason || 'Cancelled'}`,
        cancellationRequest: updatedReq,
        lastUpdatedBy: activeRole,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
    addAudit(activeRole, activeRole, targetPO.poNumber, 'CANCEL_PO_APPROVED', 'ADMIN-CANCEL', `Approved cancellation for PO ${targetPO.poNumber}. Notes: ${decisionNotes || 'Approved by Admin.'}`);
    return { success: true };
  };

  const rejectPOCancellation = ({ poId, decisionNotes }: { poId: string; decisionNotes: string }) => {
    if (!decisionNotes?.trim()) {
      return { success: false, error: 'Decision notes / explanation are required to reject a cancellation request.' };
    }
    const targetPO = purchaseOrders.find(p => p.id === poId);
    if (!targetPO) return { success: false, error: 'Purchase Order not found.' };

    const updated = purchaseOrders.map(p => {
      if (p.id !== poId) return p;
      const updatedReq: CancellationRequest | undefined = p.cancellationRequest ? {
        ...p.cancellationRequest,
        status: 'Rejected',
        decisionBy: activeRole,
        decisionAt: new Date().toISOString(),
        decisionNotes: decisionNotes.trim()
      } : undefined;

      return {
        ...p,
        cancellationRequest: updatedReq,
        lastUpdatedBy: activeRole,
        lastUpdatedAt: new Date().toISOString()
      };
    });

    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
    addAudit(activeRole, activeRole, targetPO.poNumber, 'CANCEL_PO_REJECTED', 'ADMIN-REJECT', `Rejected cancellation request for PO ${targetPO.poNumber}. Rejection Reason: ${decisionNotes.trim()}`);
    return { success: true };
  };

  const deletePurchaseOrder = (poId: string, reason?: string) => {
    const targetPO = purchaseOrders.find(p => p.id === poId);
    if (!targetPO) return { success: false, error: 'Purchase Order not found.' };

    const updated = purchaseOrders.filter(p => p.id !== poId);
    // Local tombstone first so the 2s poll cannot re-apply this id from a
    // stale snapshot while the DELETE propagates. Do NOT pre-seed the echo
    // guard here: persistState compares its own output against lastPushedRef,
    // so seeding it first would silently skip the shared-state PUT entirely.
    rememberDeletedOrder(poId);
    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
    // Persist the delete server-side (MySQL + authoritative memory). Without
    // this, other tabs and reloads resurrect the row from the DB/file snapshot.
    deleteOrderOnServer(poId);
    addAudit(activeRole, activeRole, targetPO.poNumber, 'DELETE_PO_DIRECT', 'ADMIN-DELETE', `Admin permanently deleted PO ${targetPO.poNumber}. Reason: ${reason || 'Direct deletion.'}`);
    return { success: true };
  };

  const updateTemplates = (newTemplates: CategoryTemplate[]) => {
    setTemplates(newTemplates);
    persistState('cft_templates', newTemplates);
    addAudit(
      'System',
      activeRole,
      'TEMPLATES',
      'UPDATE_TEMPLATES',
      'CONFIG-EDIT',
      `Updated schedule category templates and default stage durations.`
    );
  };

  const updateConfig = (newConfig: SystemConfig) => {
    setConfig(newConfig);
    persistState('cft_config', newConfig);
    addAudit(
      'System',
      activeRole,
      'CONFIG',
      'UPDATE_THRESHOLDS',
      'CONFIG-EDIT',
      `Updated variance thresholds: At-Risk=${newConfig.atRiskThresholdDays}d, Delayed=${newConfig.delayedThresholdDays}d.`
    );
  };

  const resetToDefaultData = () => {
    const confirmed = window.confirm(
      'Are you sure you want to reset all system data back to default factory baseline? All custom orders and modifications will be cleared.'
    );
    if (!confirmed) return;

    setPurchaseOrders(normalizeMilestoneFlows(INITIAL_PURCHASE_ORDERS, todayLocal()));
    setProducts(INITIAL_PRODUCTS);
    setTemplates(INITIAL_TEMPLATES);
    setRectifications(INITIAL_RECTIFICATIONS);
    setAuditLog(INITIAL_AUDIT_LOG);
    setConfig(INITIAL_CONFIG);
    localStorage.removeItem('cft_pos');
    localStorage.removeItem('cft_products');
    localStorage.removeItem('cft_templates');
    localStorage.removeItem('cft_rectifications');
    localStorage.removeItem('cft_audit');
    localStorage.removeItem('cft_config');
  };

  const refreshData = () => {
    try {
      const savedPos = localStorage.getItem('cft_pos');
      if (savedPos) {
        const parsed: PurchaseOrder[] = JSON.parse(savedPos);
        const clean = parsed.filter(po => !isLegacyMockPO(po));
        localStorage.setItem('cft_pos', JSON.stringify(clean));
        setPurchaseOrders(normalizeMilestoneFlows(clean, todayLocal()));
      }

      const savedProducts = localStorage.getItem('cft_products');
      if (savedProducts) setProducts(JSON.parse(savedProducts));

      const savedTemplates = localStorage.getItem('cft_templates');
      if (savedTemplates) setTemplates(JSON.parse(savedTemplates));

      const savedRect = localStorage.getItem('cft_rectifications');
      if (savedRect) setRectifications(JSON.parse(savedRect));

      const savedAudit = localStorage.getItem('cft_audit');
      if (savedAudit) {
        const parsed: AuditLogEntry[] = JSON.parse(savedAudit);
        setAuditLog(parsed.filter(a => !a.id.startsWith('audit-')));
      }

      const savedConfig = localStorage.getItem('cft_config');
      if (savedConfig) setConfig(JSON.parse(savedConfig));
    } catch (err) {
      console.error('Failed to refresh data from local storage:', err);
    }
  };

  const createProduct = (newPrd: Partial<ProductMasterItem>): { success: boolean; id?: string } => {
    const id = `prd-${Date.now()}`;
    const productItem: ProductMasterItem = {
      id,
      productCode: newPrd.productCode || `PRD-${Math.floor(100 + Math.random() * 900)}`,
      productName: newPrd.productName || 'New Manufacturing Product',
      category: newPrd.category || 'High-Pressure Control Valves',
      designType: newPrd.designType || 'Existing Design',
      totalLeadTimeDays: newPrd.totalLeadTimeDays || 45,
      manufacturingLeadTimeDays: newPrd.manufacturingLeadTimeDays,
      description: newPrd.description || '',
      defaultMaterials: newPrd.defaultMaterials || [],
      createdAt: new Date().toISOString()
    };

    const updated = [productItem, ...products];
    setProducts(updated);
    persistState('cft_products', updated);
    addAudit('Operator', activeRole, 'PRODUCT-MASTER', 'CREATE_PRODUCT', productItem.productCode, `Added new product catalog item: ${productItem.productName}`);
    return { success: true, id };
  };

  const updateProduct = (productId: string, updates: Partial<ProductMasterItem>) => {
    const existing = products.find(p => p.id === productId);
    if (!existing) return { success: false, error: 'Product not found in catalog.' };

    const updated = products.map(p => p.id === productId ? { ...p, ...updates } : p);
    setProducts(updated);
    persistState('cft_products', updated);
    addAudit('Operator', activeRole, 'PRODUCT-MASTER', 'UPDATE_PRODUCT', existing.productCode, `Updated product catalog item: ${updates.productName || existing.productName}`);
    return { success: true };
  };

  const deleteProduct = (productId: string) => {
    const existing = products.find(p => p.id === productId);
    if (!existing) return { success: false, error: 'Product not found in catalog.' };

    const updated = products.filter(p => p.id !== productId);
    setProducts(updated);
    persistState('cft_products', updated);
    addAudit('Operator', activeRole, 'PRODUCT-MASTER', 'DELETE_PRODUCT', existing.productCode, `Deleted product catalog item: ${existing.productName} (${existing.productCode})`);
    return { success: true };
  };

  // ---------------------------------------------------------------------------
  // Subdivision CRUD — stored inside milestone.subdivisions[] on each PO
  // TODO: enforce server-side in org-api adapter
  // ---------------------------------------------------------------------------
  const addSubdivision = (params: {
    poId: string; productLineId: string; milestoneId: string;
    milestoneKey: string; title: string; ownerLabel?: string;
    targetStart?: string; targetEnd?: string;
  }): { success: boolean; error?: string } => {
    if (!canRoleManageSubdivision(activeRole, activeRole, params.milestoneKey)) {
      return { success: false, error: 'Unauthorized: You do not have permission to manage subdivisions for this milestone.' };
    }
    const now = new Date().toISOString();
    const newSub: Subdivision = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      milestoneId: params.milestoneId,
      title: params.title,
      ownerSlot: activeRole,
      ownerLabel: params.ownerLabel,
      targetStart: params.targetStart,
      targetEnd: params.targetEnd,
      status: 'Not Started',
      createdAt: now,
      updatedAt: now
    };
    setPurchaseOrders(prev => prev.map(po => {
      if (po.id !== params.poId) return po;
      return withRefreshedStatus(po, po.productLines.map(line => {
        if (line.id !== params.productLineId) return line;
        const today = todayLocal();
        const { atRiskThresholdDays, delayedThresholdDays } = config;
        return recalculateProductLine({
          ...line,
          milestones: line.milestones.map(ms =>
            ms.id !== params.milestoneId ? ms : {
              ...ms,
              subdivisions: [...(ms.subdivisions || []), newSub]
            }
          )
        }, today, atRiskThresholdDays, delayedThresholdDays);
      }));
    }));
    return { success: true };
  };

  const updateSubdivision = (params: {
    poId: string; productLineId: string; milestoneId: string;
    subdivisionId: string; updates: Partial<Omit<Subdivision, 'id' | 'milestoneId' | 'createdAt'>>;
  }): { success: boolean; error?: string } => {
    const targetMs = purchaseOrders.find(p => p.id === params.poId)?.productLines.find(l => l.id === params.productLineId)?.milestones.find(m => m.id === params.milestoneId);
    if (targetMs && !canRoleManageSubdivision(activeRole, activeRole, targetMs.key)) {
      // NOTE: strictly, we should fetch the existing subdivision to check ownerRole, but since subdivisions are mostly scoped by milestone, this is adequate
      return { success: false, error: 'Unauthorized: You do not have permission to manage subdivisions for this milestone.' };
    }
    const now = new Date().toISOString();
    setPurchaseOrders(prev => prev.map(po => {
      if (po.id !== params.poId) return po;
      return withRefreshedStatus(po, po.productLines.map(line => {
        if (line.id !== params.productLineId) return line;
        const today = todayLocal();
        const { atRiskThresholdDays, delayedThresholdDays } = config;
        const updatedLine = {
          ...line,
          milestones: line.milestones.map(ms => {
            if (ms.id !== params.milestoneId) return ms;
            const updatedSubs = (ms.subdivisions || []).map(s =>
              s.id !== params.subdivisionId ? s : { ...s, ...params.updates, updatedAt: now }
            );
            return { ...ms, subdivisions: updatedSubs };
          })
        };
        return recalculateProductLine(updatedLine, today, atRiskThresholdDays, delayedThresholdDays);
      }));
    }));
    return { success: true };
  };

  const deleteSubdivision = (params: {
    poId: string; productLineId: string; milestoneId: string; subdivisionId: string;
  }): { success: boolean; error?: string } => {
    const targetMs = purchaseOrders.find(p => p.id === params.poId)?.productLines.find(l => l.id === params.productLineId)?.milestones.find(m => m.id === params.milestoneId);
    if (targetMs && !canRoleManageSubdivision(activeRole, activeRole, targetMs.key)) {
      return { success: false, error: 'Unauthorized: You do not have permission to manage subdivisions for this milestone.' };
    }
    setPurchaseOrders(prev => prev.map(po => {
      if (po.id !== params.poId) return po;
      return withRefreshedStatus(po, po.productLines.map(line => {
        if (line.id !== params.productLineId) return line;
        const today = todayLocal();
        const { atRiskThresholdDays, delayedThresholdDays } = config;
        return recalculateProductLine({
          ...line,
          milestones: line.milestones.map(ms => {
            if (ms.id !== params.milestoneId) return ms;
            return {
              ...ms,
              subdivisions: (ms.subdivisions || []).filter(s => s.id !== params.subdivisionId)
            };
          })
        }, today, atRiskThresholdDays, delayedThresholdDays);
      }));
    }));
    return { success: true };
  };

  const pendingCancellationCount = purchaseOrders.filter(p => p.cancellationRequest?.status === 'Pending').length;

  const canDo = (_action: keyof typeof ROLE_PERMISSIONS[Role]): boolean => true;

  return (
    <AppContext.Provider value={{
      activeRole,
      setActiveRole,
      purchaseOrders,
      products,
      templates,
      rectifications,
      auditLog,
      config,
      isOffline,
      setIsOffline,
      createProduct,
      updateProduct,
      deleteProduct,
      acceptMilestone,
      updateMilestoneEvent,
      batchUpdateMilestoneEvents,
      updateOrderStatus,
      updateMaterialItem,
      addBaselineRevision,
      approveRectification,
      createPurchaseOrder,
      importPurchaseOrders,
      closePurchaseOrder,
      requestPOCancellation,
      approvePOCancellation,
      rejectPOCancellation,
      deletePurchaseOrder,
      pendingCancellationCount,
      updateTemplates,
      updateConfig,
      resetToDefaultData,
      refreshData,
      showBlueprintModal,
      setShowBlueprintModal,
      addSubdivision,
      updateSubdivision,
      deleteSubdivision,
      canDo,
      backendStatus
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
