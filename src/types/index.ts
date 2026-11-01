export type Role = 
  | 'Project Management'
  | 'Sales / AE (Customer PO)'
  | 'Project Manager (PM Baseline)'
  | 'AE (CORB Release)'
  | 'DE (BOM Release)'
  | 'Planner (WO Release)'
  | 'SCM (Sub-Supplier PO)'
  | 'Stores (Material Receipt)'
  | 'SCM / Planner (Machining)'
  | 'Planner (Assembly)'
  | 'QC (FG)'
  | 'QC (Customer Inspection)'
  | 'QC (Painting)'
  | 'QC (TRN)'
  | 'Stores (Shipment)';

export type SubdivisionStatus = 'Not Started' | 'In Progress' | 'Done' | 'Delayed';

export interface Subdivision {
  id: string;
  milestoneId: string;
  title: string;
  ownerSlot: Role;
  ownerUserId?: string;
  ownerLabel?: string;
  status: SubdivisionStatus;
  actualStart?: string;
  actualEnd?: string;
  targetStart?: string;
  targetEnd?: string;
  delayCause?: DelayCategory;
  delayNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type DesignType = 'Existing Design' | 'New Design';

export type POStatus = 
  | 'Draft' 
  | 'Baseline Pending' 
  | 'In Progress' 
  | 'At Risk' 
  | 'Delayed' 
  | 'Completed' 
  | 'Closed'
  | 'Cancelled';

export type MilestoneStatus = 
  | 'Not Started' 
  | 'In Progress' 
  | 'On Track' 
  | 'At Risk' 
  | 'Delayed' 
  | 'Completed';

export type DelayCategory = 
  | 'Customer' 
  | 'Supplier' 
  | 'Design' 
  | 'Production' 
  | 'Internal';

export type RectificationActionType = 
  | 'Expedite' 
  | 'Alternate Supplier' 
  | 'Split Shipment' 
  | 'Parallel Review' 
  | 'Added Shift' 
  | 'Re-sequence' 
  | 'Formal Baseline Change Note';

export type InspectionResult = 'Passed' | 'Rejected' | 'Pending';

export interface MaterialItem {
  id: string;
  itemCode: string;
  description: string;
  qty: number;
  unit: string;
  supplierName: string;
  leadTimeDays: number;
  isCriticalPath: boolean;
  orderedDate?: string;
  expectedDate?: string;
  dispatchedDate?: string;
  receivedDate?: string;
  grnNumber?: string;
  inspectionResult?: InspectionResult;
  inspectionNotes?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface Milestone {
  id: string;
  // 14 exact milestone keys:
  // 1: po_from_customer, 2: baseline_review (or pm_baseline), 3: corb_release, 4: bom_release,
  // 5: wo_release, 6: sub_supplier_po, 7: material_receipt, 8: machining,
  // 9: assembly, 10: fg, 11: customer_inspection, 12: painting, 13: trn, 14: shipment
  key: string;
  name: string;
  stageOrder: number;
  defaultDurationDays: number;
  committedBaselineStartDate: string;
  committedBaselineEndDate: string;
  currentBaselineEndDate?: string;
  committedDurationDays: number;
  actualStartDate?: string;
  actualEndDate?: string;
  forecastStartDate: string;
  forecastEndDate: string;
  varianceDays: number; // (Actual or Forecast End) - Committed Baseline End
  status: MilestoneStatus;
  completionPct: number;
  approvalReference?: string;
  drawingNumber?: string;
  ecnNumber?: string; // Engineering Change Note
  delayCategory?: DelayCategory;
  delayOwner?: string;
  delayReason?: string;
  lastUpdatedBy?: string;
  lastUpdatedAt?: string;
  docRef?: string;
  backdateReason?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  subdivisions?: Subdivision[];
  assemblySubTabs?: {
    id: string;
    name: string;
    status: SubdivisionStatus;
    startDate?: string;
    endDate?: string;
    notes?: string;
  }[];
}

export interface RolePermissions {
  canCreatePO: boolean;
  canCreateProductLines: boolean;
  canGenerateBaseline: boolean;
  canApproveBaseline: boolean;
  canManageTemplates: boolean;
  canManageRoles: boolean;
  canViewAuditLog: boolean;
  canExport: boolean;
  canEditPOHeader: boolean;
  canEditProcurement: boolean;
  canEditProduction: boolean;
  canEditDispatch: boolean;
  canCloseOrder: boolean;
  allowedMilestones: 'ALL' | string[];
}

const defaultSlotPerms: RolePermissions = {
  canCreatePO: false,
  canCreateProductLines: false,
  canGenerateBaseline: false,
  canApproveBaseline: false,
  canManageTemplates: false,
  canManageRoles: false,
  canViewAuditLog: false,
  canExport: true,
  canEditPOHeader: false,
  canEditProcurement: false,
  canEditProduction: false,
  canEditDispatch: false,
  canCloseOrder: false,
  allowedMilestones: []
};

export const ROLE_PERMISSIONS: Record<Role, RolePermissions> = {
  // 1. Project Management — full administrative and baseline governance control
  'Project Management': {
    canCreatePO: true,
    canCreateProductLines: true,
    canGenerateBaseline: true,
    canApproveBaseline: true,
    canManageTemplates: true,
    canManageRoles: true,
    canViewAuditLog: true,
    canExport: true,
    canEditPOHeader: true,
    canEditProcurement: true,
    canEditProduction: true,
    canEditDispatch: true,
    canCloseOrder: true,
    allowedMilestones: 'ALL'
  },

  // 14 Dedicated Milestone Slots with Isolated Permissions
  'Sales / AE (Customer PO)': { ...defaultSlotPerms, canCreatePO: true, canCreateProductLines: true, canEditPOHeader: true, allowedMilestones: ['po_from_customer'] },
  'Project Manager (PM Baseline)': { ...defaultSlotPerms, canGenerateBaseline: true, canApproveBaseline: true, canEditPOHeader: true, canCloseOrder: true, allowedMilestones: ['pm_baseline', 'baseline_review'] },
  'AE (CORB Release)': { ...defaultSlotPerms, allowedMilestones: ['corb_release'] },
  'DE (BOM Release)': { ...defaultSlotPerms, allowedMilestones: ['bom_release'] },
  'Planner (WO Release)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['wo_release'] },
  'SCM (Sub-Supplier PO)': { ...defaultSlotPerms, canEditProcurement: true, allowedMilestones: ['sub_supplier_po'] },
  'Stores (Material Receipt)': { ...defaultSlotPerms, canEditProcurement: true, allowedMilestones: ['material_receipt'] },
  'SCM / Planner (Machining)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['machining'] },
  'Planner (Assembly)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['assembly'] },
  'QC (FG)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['fg'] },
  'QC (Customer Inspection)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['customer_inspection'] },
  'QC (Painting)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['painting'] },
  'QC (TRN)': { ...defaultSlotPerms, canEditProduction: true, allowedMilestones: ['trn'] },
  'Stores (Shipment)': { ...defaultSlotPerms, canEditDispatch: true, allowedMilestones: ['shipment', 'dispatch', 'delivery'] }
};

export function isMilestoneOwnedByRole(milestoneKey: string, role: Role): boolean {
  // Project Management has administrative access across all stages
  if (role === 'Project Management') return true;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms.allowedMilestones === 'ALL') return true;
  return perms.allowedMilestones.includes(milestoneKey);
}

export function canRoleManageSubdivision(role: Role, _subdivisionOwnerRole: Role, milestoneKey: string): boolean {
  return isMilestoneOwnedByRole(milestoneKey, role);
}

export interface ProductLine {
  id: string;
  lineNumber: string; // e.g. "LINE-01"
  productName: string; // e.g. "CFT-HV-400 High Pressure Gate Valve 4\" 1500#"
  category: string; // e.g. "High Pressure Valves"
  qty: number;
  designType: DesignType;
  milestones: Milestone[];
  materials: MaterialItem[];
  overallVarianceDays: number;
  status: MilestoneStatus;
  delayReason?: string;
}

export interface BaselineRevision {
  revNumber: number; // e.g., 0, 1, 2
  requestedBy: string;
  approvedBy: string;
  approvedAt: string;
  reason: string;
  docRef: string;
  changes: {
    lineId: string;
    milestoneKey: string;
    oldDuration: number;
    newDuration: number;
    oldBaselineEnd: string;
    newBaselineEnd: string;
  }[];
}

export interface POAttachment {
  id: string;
  name: string;
  type: string; // e.g. "Customer PO", "QAP", "GRN", "MTC"
  size: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CancellationRequest {
  id: string;
  poId: string;
  poNumber: string;
  customerName: string;
  requestedBy: string;
  requestedRole: Role;
  requestedAt: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  decisionBy?: string;
  decisionAt?: string;
  decisionNotes?: string;
  actionTaken?: 'Deleted' | 'Cancelled';
}

export interface PurchaseOrder {
  id: string;
  poNumber: string; // e.g. "CFT-PO-2026-0891"
  customerName: string;
  customerPoRef: string;
  poDate: string;
  startDate?: string;
  bookedAmount?: number;
  contractReviewRef: string;
  committedDeliveryDate: string;
  revisedDeliveryDate: string;
  actualDeliveryDate?: string;
  status: POStatus;
  productLines: ProductLine[];
  revisions: BaselineRevision[];
  attachments: POAttachment[];
  createdBy: string;
  createdAt: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  isClosed: boolean;
  closureNotes?: string;
  cancellationRequest?: CancellationRequest;
  isCancelled?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
}

export interface RectificationAction {
  id: string;
  poNumber: string;
  productLineId: string;
  productLineName: string;
  milestoneKey: string;
  milestoneName: string;
  type: RectificationActionType;
  title: string;
  description: string;
  impactDaysSaved: number;
  suggestedBy: string;
  suggestedAt: string;
  assignedTo: string;
  status: 'Proposed' | 'Accepted' | 'Rejected' | 'Implemented';
  decisionBy?: string;
  decisionAt?: string;
  decisionNotes?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  role: Role;
  poNumber: string;
  productLine?: string;
  action: string;
  docRef: string;
  details: string;
  backdateReason?: string;
}

export interface CategoryTemplate {
  id: string;
  categoryName: string;
  designType: DesignType;
  milestoneDurations: {
    milestoneKey: string;
    milestoneName: string;
    durationDays: number;
  }[];
}

export interface ProductMasterItem {
  id: string;
  productCode: string;
  productName: string;
  category: string;
  designType: DesignType;
  totalLeadTimeDays: number;
  description?: string;
  defaultMaterials?: {
    itemCode: string;
    description: string;
    supplierName: string;
    leadTimeDays: number;
    isCriticalPath: boolean;
  }[];
  createdAt: string;
}

export interface SystemConfig {
  atRiskThresholdDays: number; // e.g. 3 days
  delayedThresholdDays: number; // e.g. 7 days
  offlineSyncQueue: any[];
  enablePushNotifications: boolean;
  enableEmailAlerts?: boolean;
}


