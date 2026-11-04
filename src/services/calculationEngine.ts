import type {
  Milestone,
  ProductLine,
  MaterialItem,
  MilestoneStatus,
  DelayCategory,
  RectificationAction,
  CategoryTemplate,
  ProductMasterItem,
  DesignType
} from '../types';

// ---------------------------------------------------------------------------
// Date primitives — the single source of truth for every date in the system.
// All dates are handled as strict YYYY-MM-DD calendar strings so that string
// comparison, sorting and arithmetic all agree with the visible calendar day.
// ---------------------------------------------------------------------------

export function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function formatDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns the LOCAL calendar date (YYYY-MM-DD).
 * Using UTC-based "today" (toISOString) shifts the app's calendar day for
 * any timezone ahead of/behind UTC, so every "today" in the app must use this.
 */
export function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Validates a strict YYYY-MM-DD calendar date string.
 * The round-trip check rejects impossible days (2026-02-31) that `Date` would
 * otherwise silently roll over into a *different* day.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = parseDate(dateStr);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatDate(parsed) === dateStr;
}

/** Clamps a date string so it never exceeds maxStr (safe for ISO YYYY-MM-DD). */
export function clampDateMax(dateStr: string, maxStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr > maxStr ? maxStr : dateStr;
}

/** Clamps a date string so it never falls below minStr (safe for ISO YYYY-MM-DD). */
export function clampDateMin(dateStr: string, minStr: string): string {
  if (!dateStr) return dateStr;
  return dateStr < minStr ? minStr : dateStr;
}

/** Keeps a date inside [minStr, maxStr]. Returns undefined if the range is empty. */
export function clampDateRange(dateStr: string, minStr: string, maxStr: string): string | undefined {
  if (!dateStr) return undefined;
  if (minStr > maxStr) return undefined;
  return clampDateMax(clampDateMin(dateStr, minStr), maxStr);
}

export function addDays(dateStr: string, days: number): string {
  if (!isValidDateString(dateStr) || !Number.isFinite(days)) return dateStr;
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return formatDate(d);
}

export function getDaysDifference(startStr: string, endStr: string): number {
  if (!isValidDateString(startStr) || !isValidDateString(endStr)) return 0;
  const s = parseDate(startStr);
  const e = parseDate(endStr);
  const diffTime = e.getTime() - s.getTime();
  return Math.round(diffTime / (1000 * 3600 * 24));
}

/** Latest of a set of optional dates (undefined-safe; never returns ""). */
export function latestDate(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort().slice(-1)[0];
}

/** Earliest of a set of optional dates (undefined-safe; never returns ""). */
export function earliestDate(...dates: (string | undefined)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort()[0];
}

// ---------------------------------------------------------------------------
// Milestone chain helpers
// ---------------------------------------------------------------------------

/** Authoritative end of a milestone: real event first, then forecast, then plan. */
export function milestoneEffectiveEnd(ms?: Milestone | null): string | undefined {
  if (!ms) return undefined;
  return ms.actualEndDate || ms.forecastEndDate || ms.committedBaselineEndDate || undefined;
}

/**
 * The earliest date a milestone may be started on (its "chain anchor").
 *
 * Only a REAL event — the previous milestone's actual end — is a hard floor. A
 * forecast/planned end that has already passed is also enforceable. A planned
 * end still in the future must NEVER be used as a floor: doing so leaves the
 * picker with no selectable date and makes the stage impossible to record.
 */
export function chainAnchorDate(milestones: Milestone[], index: number, _todayStr?: string): string | undefined {
  if (index <= 0) return undefined;
  const prev = milestones[index - 1];
  if (!prev) return undefined;
  if (prev.actualEndDate) return prev.actualEndDate;
  return undefined;
}

export interface EventDateValidation {
  ok: boolean;
  error?: string;
}

/**
 * The one validator every milestone start/complete entry point uses (modals and
 * context alike), so the error a user sees is exactly the rule that is enforced.
 */
export function validateEventDate(params: {
  milestones: Milestone[];
  index: number;
  eventType: 'start' | 'complete';
  eventDate: string;
  todayStr: string;
}): EventDateValidation {
  const { milestones, index, eventType, eventDate, todayStr } = params;
  const ms = milestones[index];
  if (!ms) return { ok: false, error: 'Milestone not found.' };

  if (!isValidDateString(eventDate)) {
    return { ok: false, error: `Invalid date "${eventDate}". Expected a real calendar date (YYYY-MM-DD).` };
  }

  if (index > 0) {
    const prev = milestones[index - 1];
    const isPrevComplete = prev.status === 'Completed' || Boolean(prev.actualEndDate) || prev.completionPct === 100;
    if (!isPrevComplete) {
      return { ok: false, error: `Dependency Error: Cannot start or complete until the previous milestone (${prev.name}) is Completed.` };
    }
  }

  const anchor = chainAnchorDate(milestones, index, todayStr);

  if (eventType === 'start') {
    if (anchor && eventDate < anchor) {
      return {
        ok: false,
        error: `Date Sync Error: Start date (${eventDate}) cannot be earlier than the previous milestone's actual end date (${anchor}).`
      };
    }
    return { ok: true };
  }

  const startFloor = ms.actualStartDate || anchor;
  if (startFloor && eventDate < startFloor) {
    return {
      ok: false,
      error: `Date Sync Error: Completion date (${eventDate}) cannot be earlier than the milestone start date (${startFloor}).`
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Line-level normalization — every line mutation funnels through here so that
// no code path can persist an impossible date combination.
// ---------------------------------------------------------------------------

/**
 * Heals a line's STORED dates so the persisted state always satisfies:
 *   - actual events are never in the future
 *   - a milestone never ends before it starts
 *   - a milestone never starts before the previous milestone really ended
 *   - an "end without a start" is re-anchored instead of stored half-recorded
 * Forecast dates, variance and status are always derived afterwards by
 * `recalculateProductLine`, so they are never trusted from storage.
 */
export function normalizeLineDates(line: ProductLine, todayStr: string): ProductLine {
  if (!line.milestones || line.milestones.length === 0) return line;

  const normalized: Milestone[] = [];

  for (let i = 0; i < line.milestones.length; i++) {
    const ms: Milestone = { ...line.milestones[i] };

    let start = ms.actualStartDate;
    let end = ms.actualEndDate;

    if (start && !isValidDateString(start)) start = undefined;
    if (end && !isValidDateString(end)) end = undefined;

    // Stage 1 (Customer Purchase Order) is completed whenever a PO exists
    const isStage1 = ms.key === 'po_from_customer' || ms.stageOrder === 1 || i === 0;
    if (isStage1) {
      start = start || ms.committedBaselineStartDate || todayStr;
      end = end || start;
      ms.status = 'Completed';
      ms.completionPct = 100;
    }

    if (ms.key === 'corb_release') {
      if (end) {
        start = end;
        ms.status = 'Completed';
        ms.completionPct = 100;
      } else {
        ms.actualEndDate = undefined;
        if (ms.status === 'In Progress' || ms.actualStartDate) {
          ms.status = 'In Progress';
        } else {
          ms.status = 'Not Started';
          ms.completionPct = 0;
        }
      }
    } else {
      if (end && !start) {
        const anchor = chainAnchorDate(normalized, i, todayStr);
        const fallback = anchor && anchor <= end ? anchor : ms.committedBaselineStartDate;
        start = fallback && fallback <= end ? fallback : end;
      }

      if (start) {
        const anchor = chainAnchorDate(normalized, i, todayStr);
        if (anchor && start < anchor) {
          start = end ? (anchor <= end ? anchor : start) : anchor;
        }
      }

      if (start && end && end < start) end = start;
      if (!start && end) end = undefined;
    }

    ms.actualStartDate = start;
    ms.actualEndDate = end;
    normalized.push(ms);
  }

  return { ...line, milestones: normalized };
}

/**
 * Heals a material's STORED dates: an order/receipt is always in the past and a
 * receipt can never precede its order. When an invalid receipt is dropped, the
 * inspection outcome that depended on it is dropped too — otherwise the module
 * shows a "Passed" GRN for a material that was never received.
 */
export function normalizeMaterialDates(materials: MaterialItem[], _todayStr: string): MaterialItem[] {
  return (materials || []).map(material => {
    const ms: MaterialItem = { ...material };

    if (ms.orderedDate && !isValidDateString(ms.orderedDate)) {
      ms.orderedDate = undefined;
    }

    let received = ms.receivedDate;
    if (received && !isValidDateString(received)) {
      received = undefined;
    }
    if (received && ms.orderedDate && received < ms.orderedDate) {
      // If received date is earlier than order date, set order date to received date
      ms.orderedDate = received;
    }
    // A receipt with no order is kept and order date defaulted to received
    if (received && !ms.orderedDate) {
      ms.orderedDate = received;
    }

    if (ms.receivedDate !== received) {
      ms.receivedDate = received;
      if (!received) {
        ms.grnNumber = undefined;
        ms.inspectionResult = undefined;
        ms.inspectionNotes = undefined;
      }
    }

    if (ms.expectedDate) {
      if (!isValidDateString(ms.expectedDate)) {
        ms.expectedDate = undefined;
      } else {
        const lead = Number.isFinite(ms.leadTimeDays) && ms.leadTimeDays >= 0 ? ms.leadTimeDays : 0;
        const floor = ms.orderedDate ? addDays(ms.orderedDate, Math.max(0, lead - 1)) : undefined;
        if (floor && ms.expectedDate < floor) ms.expectedDate = floor;
      }
    }

    return ms;
  });
}

// ---------------------------------------------------------------------------
// Dependency rules
// ---------------------------------------------------------------------------

/**
 * Checks if production can start based on dependency rules:
 * Rule 1: Design & BOM must be approved (Milestone 4 BOM Release completed).
 * Rule 2: All critical path materials must be received and GRN inspection passed.
 */
export function canProductionStart(productLine: ProductLine): { allowed: boolean; reason?: string } {
  const designMs = productLine.milestones.find(m => m.key === 'bom_release' || m.key === 'design_approval');
  const isDesignDone = !designMs || designMs.status === 'Completed' || Boolean(designMs.actualEndDate) || designMs.completionPct === 100;
  if (designMs && !isDesignDone) {
    return {
      allowed: false,
      reason: `Design & BOM stage '${designMs.name}' is not yet completed/approved (BOM release approval required).`
    };
  }

  const pendingCriticalMaterials = productLine.materials.filter(
    m => m.isCriticalPath && m.inspectionResult !== 'Passed'
  );

  if (pendingCriticalMaterials.length > 0) {
    const names = pendingCriticalMaterials.map(m => `${m.itemCode} (${m.supplierName})`).join(', ');
    return {
      allowed: false,
      reason: `Critical material incoming inspection pending for: ${names}. All critical path materials must have Passed GRN inspection.`
    };
  }

  return { allowed: true };
}

/**
 * Checks if procurement can start based on dependency rules:
 * - New design: procurement starts ONLY after design & BOM approval.
 */
export function canProcurementStart(productLine: ProductLine): { allowed: boolean; reason?: string } {

  if (productLine.designType === 'New Design') {
    const designMs = productLine.milestones.find(m => m.key === 'bom_release' || m.key === 'design_approval');
    if (designMs && designMs.status !== 'Completed') {
      return {
        allowed: false,
        reason: `For New Design product lines, procurement starts ONLY after Design & BOM approval (Stage 4 BOM Release).`
      };
    }
  }

  return { allowed: true };
}

/**
 * Identifies the critical path item among materials (longest lead time).
 */
/**
 * Calculates product lead time based on raw material lead times and manufacturing duration.
 * Identifies the critical path material (longest lead time).
 * Product Total Lead Time = Critical Material Lead Time + Manufacturing Duration.
 */
export function calculateProductLeadTime(params: {
  materials?: Array<{ leadTimeDays: number; isCriticalPath?: boolean }>;
  manufacturingLeadTimeDays?: number;
  designType?: DesignType;
}): {
  criticalMaterialLeadTimeDays: number;
  manufacturingLeadTimeDays: number;
  totalLeadTimeDays: number;
} {
  const mats = params.materials || [];
  const criticalMatLead = mats.length > 0
    ? Math.max(...mats.map(m => Number(m.leadTimeDays) || 0))
    : 14;

  const mfgDays = typeof params.manufacturingLeadTimeDays === 'number' && params.manufacturingLeadTimeDays >= 0
    ? params.manufacturingLeadTimeDays
    : (params.designType === 'New Design' ? 45 : 24);

  return {
    criticalMaterialLeadTimeDays: criticalMatLead,
    manufacturingLeadTimeDays: mfgDays,
    totalLeadTimeDays: Math.max(1, criticalMatLead + mfgDays)
  };
}

export function updateMaterialCriticalPath(materials: MaterialItem[]): MaterialItem[] {
  if (materials.length === 0) return materials;

  let maxLead = -1;
  materials.forEach(m => {
    if (m.leadTimeDays > maxLead) maxLead = m.leadTimeDays;
  });

  return materials.map(m => ({
    ...m,
    isCriticalPath: m.leadTimeDays === maxLead
  }));
}

// ---------------------------------------------------------------------------
// Schedule generation — used by BOTH the order-intake preview and the actual PO
// creation, so the date a user is shown is always the date that gets saved.
// ---------------------------------------------------------------------------

/** Resolves the material list for a product line, falling back to catalog defaults. */
export function resolveLineMaterials(params: {
  providedMaterials?: MaterialItem[];
  catalogItem?: ProductMasterItem;
  qty: number;
  lineId: string;
}): MaterialItem[] {
  const { providedMaterials, catalogItem, qty, lineId } = params;
  if (providedMaterials && providedMaterials.length > 0) return providedMaterials;
  return (catalogItem?.defaultMaterials || []).map((m, idx) => ({
    id: `mat-${lineId}-${idx + 1}`,
    itemCode: m.itemCode,
    description: m.description,
    qty: qty || 1,
    unit: 'Pcs',
    supplierName: m.supplierName,
    leadTimeDays: m.leadTimeDays,
    isCriticalPath: m.isCriticalPath,
    inspectionResult: 'Pending' as const
  }));
}

/**
 * Builds a committed baseline milestone chain from a category template.
 * `raw_material` takes the longest material lead time when one is defined, so
 * the plan reflects real procurement instead of the template's nominal value.
 */
/**
 * Calculates and synchronizes the baseline schedule for a product line:
 * - Stage 1 (Customer PO): Anchored on PO date.
 * - Stage 2 (CORB Release): Start & end taken from CORB without delay calculation.
 * - Stage 3 (PM Baseline): Approval milestone aligned with CORB completion.
 * - Stages 4 to 14 (BOM Release -> Final Shipment):
 *   Start on the last date (complete) of CORB, with remaining durations scaled
 *   to fit the contractual committed delivery date while protecting raw material lead times.
 */
export function calculateMilestonesFromBOM(params: {
  milestones: Milestone[];
  poDate: string;
  corbEndDate?: string;
  deliveryDate?: string;
  materials?: MaterialItem[];
  customDurations?: Record<string, number>;
}): {
  milestones: Milestone[];
  calculatedDeliveryDate: string;
} {
  const { milestones, poDate, corbEndDate, deliveryDate, materials, customDurations } = params;
  const rawMaterialLeadTime = (materials && materials.length > 0)
    ? Math.max(...materials.map(m => m.leadTimeDays))
    : 14;

  const validPoDate = poDate && isValidDateString(poDate) ? poDate : todayLocal();

  // 11 manufacturing stages from BOM Release through Final Shipment
  const BOM_STAGE_KEYS = [
    'bom_release',
    'wo_release',
    'sub_supplier_po',
    'material_receipt',
    'machining',
    'assembly',
    'fg',
    'customer_inspection',
    'painting',
    'trn',
    'shipment'
  ];

  const defaultBOMDurations: Record<string, number> = {
    bom_release: 4,
    wo_release: 2,
    sub_supplier_po: 3,
    material_receipt: rawMaterialLeadTime > 0 ? rawMaterialLeadTime : 14,
    machining: 14,
    assembly: 5,
    fg: 2,
    customer_inspection: 2,
    painting: 2,
    trn: 1,
    shipment: 5
  };

  // Stage 1: PO Intake
  const s1Start = validPoDate;
  const s1End = validPoDate;
  const s1Dur = 1;

  // Stage 2: CORB Release (Single completion date input; no planned baseline dates)
  const existingCorb = milestones.find(m => m.key === 'corb_release');
  const corbCompletedDate = (corbEndDate && isValidDateString(corbEndDate))
    ? corbEndDate
    : (existingCorb?.actualEndDate && isValidDateString(existingCorb.actualEndDate) ? existingCorb.actualEndDate : '');
  const effectiveCorbAnchor = corbCompletedDate || addDays(s1End, 1);

  // Stage 3: PM Baseline Review (review gate following CORB)
  const s3Start = addDays(effectiveCorbAnchor, 1);
  const s3Dur = Math.max(1, customDurations?.['pm_baseline'] || 1);
  const s3End = addDays(s3Start, s3Dur - 1);

  // Stage 4: BOM Release (starts following CORB & Baseline review)
  const bomStart = addDays(s3End, 1);

  const rawDurations = BOM_STAGE_KEYS.map(key => {
    if (customDurations && typeof customDurations[key] === 'number') {
      return Math.max(1, customDurations[key]);
    }
    const existingMs = milestones.find(m => m.key === key);
    if (existingMs && existingMs.committedDurationDays > 0) {
      return (key === 'material_receipt' || key === 'raw_material') && rawMaterialLeadTime > 0
        ? Math.max(existingMs.committedDurationDays, rawMaterialLeadTime)
        : existingMs.committedDurationDays;
    }
    return defaultBOMDurations[key] || 2;
  });

  const totalRawDays = rawDurations.reduce((a, b) => a + b, 0);

  let scaledDurations = [...rawDurations];
  if (deliveryDate && isValidDateString(deliveryDate) && deliveryDate > bomStart) {
    const totalTargetDays = getDaysDifference(bomStart, deliveryDate) + 1;
    if (totalTargetDays >= BOM_STAGE_KEYS.length) {
      const matIdx = BOM_STAGE_KEYS.indexOf('material_receipt');
      const protectedMatDuration = (matIdx >= 0 && rawMaterialLeadTime > 0)
        ? Math.min(rawMaterialLeadTime, Math.max(1, totalTargetDays - (BOM_STAGE_KEYS.length - 1)))
        : 0;

      if (matIdx >= 0 && protectedMatDuration > 0) {
        const nonMatRawDays = rawDurations.reduce((sum, d, idx) => idx === matIdx ? sum : sum + d, 0);
        const remainingTargetDays = Math.max(BOM_STAGE_KEYS.length - 1, totalTargetDays - protectedMatDuration);
        let allocatedNonMatDays = 0;
        const nonMatCount = BOM_STAGE_KEYS.length - 1;
        let nonMatSeen = 0;

        scaledDurations = rawDurations.map((rawD, idx) => {
          if (idx === matIdx) return protectedMatDuration;
          nonMatSeen++;
          if (nonMatSeen === nonMatCount) {
            return Math.max(1, remainingTargetDays - allocatedNonMatDays);
          }
          const prop = Math.max(1, Math.round((rawD / (nonMatRawDays || 1)) * remainingTargetDays));
          allocatedNonMatDays += prop;
          return prop;
        });
      } else {
        let allocatedDays = 0;
        scaledDurations = rawDurations.map((rawD, idx) => {
          if (idx === rawDurations.length - 1) {
            return Math.max(1, totalTargetDays - allocatedDays);
          }
          const proportional = Math.max(1, Math.round((rawD / totalRawDays) * totalTargetDays));
          allocatedDays += proportional;
          return proportional;
        });
      }
    }
  }

  let bomRunningDate = bomStart;
  const updated = milestones.map((ms, idx) => {
    const isStage1 = ms.key === 'po_from_customer' || idx === 0;
    const isStage2 = ms.key === 'corb_release' || idx === 1;
    const isStage3 = ms.key === 'pm_baseline' || ms.key === 'baseline_review' || idx === 2;

    if (isStage1) {
      return {
        ...ms,
        stageOrder: 1,
        committedBaselineStartDate: s1Start,
        committedBaselineEndDate: s1End,
        committedDurationDays: s1Dur,
        forecastStartDate: ms.actualStartDate || s1Start,
        forecastEndDate: ms.actualEndDate || s1End,
        varianceDays: 0
      };
    }
    if (isStage2) {
      const isCompleted = Boolean(corbCompletedDate);
      return {
        ...ms,
        stageOrder: 2,
        committedBaselineStartDate: '',
        committedBaselineEndDate: '',
        committedDurationDays: 0,
        actualStartDate: undefined,
        forecastStartDate: '',
        forecastEndDate: corbCompletedDate || '',
        actualEndDate: corbCompletedDate || undefined,
        status: isCompleted ? ('Completed' as MilestoneStatus) : ('Not Started' as MilestoneStatus),
        completionPct: isCompleted ? 100 : 0,
        varianceDays: 0
      };
    }
    if (isStage3) {
      return {
        ...ms,
        stageOrder: 3,
        committedBaselineStartDate: s3Start,
        committedBaselineEndDate: s3End,
        committedDurationDays: s3Dur,
        forecastStartDate: ms.actualStartDate || s3Start,
        forecastEndDate: ms.actualEndDate || s3End,
        varianceDays: 0
      };
    }

    const bomIdx = BOM_STAGE_KEYS.indexOf(ms.key);
    const duration = bomIdx >= 0 ? scaledDurations[bomIdx] : (ms.committedDurationDays || 2);
    const sStart = bomRunningDate;
    const sEnd = addDays(sStart, Math.max(1, duration) - 1);
    bomRunningDate = addDays(sEnd, 1);

    return {
      ...ms,
      stageOrder: idx + 1,
      committedBaselineStartDate: sStart,
      committedBaselineEndDate: sEnd,
      committedDurationDays: duration,
      forecastStartDate: ms.actualStartDate || sStart,
      forecastEndDate: ms.actualEndDate || sEnd,
      varianceDays: 0
    };
  });

  const lastMs = updated[updated.length - 1];
  const calculatedDeliveryDate = lastMs?.committedBaselineEndDate || deliveryDate || bomRunningDate;

  return { milestones: updated, calculatedDeliveryDate };
}

/**
 * Builds the initial committed baseline schedule across the canonical 14 stages:
 * - Stage 1 (Customer PO): intake date.
 * - Stage 2 (CORB Release): intake to CORB end.
 * - Stage 3 (Baseline Planning & Review): review gate.
 * - Stages 4 to 14 (BOM Release -> Shipment): starting from CORB end date and
 *   proportionally calculated to delivery target date.
 */
export function buildTemplateSchedule(params: {
  template?: CategoryTemplate;
  designType: DesignType;
  materials: MaterialItem[];
  startDate: string;
  lineId: string;
  targetEndDate?: string;
  corbEndDate?: string;
}): Milestone[] {
  const { template, materials, startDate, lineId, targetEndDate, corbEndDate } = params;

  let durations = (template?.milestoneDurations || []).filter(m => Boolean(m.milestoneKey));
  
  if (durations.length === 0 || !durations.some(m => m.milestoneKey === 'po_from_customer')) {
    durations = [
      { milestoneKey: 'po_from_customer', milestoneName: '1. Customer Purchase Order (PO)', durationDays: 1 },
      { milestoneKey: 'corb_release', milestoneName: '2. CORB Release', durationDays: 2 },
      { milestoneKey: 'pm_baseline', milestoneName: '3. Baseline Review & Planning', durationDays: 1 },
      { milestoneKey: 'bom_release', milestoneName: '4. BOM Release', durationDays: 4 },
      { milestoneKey: 'wo_release', milestoneName: '5. Work Order Release', durationDays: 2 },
      { milestoneKey: 'sub_supplier_po', milestoneName: '6. Sub-Supplier PO', durationDays: 3 },
      { milestoneKey: 'material_receipt', milestoneName: '7. Material Receipt (GRN)', durationDays: 14 },
      { milestoneKey: 'machining', milestoneName: '8. Machining', durationDays: 14 },
      { milestoneKey: 'assembly', milestoneName: '9. Assembly', durationDays: 5 },
      { milestoneKey: 'fg', milestoneName: '10. FG', durationDays: 2 },
      { milestoneKey: 'customer_inspection', milestoneName: '11. Customer Inspection', durationDays: 2 },
      { milestoneKey: 'painting', milestoneName: '12. Painting', durationDays: 2 },
      { milestoneKey: 'trn', milestoneName: '13. TRN', durationDays: 1 },
      { milestoneKey: 'shipment', milestoneName: '14. Final Shipment & Dispatch', durationDays: 5 },
    ];
  }

  const baseMilestones: Milestone[] = durations.map((m, idx) => ({
    id: `ms-${lineId}-${idx + 1}`,
    key: m.milestoneKey,
    name: m.milestoneName,
    stageOrder: idx + 1,
    defaultDurationDays: m.durationDays,
    committedBaselineStartDate: startDate,
    committedBaselineEndDate: startDate,
    committedDurationDays: m.durationDays,
    forecastStartDate: startDate,
    forecastEndDate: startDate,
    varianceDays: 0,
    status: 'Not Started' as MilestoneStatus,
    completionPct: 0
  }));

  const { milestones: scheduled } = calculateMilestonesFromBOM({
    milestones: baseMilestones,
    poDate: startDate,
    corbEndDate: (corbEndDate && isValidDateString(corbEndDate)) ? corbEndDate : undefined,
    deliveryDate: targetEndDate,
    materials
  });

  return scheduled;
}

/** Last committed date across every line — the order's delivery date. */
export function getOrderDeliveryDate(productLines: ProductLine[], fallbackStart: string): string {
  const ends = productLines
    .map(line => line.milestones[line.milestones.length - 1]?.committedBaselineEndDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  return ends[ends.length - 1] || addDays(fallbackStart, 60);
}

// ---------------------------------------------------------------------------
// Core recalculation
// ---------------------------------------------------------------------------

/**
 * Recalculates milestone forecast dates, variances, and status rollups for a
 * Product Line. This is the ONLY place derived date state is produced: it
 * normalizes stored dates first so an impossible combination can never survive
 * a save, whatever endpoint triggered it.
 */
export function recalculateProductLine(
  productLine: ProductLine,
  todayStr: string,
  atRiskThreshold: number = 3,
  delayedThreshold: number = 7
): ProductLine {
  const healedLine = normalizeLineDates(
    { ...productLine, materials: normalizeMaterialDates(productLine.materials, todayStr) },
    todayStr
  );

  const milestones = healedLine.milestones;
  if (milestones.length === 0) {
    return { ...healedLine, overallVarianceDays: 0, status: 'Not Started' };
  }

  let currentForecastStart = milestones[0].committedBaselineStartDate || todayStr;

  // The longest expected or actual material arrival drives material receipt end
  // date. Do not clamp an expected date to today: doing so makes an unfinished
  // material stage move forward every day and creates a growing false delay.
  let maxMaterialArrivalDate = '';
  for (const mat of healedLine.materials) {
    const arrival = mat.receivedDate || mat.expectedDate;
    if (arrival && arrival > maxMaterialArrivalDate) {
      maxMaterialArrivalDate = arrival;
    }
  }

  const updatedMilestones: Milestone[] = [];

  for (let msIndex = 0; msIndex < milestones.length; msIndex++) {
    const ms = milestones[msIndex];
    let forecastStart = ms.committedBaselineStartDate || currentForecastStart;

    if (msIndex > 0) {
      const prevMs = updatedMilestones[msIndex - 1];
      const prevEnd = milestoneEffectiveEnd(prevMs);
      if (prevEnd) {
        const chainStart = addDays(prevEnd, 1);
        if (chainStart > forecastStart) {
          forecastStart = chainStart;
        }
      }
    }

    if (ms.actualStartDate) {
      const prevEnd = msIndex > 0 ? milestoneEffectiveEnd(updatedMilestones[msIndex - 1]) : undefined;
      const prevChainStart = prevEnd ? addDays(prevEnd, 1) : undefined;
      forecastStart = prevChainStart && ms.actualStartDate < prevChainStart ? prevChainStart : ms.actualStartDate;
    }

    // A milestone always occupies at least one day, so its start can never equal
    // (or overtake) its own end.
    const duration = Math.max(1, ms.committedDurationDays || 1);
    const isMaterialStage = ms.key === 'material_receipt' || ms.key === 'raw_material';
    const startDelay = (ms.committedBaselineStartDate && forecastStart > ms.committedBaselineStartDate)
      ? getDaysDifference(ms.committedBaselineStartDate, forecastStart)
      : 0;
    let forecastEnd = ms.actualEndDate || (
      startDelay > 0 && ms.committedBaselineEndDate
        ? addDays(ms.committedBaselineEndDate, startDelay)
        : (ms.committedBaselineEndDate || addDays(forecastStart, duration - 1))
    );

    const hasInPrepSub = ms.subdivisions?.some(s => s.status === 'In Progress');
    const isActivelyStartedOrInProgress = Boolean(ms.actualStartDate) || Boolean(hasInPrepSub) || ms.status === 'In Progress';

    if (!ms.actualEndDate && isActivelyStartedOrInProgress) {
      if (ms.forecastEndDate && ms.forecastEndDate > forecastEnd) {
        forecastEnd = ms.forecastEndDate;
      }
      const existingVar = !isMaterialStage && typeof ms.varianceDays === 'number' && ms.varianceDays > 0
        ? ms.varianceDays
        : 0;
      if (existingVar > startDelay && ms.committedBaselineEndDate) {
        const varEnd = addDays(ms.committedBaselineEndDate, existingVar);
        if (varEnd > forecastEnd) {
          forecastEnd = varEnd;
        }
      }
    }

    const criticalMat = isMaterialStage
      ? (healedLine.materials?.find(m => m.isCriticalPath) || healedLine.materials?.[0])
      : undefined;

    if (isMaterialStage && !ms.actualEndDate) {
      if (criticalMat?.expectedDate) {
        // Repair stale derived forecasts from older recalculations. The
        // material's expected date is the stable source of truth until receipt.
        forecastEnd = criticalMat.expectedDate;
      } else if (maxMaterialArrivalDate && maxMaterialArrivalDate > forecastEnd) {
        forecastEnd = maxMaterialArrivalDate;
      }
    }

    const effEnd = ms.actualEndDate || forecastEnd;
    let varianceDays: number;

    const prevMs = msIndex > 0 ? updatedMilestones[msIndex - 1] : undefined;
    const inheritedDelay = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;

    if (isMaterialStage) {
      const matLeadTime = (criticalMat && typeof criticalMat.leadTimeDays === 'number' && criticalMat.leadTimeDays > 0)
        ? criticalMat.leadTimeDays
        : duration;
      const targetOrderStart = (ms.committedBaselineStartDate && forecastStart > ms.committedBaselineStartDate)
        ? forecastStart
        : (ms.committedBaselineStartDate || forecastStart);
      const targetDelivery = targetOrderStart ? addDays(targetOrderStart, Math.max(0, matLeadTime - 1)) : forecastEnd;
      const revisedTarget = ms.committedBaselineEndDate
        ? addDays(ms.committedBaselineEndDate, inheritedDelay)
        : forecastEnd;
      const crossingLine = criticalMat?.expectedDate || revisedTarget || targetDelivery || ms.committedBaselineEndDate;

      if (ms.actualEndDate) {
        if (crossingLine && ms.actualEndDate > crossingLine) {
          const newDelay = getDaysDifference(crossingLine, ms.actualEndDate);
          varianceDays = inheritedDelay + newDelay;
        } else if (crossingLine && ms.actualEndDate < crossingLine) {
          const baselineDiff = ms.committedBaselineEndDate
            ? getDaysDifference(ms.committedBaselineEndDate, ms.actualEndDate)
            : 0;
          const daysEarly = getDaysDifference(ms.actualEndDate, crossingLine);
          // Recover time from crossing line, but physical variance cannot fall below baseline deviation when late against baseline
          varianceDays = Math.max(baselineDiff, inheritedDelay - daysEarly);
        } else {
          varianceDays = inheritedDelay;
        }
      } else {
        if (!ms.actualStartDate && !ms.actualEndDate && !hasInPrepSub && !criticalMat?.expectedDate) {
          varianceDays = inheritedDelay;
        } else if (forecastEnd && crossingLine && forecastEnd > crossingLine) {
          const newDelay = getDaysDifference(crossingLine, forecastEnd);
          varianceDays = inheritedDelay + newDelay;
        } else {
          varianceDays = inheritedDelay;
        }
      }
    } else {
      if (!ms.actualStartDate && !ms.actualEndDate && !hasInPrepSub) {
        // An unstarted milestone inherits schedule variance strictly from its predecessor.
        // It cannot accumulate independent execution delay before work begins.
        varianceDays = inheritedDelay;
      } else {
        // For active or completed milestones, variance is measured against the committed baseline end date
        varianceDays = effEnd > ms.committedBaselineEndDate 
          ? Math.max(1, getDaysDifference(ms.committedBaselineEndDate, effEnd))
          : getDaysDifference(ms.committedBaselineEndDate, effEnd);
      }
    }

    let status: MilestoneStatus = ms.status;
    let delayCategory = varianceDays > 0 ? ms.delayCategory : undefined;
    let delayReason = (varianceDays > 0 && ms.delayReason && !ms.delayReason.startsWith('Inherited delay') && !ms.delayReason.startsWith('Cascaded delay'))
      ? ms.delayReason
      : undefined;
    let delayOwner = ms.delayOwner;

    const delayedSub = ms.subdivisions?.find(s => s.status === 'Delayed');
    const allSubsDone = ms.subdivisions && ms.subdivisions.length > 0 && ms.subdivisions.every(s => s.status === 'Done');

    if (ms.key === 'corb_release') {
      ms.committedBaselineStartDate = '';
      ms.committedBaselineEndDate = '';
      ms.committedDurationDays = 0;
      ms.forecastStartDate = '';
      ms.forecastEndDate = ms.actualEndDate || '';
      varianceDays = 0;
      delayCategory = undefined;
      delayReason = undefined;
      delayOwner = undefined;
      if (ms.actualEndDate) {
        status = 'Completed';
        ms.completionPct = 100;
      } else if (ms.status === 'In Progress' || ms.actualStartDate) {
        status = 'In Progress';
        ms.completionPct = ms.completionPct || 50;
      } else {
        status = 'Not Started';
        ms.completionPct = 0;
      }
    } else if (ms.key === 'pm_baseline' || ms.key === 'baseline_review') {
      // Stage 3 Baseline Review is the gate following CORB.
      // CORB completion never creates delay for Baseline Review before work begins.
      if (!ms.actualStartDate && !ms.actualEndDate) {
        varianceDays = 0;
        delayCategory = undefined;
        delayReason = undefined;
        delayOwner = undefined;
      }
    } else if (delayedSub) {
      status = 'Delayed';
      if (delayedSub.delayCause) delayCategory = delayedSub.delayCause;
      if (delayedSub.delayNote) delayReason = delayedSub.delayNote;
      if (delayedSub.ownerLabel || delayedSub.ownerSlot) delayOwner = delayedSub.ownerLabel || delayedSub.ownerSlot;
    } else if (ms.actualEndDate) {
      status = 'Completed';
    } else if (ms.actualStartDate || hasInPrepSub) {
      // Actively started milestones are in progress/execution; delays are tracked in varianceDays / delayReason
      if (varianceDays > atRiskThreshold && varianceDays <= delayedThreshold) {
        status = 'At Risk';
      } else if (varianceDays > delayedThreshold) {
        status = 'Delayed';
      } else {
        status = 'In Progress';
      }
    } else {
      // Milestone has not started work yet. It is not an active execution delay.
      // Its shifted forecast schedule is tracked via varianceDays and forecast dates.
      status = allSubsDone ? 'In Progress' : 'Not Started';
    }

    currentForecastStart = forecastEnd;

    updatedMilestones.push({
      ...ms,
      forecastStartDate: forecastStart,
      forecastEndDate: forecastEnd,
      varianceDays,
      status,
      delayCategory,
      delayReason,
      delayOwner
    });
  }

  // The overall line variance is governed by the final milestone delivery variance
  // If an upcoming milestone finishes early and recovers the schedule, final variance will correctly reflect the net delay or 0
  const finalMilestone = updatedMilestones[updatedMilestones.length - 1];
  const finalVariance = finalMilestone ? finalMilestone.varianceDays : 0;
  const overallVarianceDays = Math.max(0, finalVariance);

  let lineStatus: MilestoneStatus = 'Not Started';
  const allCompleted = updatedMilestones.length > 0 && updatedMilestones.every(m => m.status === 'Completed');
  const hasActiveDelayed = updatedMilestones.some(m => !m.actualEndDate && m.status === 'Delayed');
  const hasActiveAtRisk = updatedMilestones.some(m => !m.actualEndDate && m.status === 'At Risk');

  if (allCompleted) {
    lineStatus = 'Completed';
  } else if (hasActiveDelayed || overallVarianceDays > 0) {
    lineStatus = 'Delayed';
  } else if (hasActiveAtRisk) {
    lineStatus = 'At Risk';
  } else if (updatedMilestones.some(m => m.status === 'In Progress' || m.status === 'Completed' || Boolean(m.actualStartDate))) {
    lineStatus = 'On Track';
  }

  return {
    ...healedLine,
    milestones: updatedMilestones,
    overallVarianceDays,
    status: lineStatus
  };
}

// ---------------------------------------------------------------------------
// Corrective action proposals
// ---------------------------------------------------------------------------

/**
 * Generates rule-based corrective action proposals for delayed or at-risk milestones.
 */
export function generateSuggestedRectifications(
  poNumber: string,
  line: ProductLine,
  ms: Milestone,
  _category: DelayCategory
): RectificationAction[] {
  const actions: RectificationAction[] = [];
  const now = new Date().toISOString();
  // Unique-per-action id suffix: two rules can fire in the same millisecond.
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (ms.key === 'raw_material' || ms.key === 'material_receipt' || ms.key === 'sub_supplier_po' || ms.key === 'incoming_inspection') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Expedite',
      title: 'Air freight express dispatch for critical long-lead material',
      description: 'Authorize express air freight shipment directly from tier-1 casting foundry to save transit lead time.',
      impactDaysSaved: Math.min(ms.varianceDays, 5),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Purchase Manager',
      status: 'Proposed'
    });
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Alternate Supplier',
      title: 'Engage secondary pre-approved foundry for urgent billet supply',
      description: 'Switch remaining 30% valve body forgings to secondary audited supplier (Sandvik Materials).',
      impactDaysSaved: Math.min(ms.varianceDays, 8),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Procurement Head',
      status: 'Proposed'
    });
  } else if (ms.key === 'design_approval' || ms.key === 'bom_release' || ms.key === 'corb_release' || ms.key === 'pm_baseline') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Parallel Review',
      title: 'Initiate concurrent preliminary BOM release to procurement',
      description: 'Release long-lead raw material specifications to purchase team before final 3D CAD sign-off.',
      impactDaysSaved: Math.min(ms.varianceDays, 6),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Lead Design Engineer',
      status: 'Proposed'
    });
  } else if (ms.key === 'production' || ms.key === 'machining' || ms.key === 'assembly' || ms.key === 'fg' || ms.key === 'painting' || ms.key === 'qc_pass') {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Added Shift',
      title: 'Authorize 2nd shift machining & weekend Hydro-testing',
      description: 'Schedule additional overtime shift on 5-axis CNC cell to recover machining schedule.',
      impactDaysSaved: Math.min(ms.varianceDays, 4),
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Production Superintendent',
      status: 'Proposed'
    });
  } else {
    actions.push({
      id: `rect-${uid()}`,
      poNumber,
      productLineId: line.id,
      productLineName: line.productName,
      milestoneKey: ms.key,
      milestoneName: ms.name,
      type: 'Formal Baseline Change Note',
      title: 'Issue formal Baseline Revision request to customer',
      description: `Submit contract revision for '${ms.name}' with formal delay justification for customer approval.`,
      impactDaysSaved: 0,
      suggestedBy: 'Automated Rule Engine',
      suggestedAt: now,
      assignedTo: 'Sales Account Director',
      status: 'Proposed'
    });
  }

  return actions;
}

/**
 * Idempotently merges user notes with an inherited delay summary without stacking duplicate text.
 */
export function mergeDelayReason(existingReason: string = '', inheritedSummary: string = ''): string {
  if (!inheritedSummary) return existingReason;
  const cleanExisting = (existingReason || '')
    .split(/\s*\|\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('Inherited delay') && !s.startsWith('Delay cascaded from'));

  if (cleanExisting.length > 0) {
    return `${cleanExisting.join(' | ')} | ${inheritedSummary}`;
  }
  return inheritedSummary;
}

export interface MilestoneRevisedDates {
  revisedStart: string;
  revisedEnd: string;
  shiftDays: number;
  isDelayed: boolean;
  baselineStart: string;
  baselineEnd: string;
  baselineDuration: number;
}

/**
 * Single canonical source of truth for milestone revised target dates, timeline shift, and baseline comparisons.
 * Ensures consistent calculation across all roles, modals, and views.
 */
export function getMilestoneRevisedDates(
  ms: Milestone,
  prevMilestone?: Milestone | null,
  fallbackPoDate?: string,
  fallbackPoDelivery?: string
): MilestoneRevisedDates {
  if (ms.key === 'corb_release') {
    return {
      revisedStart: '',
      revisedEnd: ms.actualEndDate || '',
      shiftDays: 0,
      baselineStart: '',
      baselineEnd: '',
      baselineDuration: 0,
      isDelayed: false
    };
  }

  const baselineStart = ms.committedBaselineStartDate || fallbackPoDate || '';
  const baselineEnd = ms.committedBaselineEndDate || fallbackPoDelivery || '';
  const dur = Math.max(1, ms.committedDurationDays || 1);
  const baselineDuration = (baselineStart && baselineEnd)
    ? Math.max(1, getDaysDifference(baselineStart, baselineEnd) + 1)
    : dur;

  // Previous stage effective completion (real event first, then revised forecast/variance)
  const prevEffectiveEnd = prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || (
    prevMilestone?.committedBaselineEndDate && typeof prevMilestone.varianceDays === 'number' && prevMilestone.varianceDays > 0
      ? addDays(prevMilestone.committedBaselineEndDate, prevMilestone.varianceDays)
      : undefined
  );

  // Revised Start:
  // 1. If actualStartDate exists and is later than baselineStart, use actualStartDate.
  // 2. Otherwise if forecastStartDate exists and is later than baselineStart, use forecastStartDate as single source of truth.
  // 3. Otherwise if previous stage ends after baselineStart, shift start to previous stage end.
  // 4. Otherwise use baselineStart.
  let revisedStart = (ms.actualStartDate && (!baselineStart || ms.actualStartDate > baselineStart)) ? ms.actualStartDate : '';
  if (!revisedStart) {
    if (ms.forecastStartDate && baselineStart && ms.forecastStartDate > baselineStart) {
      revisedStart = ms.forecastStartDate;
    } else if (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart) {
      revisedStart = prevEffectiveEnd;
    } else {
      revisedStart = baselineStart || ms.forecastStartDate || ms.actualStartDate || '';
    }
  }

  // Calculate start shift against baseline start
  const startShift = (baselineStart && revisedStart && revisedStart > baselineStart)
    ? getDaysDifference(baselineStart, revisedStart)
    : 0;

  const prevVar = prevMilestone ? Math.max(0, typeof prevMilestone.varianceDays === 'number' ? prevMilestone.varianceDays : 0) : 0;
  const currVar = Math.max(0, typeof ms.varianceDays === 'number' ? ms.varianceDays : 0);
  const addedDelayHere = Math.max(0, currVar - prevVar);

  // Revised End:
  // Baseline / revised target benchmark date:
  let targetEnd = '';
  const hasInPrepSub = ms.subdivisions?.some(s => s.status === 'In Progress');
  const isActivelyStartedOrInProgress = Boolean(ms.actualStartDate) || Boolean(hasInPrepSub) || ms.status === 'In Progress';

  if (isActivelyStartedOrInProgress && ms.forecastEndDate && (!baselineEnd || ms.forecastEndDate > baselineEnd)) {
    targetEnd = ms.forecastEndDate;
  }
  
  if (addedDelayHere > 0 && revisedStart) {
    const candidateWithAdded = addDays(revisedStart, baselineDuration + addedDelayHere - 1);
    if (!targetEnd || candidateWithAdded > targetEnd) {
      targetEnd = candidateWithAdded;
    }
  } else if (startShift > 0 && revisedStart) {
    const candidateFromShift = addDays(revisedStart, baselineDuration - 1);
    if (!targetEnd || candidateFromShift > targetEnd) {
      targetEnd = candidateFromShift;
    }
  }

  if (isActivelyStartedOrInProgress && currVar > 0 && baselineEnd) {
    const candidateFromVar = addDays(baselineEnd, currVar);
    if (!targetEnd || candidateFromVar > targetEnd) {
      targetEnd = candidateFromVar;
    }
  }

  if (!targetEnd) {
    targetEnd = baselineEnd || (revisedStart ? addDays(revisedStart, baselineDuration - 1) : '');
  }

  // If actualEndDate exists and is delayed beyond targetEnd, revisedEnd reflects the delayed completion date.
  // But if actualEndDate completed on-time or early, revisedEnd MUST PRESERVE the benchmark targetEnd!
  // It must never overwrite an on-time or early target date with an early completion date.
  let revisedEnd = targetEnd;
  if (ms.actualEndDate && targetEnd && ms.actualEndDate > targetEnd) {
    revisedEnd = ms.actualEndDate;
  }

  // Ensure revisedEnd is never before revisedStart
  if (revisedStart && revisedEnd && revisedEnd < revisedStart) {
    revisedEnd = addDays(revisedStart, baselineDuration - 1);
  }

  // Total shift days is either end variance or start shift
  const endShift = (baselineEnd && revisedEnd && revisedEnd > baselineEnd)
    ? getDaysDifference(baselineEnd, revisedEnd)
    : 0;
  const shiftDays = Math.max(startShift, endShift, currVar, startShift + addedDelayHere);
  if (shiftDays > endShift && baselineEnd && !ms.actualEndDate) {
    const endFromTotalShift = addDays(baselineEnd, shiftDays);
    if (endFromTotalShift > revisedEnd) {
      revisedEnd = endFromTotalShift;
    }
  }
  const isDelayed = shiftDays > 0;

  return {
    revisedStart,
    revisedEnd,
    shiftDays,
    isDelayed,
    baselineStart,
    baselineEnd,
    baselineDuration
  };
}

/**
 * Calculates customer contractual delivery variance and delivery risk.
 * 
 * Separates the 3 critical schedule metrics:
 * 1. Individual milestone variance = effEnd - committedBaselineEndDate
 * 2. Overall manufacturing schedule variance = finalMilestone.varianceDays
 * 3. Customer contractual delivery variance = projectedDeliveryDate - committedDeliveryDate
 */
export function calculateContractualDeliveryVariance(
  committedDeliveryDate: string,
  projectedDeliveryDate: string
): {
  contractualVarianceDays: number;
  isContractuallyDelayed: boolean;
  isContractuallyAtRisk: boolean;
  bufferDaysRemaining: number;
} {
  if (!isValidDateString(committedDeliveryDate) || !isValidDateString(projectedDeliveryDate)) {
    return {
      contractualVarianceDays: 0,
      isContractuallyDelayed: false,
      isContractuallyAtRisk: false,
      bufferDaysRemaining: 0
    };
  }

  const diff = getDaysDifference(committedDeliveryDate, projectedDeliveryDate);
  return {
    contractualVarianceDays: diff, // > 0 means delivery breaches customer contract; < 0 means ahead of contract
    isContractuallyDelayed: diff > 0,
    isContractuallyAtRisk: diff > -3 && diff <= 0,
    bufferDaysRemaining: Math.max(0, -diff)
  };
}
