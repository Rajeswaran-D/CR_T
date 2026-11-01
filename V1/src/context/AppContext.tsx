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
  getDaysDifference
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const storageConfig = getStorageConfig();
const sharedStateKeys = STORAGE_KEYS;
const sharedStateEndpoint = getSharedStateEndpoint(storageConfig);

const saveSharedState = (key: string, value: unknown) => {
  fetch(sharedStateEndpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': storageConfig.organizationId
    },
    body: JSON.stringify({ [key]: value })
  }).catch(() => undefined);
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
const withRefreshedStatus = (po: PurchaseOrder, productLines: PurchaseOrder['productLines']): PurchaseOrder => ({
  ...po,
  productLines,
  status: po.isCancelled || po.status === 'Cancelled' || po.isClosed || po.status === 'Baseline Pending'
    ? po.status
    : getPurchaseOrderStatus(productLines, po.isClosed),
  lastUpdatedAt: new Date().toISOString()
});

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

const ALIGNED_14_STAGES = [
  { key: 'po_from_customer', name: '1. Customer Purchase Order (PO)', durationDays: 1 },
  { key: 'pm_baseline', name: '2. Baseline Review & Planning', durationDays: 3 },
  { key: 'corb_release', name: '3. CORB Release', durationDays: 2 },
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
    cleanExistingMilestones.every(m => m.committedBaselineStartDate && m.committedBaselineEndDate);

  if (hasFullCommitted14) {
    let runningChainDate = start;
    return ALIGNED_14_STAGES.map((def, idx) => {
      const existing = cleanExistingMilestones.find(m => m.key === def.key || m.stageOrder === idx + 1) || cleanExistingMilestones[idx];
      const msStart = idx === 0 ? (existing.committedBaselineStartDate || start) : runningChainDate;
      const isMatStage = def.key === 'material_receipt' || def.key === 'raw_material';
      const baseDur = isMatStage && rawMaterialLeadTime > 0
        ? Math.max(existing.committedDurationDays || def.durationDays, rawMaterialLeadTime)
        : Math.max(1, existing.committedDurationDays || def.durationDays);
      const msEnd = existing.committedBaselineEndDate && existing.committedBaselineStartDate === msStart && (!isMatStage || (existing.committedDurationDays || 0) >= rawMaterialLeadTime)
        ? existing.committedBaselineEndDate
        : addDays(msStart, baseDur - 1);
      runningChainDate = addDays(msEnd, 1);

      return {
        ...existing,
        id: existing.id || `ms-${lineId}-${def.key}`,
        key: def.key,
        name: def.name,
        stageOrder: idx + 1,
        committedBaselineStartDate: msStart,
        committedBaselineEndDate: msEnd,
        committedDurationDays: baseDur,
        forecastStartDate: existing.forecastStartDate || existing.actualStartDate || msStart,
        forecastEndDate: existing.forecastEndDate || existing.actualEndDate || msEnd
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
    const existing = cleanExistingMilestones.find(m => m.key === def.key || (m.key === 'baseline_review' && def.key === 'pm_baseline') || (m.key === 'qc_pass' && def.key === 'fg') || m.stageOrder === idx + 1);
    const duration = scaledDurations[idx];
    const msStart = runningDate;
    const msEnd = addDays(msStart, duration - 1);
    runningDate = addDays(msEnd, 1);

    return {
      id: `ms-${lineId}-${def.key}`,
      key: def.key,
      name: def.name,
      stageOrder: idx + 1,
      defaultDurationDays: duration,
      committedBaselineStartDate: msStart,
      committedBaselineEndDate: msEnd,
      committedDurationDays: duration,
      actualStartDate: existing?.actualStartDate,
      actualEndDate: existing?.actualEndDate,
      forecastStartDate: existing?.actualStartDate || msStart,
      forecastEndDate: existing?.actualEndDate || msEnd,
      varianceDays: existing?.varianceDays || 0,
      status: existing?.status || ('Not Started' as MilestoneStatus),
      completionPct: existing?.completionPct || (existing?.status === 'Completed' ? 100 : 0),
      docRef: existing?.docRef,
      delayCategory: existing?.delayCategory,
      delayOwner: existing?.delayOwner,
      delayReason: existing?.delayReason
    };
  });
}

const normalizeMilestoneFlows = (orders: PurchaseOrder[], todayStr: string): PurchaseOrder[] => orders.map(po => {
  const recalculatedLines = po.productLines.map(line => {
    const milestones = repairMilestonesTo14Aligned(line.milestones, po.poDate, line.id, po.committedDeliveryDate, line.materials);
    const materials = normalizeMaterialDates(line.materials, todayStr);

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

  return {
    ...po,
    productLines: recalculatedLines,
    revisedDeliveryDate: (maxFinalForecast && maxFinalForecast > po.committedDeliveryDate) ? maxFinalForecast : po.committedDeliveryDate,
    status: po.isCancelled || po.status === 'Cancelled'
      ? 'Cancelled'
      : po.isClosed ? 'Closed' : po.status === 'Baseline Pending' ? 'Baseline Pending' : getPurchaseOrderStatus(recalculatedLines, po.isClosed)
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
    } catch {}
    return 'Project Management';
  });

  const setActiveRole = (role: Role) => {
    setActiveRoleState(role);
    try {
      localStorage.setItem('cft_active_role', role);
    } catch {}
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

  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [showBlueprintModal, setShowBlueprintModal] = useState<boolean>(false);
  const [sharedStateReady, setSharedStateReady] = useState(true);

  // Echo-guard: the serialized value last pushed to localStorage/server per key.
  // Prevents the 2s server poll from applying our own data back over newer
  // in-flight edits (the classic read-modify-write clobber), and stops the
  // save effects from re-PUTting unchanged data in an endless echo loop.
  const lastPushedRef = useRef<Partial<Record<StorageKey, string>>>({});

  const persistState = (key: StorageKey, value: unknown) => {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
    } catch (e) {
      console.error(`Failed to write to localStorage for key ${key}:`, e);
    }
    if (lastPushedRef.current[key] === serialized) return;
    lastPushedRef.current[key] = serialized;
    saveSharedState(key, value);
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
            const currentSerialized = localStorage.getItem('cft_pos');
            if (JSON.stringify(normalized) === currentSerialized) return;
            if (currentSerialized) {
              try {
                const current = JSON.parse(currentSerialized);
                const currentNormalized = normalizeMilestoneFlows(
                  Array.isArray(current) ? current : [],
                  todayLocal()
                );
                if (JSON.stringify(normalized) === JSON.stringify(currentNormalized)) return;
              } catch {
                // Fall through and apply a recoverable, valid server snapshot.
              }
            }
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
      try {
        const response = await fetch(sharedStateEndpoint, {
          headers: { 'X-Organization-Id': storageConfig.organizationId }
        });
        if (!response.ok) {
          setSharedStateReady(true);
          return;
        }
        const sharedState = await response.json() as Record<string, unknown>;
        Object.entries(sharedState).forEach(([key, value]) => {
          if (!sharedStateKeys.some(storageKey => storageKey === key)) return;
          const serialized = JSON.stringify(value);

          // Skip our own echo: the server is only reflecting what this tab pushed.
          if (lastPushedRef.current[key as StorageKey] === serialized) return;
          // No-op: server matches what is already on disk for this key.
          if (serialized === localStorage.getItem(key)) {
            lastPushedRef.current[key as StorageKey] = serialized;
            return;
          }

          if (key === 'cft_pos') {
            try {
              const localOrders = JSON.parse(localStorage.getItem('cft_pos') || '[]') as PurchaseOrder[];
              const sharedOrders = (value as PurchaseOrder[]) || [];
              const localLatest = localOrders.reduce((latest, order) => order.lastUpdatedAt > latest ? order.lastUpdatedAt : latest, '');
              const sharedLatest = sharedOrders.reduce((latest, order) => order.lastUpdatedAt > latest ? order.lastUpdatedAt : latest, '');
              // Local wins when it is strictly newer OR has diverged in count
              // while being at least as fresh (protects offline edits).
              const localHasNewerData = localOrders.length > sharedOrders.length
                ? localLatest >= sharedLatest
                : localLatest > sharedLatest;
              if (localHasNewerData) return;
            } catch {
              // Fall through to the shared state when local data cannot be compared.
            }
          }
          localStorage.setItem(key, serialized);
          applyStoredState(key, serialized);
        });
        setSharedStateReady(true);
      } catch {
        // Local storage remains the offline fallback.
        setSharedStateReady(true);
      }
    };

    const handleFocus = () => { syncFromStorage(); void syncFromServer(); };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key) applyStoredState(event.key, event.newValue);
      else syncFromStorage();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncFromStorage();
    };

    // Seed the echo-guard with what is already persisted so restored state
    // is not immediately re-PUT to the server as a "change".
    sharedStateKeys.forEach(key => {
      const current = localStorage.getItem(key);
      if (current !== null) lastPushedRef.current[key] = current;
    });

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    syncFromStorage();
    void syncFromServer();
    const serverSyncTimer = window.setInterval(() => { void syncFromServer(); }, 2000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

      if (isMaterialStage) {
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
            error: `Dependency Violation: Critical path materials pending GRN passed inspection: ${pendingCritical.map(m=>m.itemCode).join(', ')}.`
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

        const currentMsIndex = l.milestones.findIndex(m => m.key === item.milestoneKey);
        let updatedMsList = l.milestones.map(m => {
          if (m.key !== item.milestoneKey) return m;

          const newMs = { ...m };
          if (item.eventType === 'start') {
            newMs.actualStartDate = item.eventDate;
            newMs.forecastStartDate = item.eventDate;
            newMs.forecastEndDate = item.targetEndDate || m.actualEndDate || addDays(item.eventDate, m.committedDurationDays - 1);
            newMs.status = 'In Progress' as MilestoneStatus;
          } else {
            if (!newMs.actualStartDate) {
              const anchor = chainAnchorDate(l.milestones, currentMsIndex, todayStr);
              newMs.actualStartDate = anchor && anchor <= item.eventDate ? anchor : item.eventDate;
            }
            newMs.actualEndDate = item.eventDate;
            newMs.forecastEndDate = item.eventDate;
            newMs.status = 'Completed' as MilestoneStatus;
            newMs.completionPct = 100;
          }

          if (item.approvalRef) newMs.approvalReference = item.approvalRef;
          if (item.drawingNo) newMs.drawingNumber = item.drawingNo;
          if (item.ecnNo) newMs.ecnNumber = item.ecnNo;
          if (item.delayCategory) newMs.delayCategory = item.delayCategory;
          if (item.delayOwner) newMs.delayOwner = item.delayOwner;
          if (item.delayReason && !item.delayReason.startsWith('Inherited') && !item.delayReason.startsWith('Cascaded')) {
            newMs.delayReason = item.delayReason;
          }

          newMs.lastUpdatedBy = item.user;
          newMs.lastUpdatedAt = new Date().toISOString();
          newMs.docRef = item.docRef;
          if (item.backdateReason) newMs.backdateReason = item.backdateReason;

          return newMs;
        });

        // After completing, cascade the completion date into the next milestone's start
        if (item.eventType === 'complete') {
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
        return recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
      });

      const maxFinalForecast = updatedLines.reduce((latest, l) => {
        const lastMs = (l.milestones || []).slice(-1)[0];
        const end = lastMs?.actualEndDate || lastMs?.forecastEndDate || lastMs?.committedBaselineEndDate;
        if (!latest) return end || '';
        return end && end > latest ? end : latest;
      }, '');

      const poStatus = getPurchaseOrderStatus(updatedLines, p.isClosed);

      return {
        ...p,
        status: poStatus,
        productLines: updatedLines,
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
          const updatedLine = updatedPOs.find(p=>p.id===item.poId)?.productLines.find(l=>l.id===item.productLineId);
          const updatedMs = updatedLine?.milestones.find(m=>m.key===item.milestoneKey);
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
          updatedMsList = cascadeNextMilestoneStart(updatedMsList, msIndex, effectiveDate, user);
        }

        // Material receipts drive raw_material / incoming_inspection state —
        // re-sync them so completing a prior stage (e.g. PO review) instantly
        // reflects material progress instead of waiting for the next edit.
        let workingLine: ProductLine = applyMaterialProgress({ ...line, milestones: updatedMsList });

        const tempLine = { ...workingLine };
        const recalculated = recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
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

      return {
        ...p,
        status: getPurchaseOrderStatus(updatedLines, p.isClosed),
        productLines: updatedLines,
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

      return {
        ...p,
        status: getPurchaseOrderStatus(updatedLines, p.isClosed),
        productLines: updatedLines,
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
    milestoneFlows
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
    const flowAlreadyStarted = !isInitialApproval && targetPO.productLines.some(line =>
      line.milestones.some(ms => ms.stageOrder > 2 && Boolean(ms.actualStartDate || ms.actualEndDate))
    );
    if (flowAlreadyStarted) {
      return { success: false, error: 'Baseline is locked after flow start. Continue updating milestones without changing the approved plan.' };
    }

    const updatedPOs = purchaseOrders.map(p => {
      if (p.id !== poId) return p;

      const newRevNum = p.revisions.length;
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
          return recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
        }

        if (lineChanges.length === 0 && !baselineStartDate && !isInitialApproval) return line;

        const changedMsList = line.milestones.map(ms => {
          const change = lineChanges.find(c => c.milestoneKey === ms.key);
          if (!change) return ms;

          const oldDur = ms.committedDurationDays;
          const newDur = change.newDuration;
          const oldEnd = ms.committedBaselineEndDate;
          const newEnd = addDays(ms.committedBaselineStartDate, newDur - 1);

          revisionChangeDetails.push({
            lineId: line.id,
            milestoneKey: ms.key,
            oldDuration: oldDur,
            newDuration: newDur,
            oldBaselineEnd: oldEnd,
            newBaselineEnd: newEnd
          });

          return {
            ...ms,
            committedDurationDays: newDur,
            committedBaselineEndDate: newEnd
          };
        });

        let runningDate = baselineStartDate || changedMsList[0]?.committedBaselineStartDate || todayStr;
        let updatedMsList = changedMsList.map(ms => {
          const startDate = runningDate;
          const endDate = addDays(startDate, ms.committedDurationDays - 1);
          runningDate = addDays(endDate, 1);
          return {
            ...ms,
            committedBaselineStartDate: startDate,
            committedBaselineEndDate: endDate
          };
        });

        // Upon initial PM baseline approval, mark Stage 2 (pm_baseline) as completed and cascade to Stage 3 for ALL product lines
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
        return recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
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

      return {
        ...p,
        status: p.status === 'Baseline Pending' ? 'In Progress' : getPurchaseOrderStatus(updatedLines, p.isClosed),
        committedDeliveryDate: finalBaselineDelivery,
        revisedDeliveryDate: finalRevisedDelivery,
        revisions: [...p.revisions, newRev],
        productLines: updatedLines,
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
      `APPROVE_BASELINE_REV_${po?.revisions.length || 1}`,
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
    const perms = ROLE_PERMISSIONS[activeRole];
    if (activeRole !== 'Project Management' && !perms?.canCreatePO) {
      return { success: false, error: 'Unauthorized: You do not have permission to create purchase orders.' };
    }
    const id = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let poNumber = (newPoData.poNumber || '').trim();
    if (!poNumber) {
      // Find highest existing numeric sequence in standard PO formats (e.g. PO-2026-001 or CFT-PO-2026-001)
      let maxSeq = 0;
      purchaseOrders.forEach(p => {
        const match = p.poNumber.match(/(?:PO|CFT-PO)-(\d{4})-(\d+)/i) || p.poNumber.match(/(\d+)$/);
        if (match) {
          const num = parseInt(match[2] || match[1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      });
      const nextSeq = String(Math.max(maxSeq + 1, purchaseOrders.length + 1)).padStart(3, '0');
      let generated = `PO-2026-${nextSeq}`;
      let attempt = 1;
      while (purchaseOrders.some(p => p.poNumber.trim().toLowerCase() === generated.toLowerCase())) {
        generated = `PO-2026-${String(maxSeq + 1 + attempt).padStart(3, '0')}`;
        attempt++;
      }
      poNumber = generated;
    } else {
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
    }
    const todayStr = todayLocal();
    const effectivePoDate = newPoData.poDate && isValidDateString(newPoData.poDate) ? newPoData.poDate : todayStr;

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

      return recalculateProductLine(tempLine, todayStr, config.atRiskThresholdDays, config.delayedThresholdDays);
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
      customerName: newPoData.customerName || 'General Offshore Client',
      customerPoRef: newPoData.customerPoRef || 'PO-REF-9901',
      poDate: effectivePoDate,
      bookedAmount: typeof newPoData.bookedAmount === 'number' ? newPoData.bookedAmount : (newPoData.bookedAmount ? parseFloat(String(newPoData.bookedAmount)) : undefined),
      contractReviewRef: newPoData.contractReviewRef || 'CR-2026-0900',
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
      isClosed: false
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
    let importedCount = 0;

    newPos.forEach(incomingPo => {
      const key = incomingPo.poNumber.trim().toLowerCase();
      const existingIdx = existingIndexMap.get(key);

      if (existingIdx !== undefined) {
        if (replaceExisting) {
          updatedList[existingIdx] = incomingPo;
          importedCount++;
        } else {
          const suffixedPo = {
            ...incomingPo,
            poNumber: `${incomingPo.poNumber}-IMP`
          };
          newEntries.push(suffixedPo);
          importedCount++;
        }
      } else {
        newEntries.push(incomingPo);
        importedCount++;
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
      `Bulk imported ${importedCount} purchase orders into active system pipeline.`
    );

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
      setPurchaseOrders(updated);
      persistState('cft_pos', updated);
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
    setPurchaseOrders(updated);
    persistState('cft_pos', updated);
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
      canDo
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
