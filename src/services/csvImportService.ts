import type {
  PurchaseOrder,
  ProductLine,
  Milestone,
  MilestoneStatus,
  CategoryTemplate,
  ProductMasterItem,
  DesignType,
  MaterialItem
} from '../types';
import * as XLSX from 'xlsx';
import {
  todayLocal,
  isValidDateString,
  formatDate,
  addDays,
  getDaysDifference,
  recalculateProductLine,
  resolveLineMaterials,
  buildTemplateSchedule,
  getOrderDeliveryDate
} from './calculationEngine';

// Standard 14 Stages Metadata
export const STANDARD_STAGES_IMPORT_MAP = [
  { stage: 1, key: 'po_from_customer', name: '1. Customer Purchase Order (PO)', colHeader: 'S1_CustomerPO_Actual', defaultDays: 1 },
  { stage: 2, key: 'pm_baseline', name: '2. Baseline Review & Planning', colHeader: 'S2_PMBaseline_Actual', defaultDays: 3 },
  { stage: 3, key: 'corb_release', name: '3. CORB Release', colHeader: 'S3_CORB_Actual', defaultDays: 2 },
  { stage: 4, key: 'bom_release', name: '4. BOM Release', colHeader: 'S4_BOMRelease_Actual', defaultDays: 4 },
  { stage: 5, key: 'wo_release', name: '5. Work Order Release', colHeader: 'S5_WORelease_Actual', defaultDays: 2 },
  { stage: 6, key: 'sub_supplier_po', name: '6. Sub-Supplier PO', colHeader: 'S6_SubSupplierPO_Actual', defaultDays: 3 },
  { stage: 7, key: 'material_receipt', name: '7. Material Receipt (GRN)', colHeader: 'S7_MaterialReceipt_Actual', defaultDays: 14 },
  { stage: 8, key: 'machining', name: '8. Machining', colHeader: 'S8_Machining_Actual', defaultDays: 14 },
  { stage: 9, key: 'assembly', name: '9. Assembly', colHeader: 'S9_Assembly_Actual', defaultDays: 5 },
  { stage: 10, key: 'fg', name: '10. FG', colHeader: 'S10_FG_Actual', defaultDays: 2 },
  { stage: 11, key: 'customer_inspection', name: '11. Customer Inspection', colHeader: 'S11_Inspection_Actual', defaultDays: 2 },
  { stage: 12, key: 'painting', name: '12. Painting', colHeader: 'S12_Painting_Actual', defaultDays: 2 },
  { stage: 13, key: 'trn', name: '13. TRN', colHeader: 'S13_TRN_Actual', defaultDays: 1 },
  { stage: 14, key: 'shipment', name: '14. Final Shipment & Dispatch', colHeader: 'S14_Shipment_Actual', defaultDays: 5 }
];

// ---------------------------------------------------------------------------
// Stage column aliases
//
// Each stage lists the real-world header spellings it accepts. They are resolved
// in order, and a candidate is rejected when the full header contains one of the
// stage's REJECT tokens. That exclusion is what keeps "Mini-BOM Actual" out of the
// real BOM (Stage 4) slot and "Delay in Mini-BOM" out of the BOM delay slot.
// ---------------------------------------------------------------------------

export const STAGE_ACTUAL_ALIASES: Record<number, string[]> = {
  1: ['Customer PO Date', 'Customer PO Actual', 'Customer PO Intake', 'PO Intake', 'PO Date', 'Order Date Actual', 'Order Date', 'Date'],
  2: ['PM Baseline Actual', 'PM Baseline Date', 'PM Baseline', 'Baseline Review & Planning', 'Baseline Review', 'Baseline Actual', 'Baseline Date', 'PM Baseline Schedule'],
  3: ['CORB Release Actual', 'CORB Actual', 'CORB Actual Date', 'CORB Release Date', 'CORB Release', 'CORB Open Points Closure', 'CORB Open Points', 'CORB'],
  4: ['BOM Release Actual', 'BOM Actual', 'BOM Release Date', 'BOM Release', 'BOM', 'Mini-BOM Actual', 'Mini-BOM Release Actual', 'Mini BOM Actual'],
  5: ['Work Order Release Actual', 'WO Release Actual', 'WO Actual', 'Work Order Release', 'WO Release Date', 'WO Release', 'Work Order', 'WO', 'PO - Long Leads Actual', 'Long Lead PO Actual', 'PO - Long Leads', 'Long Leads Actual'],
  // "PO" and "PO Date" are deliberately excluded: they are the customer-PO columns on
  // ordinary sheets, and matching them fabricated a completed Sub-Supplier PO stage.
  6: ['Sub-Supplier PO Actual', 'Sub Supplier PO Actual', 'Sub-Supplier PO Date', 'Sub Supplier PO Date', 'Sub-Supplier PO', 'Sub Supplier PO', 'PO Actual', 'Next Milestone Actual', 'Next Milestone Date', 'Next Milestone'],
  7: ["Mat'l receipt Actual", 'Material Receipts Actual', 'Material Receipt Actual', 'Material Receipt Date', 'Material Receipt (GRN)', 'Material Receipt', 'Material Receipts', 'GRN Actual', 'GRN Date', 'GRN'],
  8: ['Machining Actual', 'Machining Date', 'Machining Complete', 'Machining'],
  9: ['Assembly Actual', 'Assembly Date', 'Assembly Complete', 'Assembly'],
  10: ['FG Actual', 'Finished Goods Actual', 'FG Date', 'Finished Goods', 'FG Complete', 'FG'],
  11: ['Customer Inspection Actual', 'Customer Inspection Date', 'Inspection Actual', 'Customer Inspection', 'Inspection Complete', 'Inspection'],
  12: ['Painting Actual', 'Painting Date', 'Painting Complete', 'Painting'],
  13: ['TRN Actual', 'TRN Date', 'Test Report Notice', 'TRN Complete', 'TRN'],
  14: ['Packing & Dispatch Actual', 'Packing & Dispatch Date', 'Packing / Shipping Actual', 'Final Shipment & Dispatch Actual', 'Shipment Actual', 'Dispatch Actual', 'Packing & Dispatch', 'Packing / Shipping', 'Shipment Date', 'Dispatch Date', 'Customer Delivery Actual', 'Customer Delivery Date']
};

export const STAGE_PLANNED_ALIASES: Record<number, string[]> = {
  1: ['S1_CustomerPO_Planned', 'Customer PO Planned', 'Customer PO Date', 'PO Date', 'Order Date Planned', 'Order Date Target', 'Order Date'],
  2: ['S2_PMBaseline_Planned', 'PM Baseline Planned', 'PM Baseline Target', 'Baseline Planned', 'PM Baseline Plan'],
  3: ['S3_CORB_Planned', 'CORB Release Planned', 'CORB Planned', 'CORB Plan', 'CORB Target Date', 'CORB Target', 'CORB Planned Date', 'CORB Plan Date'],
  4: ['S4_BOMRelease_Planned', 'BOM Release Planned', 'BOM Planned', 'BOM Plan', 'BOM Target Date', 'BOM Target', 'Mini-BOM Planned', 'Mini-BOM Plan', 'Mini BOM Planned'],
  5: ['S5_WORelease_Planned', 'Work Order Release Planned', 'WO Release Planned', 'Work Order Planned', 'WO Planned', 'PO - Long Leads Planned', 'Long Lead PO Planned'],
  6: ['S6_SubSupplierPO_Planned', 'Sub-Supplier PO Planned', 'Sub Supplier PO Planned', 'PO Planned', 'Next Milestone Planned', 'Next Milestone Plan', 'Next Milestone Target', 'Next Milestone Target Date'],
  7: ['S7_MaterialReceipt_Planned', "Mat'l receipt Planned", 'Material Receipts Planned', 'Material Receipt Planned', 'Material Expected Date', 'S7_MaterialExpectedDate', 'GRN Planned'],
  // "Lead Time for Inhouse process" is a DURATION, not a date; binding it produced an
  // unparseable value that then silently dropped out, hiding the real problem.
  8: ['S8_Machining_Planned', 'Machining Planned', 'Machining Plan', 'Machining Target'],
  9: ['S9_Assembly_Planned', 'Assembly Planned', 'Assembly Plan', 'Assembly Target'],
  10: ['S10_FG_Planned', 'FG Planned', 'Finished Goods Planned', 'FG Target'],
  11: ['S11_Inspection_Planned', 'Customer Inspection Planned', 'Inspection Planned', 'Customer Inspection Target'],
  12: ['S12_Painting_Planned', 'Painting Planned', 'Painting Plan', 'Painting Target'],
  13: ['S13_TRN_Planned', 'TRN Planned', 'Test Report Notice Planned', 'TRN Target'],
  14: ['S14_Shipment_Planned', 'Packing & Dispatch Planned', 'Packing & Dispatch Plan', 'Packing / Shipping Planned', 'Packing / Shipping Plan', 'Shipment Planned', 'Dispatch Planned', 'Final Shipment Planned', 'Target Delivery Date', 'Promised Date', 'COTD', 'Customer Delivery Planned', 'Customer Delivery Target', 'Customer Delivery Date', 'Customer Delivery']
};

export const STAGE_DELAY_ALIASES: Record<number, string[]> = {
  1: ['S1_CustomerPO_Delay', 'Customer PO Delay'],
  2: ['S2_PMBaseline_Delay', 'PM Baseline Delay', 'Baseline Delay'],
  3: ['S3_CORB_Delay', 'Delay CORB Release', 'CORB Release Delay', 'CORB Delay', 'Clarification Delay after CORB', 'CORB Open Points Delay'],
  4: ['S4_BOMRelease_Delay', 'BOM Delay', 'Delay in BOM', 'BOM Release Delay'],
  5: ['S5_WORelease_Delay', 'Work Order Delay', 'WO Release Delay', 'WO Delay', 'Delay in Long lead PO', 'PO - Long Leads Delay', 'Long Lead PO Delay'],
  6: ['S6_SubSupplierPO_Delay', 'Sub-Supplier PO Delay', 'PO Delay', 'Delay in PO', 'Next Milestone Delay'],
  7: ['S7_MaterialReceipt_Delay', "Mat'l receipt delay", 'Material Receipts Delay', 'Material Receipt Delay', 'GRN Delay'],
  8: ['S8_Machining_Delay', 'Machining Delay', 'Delay in Machining'],
  9: ['S9_Assembly_Delay', 'Assembly Delay', 'Delay in Assembly'],
  10: ['S10_FG_Delay', 'FG Delay', 'Finished Goods Delay'],
  11: ['S11_Inspection_Delay', 'Customer Inspection Delay', 'Inspection Delay'],
  12: ['S12_Painting_Delay', 'Painting Delay'],
  13: ['S13_TRN_Delay', 'TRN Delay'],
  14: ['S14_Shipment_Delay', 'Packing & Dispatch Delay', 'Packing / Shipping Delay', 'Shipment Delay', 'Dispatch Delay']
};

// Headers that must never satisfy the stage's ACTUAL slot.
export const STAGE_ACTUAL_REJECTS: Record<number, string[]> = {
  1: ['planned', 'delay', 'target', 'forecast'],
  2: ['planned', 'delay', 'target', 'forecast'],
  3: ['planned', 'delay', 'target', 'forecast', 'clarification'],
  4: ['planned', 'delay', 'target', 'forecast'],
  5: ['mini-bom', 'minibom', 'planned', 'delay', 'target', 'forecast'],
  6: ['planned', 'delay', 'target', 'forecast', 'longlead', 'long-lead'],
  7: ['planned', 'delay', 'target', 'forecast', 'expected', 'leadtime'],
  8: ['planned', 'delay', 'target', 'forecast', 'leadtime', 'inhouse'],
  9: ['planned', 'delay', 'target', 'forecast', 'leadtime'],
  10: ['planned', 'delay', 'target', 'forecast', 'leadtime'],
  11: ['planned', 'delay', 'target', 'forecast', 'leadtime', 's7', 'material'],
  12: ['planned', 'delay', 'target', 'forecast', 'leadtime'],
  13: ['planned', 'delay', 'target', 'forecast', 'leadtime'],
  14: ['planned', 'delay', 'target', 'forecast', 'leadtime']
};

// Headers that must never satisfy the stage's PLANNED slot.
export const STAGE_PLANNED_REJECTS: Record<number, string[]> = {
  1: ['actual', 'delay', 'target', 'forecast'],
  2: ['actual', 'delay', 'forecast'],
  3: ['actual', 'delay', 'forecast', 'clarification'],
  4: ['actual', 'delay', 'forecast'],
  5: ['mini-bom', 'minibom', 'actual', 'delay', 'forecast'],
  6: ['actual', 'delay', 'forecast', 'longlead', 'long-lead'],
  7: ['actual', 'delay', 'forecast', 'leadtime'],
  8: ['actual', 'delay', 'forecast', 'leadtime', 'inhouse'],
  9: ['actual', 'delay', 'forecast', 'leadtime'],
  10: ['actual', 'delay', 'forecast', 'leadtime'],
  11: ['actual', 'delay', 'forecast', 'leadtime', 's7', 'material'],
  12: ['actual', 'delay', 'forecast', 'leadtime'],
  13: ['actual', 'delay', 'forecast', 'leadtime'],
  14: ['actual', 'delay', 'forecast', 'leadtime']
};

// Headers that must never satisfy the stage's DELAY slot.
export const STAGE_DELAY_REJECTS: Record<number, string[]> = {
  1: ['planned', 'actual'],
  2: ['planned', 'actual'],
  3: ['planned', 'actual', 'clarification'],
  4: ['mini-bom', 'minibom', 'planned', 'actual'],
  5: ['mini-bom', 'minibom', 'planned', 'actual'],
  6: ['planned', 'actual', 'longlead', 'long-lead'],
  7: ['planned', 'actual', 'leadtime'],
  8: ['planned', 'actual', 'leadtime', 'inhouse'],
  9: ['planned', 'actual', 'leadtime'],
  10: ['planned', 'actual', 'leadtime'],
  11: ['planned', 'actual', 'leadtime', 's7', 'material'],
  12: ['planned', 'actual', 'leadtime'],
  13: ['planned', 'actual', 'leadtime'],
  14: ['planned', 'actual', 'leadtime']
};

/**
 * Stages whose "planned" date is genuinely the same cell as the recorded date when
 * no separate planned column exists. Kept narrow: inferring planned == actual for
 * a stage the sheet never mentions would fabricate completion data.
 */
export const STAGE_PLANNED_FALLS_BACK_TO_ACTUAL = new Set<number>([1]);

export interface ImportPreviewRow {
  rowIndex: number;
  poNumber: string;
  customerName: string;
  lineNumber: string;
  productName: string;
  category: string;
  designType: DesignType;
  qty: number;
  bookedAmount?: number;
  customerPoDate: string;
  contractualDeliveryDate?: string;
  completedStagesCount: number;
  currentActiveStageName: string;
  status: string;
  errors: string[];
  warnings: string[];
}

export interface ImportPreviewResult {
  isValid: boolean;
  totalRows: number;
  totalPOs: number;
  totalProductLines: number;
  errors: string[];
  warnings: string[];
  /**
   * Neutral, non-blocking notes about defaults the importer applied (e.g. a missing
   * Quantity column defaulting to 1). Kept separate from `warnings` so callers that
   * treat warnings as anomalies keep their existing behaviour.
   */
  info?: string[];
  previewPOs: PurchaseOrder[];
  previewRows: ImportPreviewRow[];
}

/**
 * Normalizes loose date input formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD-Mon-YYYY)
 * into strict ISO calendar string 'YYYY-MM-DD'.
 *
 * `preferMonthFirst` disambiguates values where BOTH the first and second component are
 * <= 12 (e.g. "01/02/2026"). Default stays day-first to preserve existing behaviour;
 * the Excel reader passes `true` when every unambiguous slash date in the file is month-first.
 */
export function normalizeCsvDate(
  raw: string | undefined | null,
  preferMonthFirst: boolean = false
): string | undefined {
  if (!raw) return undefined;
  const str = raw.trim();
  if (!str) return undefined;

  // Ignore durations, counts, percentages, and non-date numbers (e.g. "5", "7", "14", "100%", "5 days", "1 pcs")
  if (/^\d{1,3}(%|\s*(days?|nos|pcs|weeks?))?$/i.test(str) || str.endsWith('%')) {
    return undefined;
  }
  // Ignore Incoterms / status words. These used to reach the OCR-style numeric branch
  // below and be silently converted into nonsense dates ("Ex Works" -> 1905-07-06).
  if (/^(shipped|unshipped|in assembly|pending material|pending|passed|failed|rejected|yes|no|in progress|completed|on time|delayed|approved|open|closed|cancelled|canceled|na|nil)$/i.test(str)) {
    return undefined;
  }
  if (/^(fob|cif|cfr|cpt|cip|dap|dpu|ddp|dat|exw|ex works|ex-works|free on board|cost and freight|freight|carriage paid|delivered duty paid|delivered at place|incoterms?)$/i.test(str)) {
    return undefined;
  }

  // Already standard ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return isValidDateString(str) ? str : undefined;
  }

  // ISO date-times (2026-08-10T00:00:00.000Z) — take the calendar date part.
  const isoDateTime = str.match(/^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/);
  if (isoDateTime) {
    return isValidDateString(isoDateTime[1]) ? isoDateTime[1] : undefined;
  }

  // YYYY/MM/DD or YYYY.MM.DD
  if (/^\d{4}[\/\.]\d{1,2}[\/\.]\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split(/[\/\.]/);
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return isValidDateString(iso) ? iso : undefined;
  }

  // DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, DD-Mon-YYYY
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    let [p1, p2, p3] = parts;

    // Support month names (e.g. 15-Aug-2026, 15-Aug-26)
    const monthNames: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    const p2Lower = p2.toLowerCase().slice(0, 3);
    if (monthNames[p2Lower]) {
      const month = monthNames[p2Lower];
      const day = parseInt(p1, 10);
      if (p3.length === 2 && /^\d{2}$/.test(p3)) p3 = `20${p3}`;
      if (p3.length === 4 && !isNaN(day) && day >= 1 && day <= 31) {
        const iso = `${p3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isValidDateString(iso)) return iso;
      }
    }

    if (p3.length === 2 && /^\d{2}$/.test(p3)) p3 = `20${p3}`;
    if (p3.length === 4 && /^\d{4}$/.test(p3)) {
      const num1 = parseInt(p1, 10);
      const num2 = parseInt(p2, 10);
      if (!isNaN(num1) && !isNaN(num2)) {
        let day = num1;
        let month = num2;

        if (num1 <= 12 && num2 > 12) {
          // MM/DD/YYYY
          month = num1;
          day = num2;
        } else if (num1 <= 12 && num2 <= 12) {
          // Genuinely ambiguous (01/02/2026). Honor the caller-supplied hint
          // (US spreadsheets write M/D/Y) instead of always assuming D/M/Y.
          if (preferMonthFirst) {
            month = num1;
            day = num2;
          }
        }

        const iso = `${p3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isValidDateString(iso)) return iso;
      }
    }
  }

  // Support Excel numeric serial dates (e.g. 46275 for dates in 2026).
  // 4-, 5- and 6-digit serials are all valid Excel dates (2026 alone spans 46023-46387);
  // the range guard below is what rejects ordinary counts, so it must not live in the regex.
  if (/^\d{4,6}$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial >= 20000 && serial <= 80000) {
      const utcDays = serial - 25569;
      const utcValue = utcDays * 86400 * 1000;
      const dateInfo = new Date(utcValue);
      if (!isNaN(dateInfo.getTime())) {
        return formatDate(dateInfo);
      }
    }
  }

  return undefined;
}

/**
 * Parses a quantity cell. Tolerates thousands separators, unit suffixes and
 * trailing decimals ("1,000" -> 1000, "2 pcs" -> 2, "12.0" -> 12).
 * Returns NaN when the cell holds no usable number so callers can report it.
 */
export function parseQuantityValue(raw: string | undefined | null): number {
  if (!raw) return NaN;
  let str = raw.trim();
  if (!str) return NaN;
  str = str.replace(/[,\s]/g, '');
  const match = str.match(/^([+-]?\d+(?:\.\d+)?)/);
  if (!match) return NaN;
  const n = Math.trunc(parseFloat(match[1]));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parses a money cell into a finite, non-negative number.
 * Handles currency symbols, thousands separators, accounting negatives and
 * scientific notation ("$1,234.56" -> 1234.56, "1e5" -> 100000).
 */
export function parseBookedAmount(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  let str = raw.trim();
  if (!str) return undefined;
  if (/^(n\/?a|nil|null|undefined|-|--|—)$/i.test(str)) return undefined;

  // Accounting negative notation: (1,234.00)
  const isParenNegative = /^\(.*\)$/.test(str);
  if (isParenNegative) str = str.slice(1, -1);

  // Strip currency codes/symbols and Indian/Western digit-group separators.
  str = str.replace(/[^0-9eE+\-.]/g, '');
  if (!str || /^[eE.]+$/.test(str)) return undefined;

  const negative = isParenNegative || /^-/.test(str);
  str = str.replace(/-/g, '');

  const n = parseFloat(str);
  if (!Number.isFinite(n)) return undefined;
  const signed = negative ? -n : n;
  return signed >= 0 ? signed : undefined;
}

/**
 * Parses numeric delay values from CSV/Excel cells (e.g. "0", "5", "+3", "-2", "4 days", "2d").
 */
export function parseNumericDelay(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const str = raw.trim();
  if (!str) return undefined;
  if (str === '-' || str === 'N/A' || str === 'NA' || str === 'null' || str === 'undefined') return undefined;
  if (str === '0' || str === '0d' || str === '0 days' || str === '0 day') return 0;
  const match = str.match(/^([+-]?\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Maps a free-text shipment/order status onto the highest stage index that should be
 * treated as completed. Shared by the preview table and the order builder so both
 * always agree on where an imported order actually stands.
 *
 * Matching is word-boundary based and negation-aware: "Not shipped" must not mark an
 * order complete, and "non-operational" must not match "operational".
 *
 * @param current       highest completed stage index found from explicit dates (-1 = none)
 * @param rawStatus     the status text from the spreadsheet
 * @param maxIndex      index of the final stage for this milestone list
 */
export function applyStatusBridge(
  current: number,
  rawStatus: string | undefined | null,
  maxIndex: number
): number {
  const text = (rawStatus || '').toLowerCase().trim();
  if (!text) return current;

  // Negated states ("not shipped", "unshipped", "not yet dispatched") describe work that
  // has NOT happened, so they must never advance the stage.
  const isNegated = /\b(not|non|un|no|awaiting|pending\s+for)\b/.test(text) && !/\bpending\s+material\b/.test(text);
  const advance = (index: number) => (isNegated ? current : Math.max(current, index));

  const has = (pattern: RegExp) => pattern.test(text);

  if (has(/\b(shipped|shipping|delivered|dispatched|dispatch\s+complete)\b/)) {
    // Shipment-specific terminal states are authoritative; a bare "Completed"
    // value is ambiguous and must not fill blank milestone modules.
    return isNegated ? current : maxIndex;
  }
  if (has(/\bpacking\b|\bpacked\b/)) return advance(12);       // Stage 14 active
  if (has(/\btrn\b|\btest\s+report\b/)) return advance(11);    // Stage 13 active
  if (has(/\bpainting\b|\bpainted\b/)) return advance(10);      // Stage 12 active
  if (has(/\binspection\b|\binspected\b/)) return advance(9);   // Stage 11 active
  if (has(/\bassembly\b|\bassembling\b/)) return advance(7);    // stages 0..7 done
  if (has(/\bmachining\b|\bmachined\b/)) return advance(6);     // stages 0..6 done
  if (has(/\b(pending|awaiting)\s+material\b/)) return Math.max(current, 5);
  return current;
}

/**
 * Resolves default root-cause attribution category based on milestone stage key.
 */
export function getDelayCategoryForMilestone(key: string): 'Customer' | 'Supplier' | 'Production' {
  if (key === 'sub_supplier_po' || key === 'material_receipt') {
    return 'Supplier';
  }
  if (key === 'po_from_customer' || key === 'pm_baseline' || key === 'corb_release' || key === 'bom_release' || key === 'customer_inspection') {
    return 'Customer';
  }
  return 'Production';
}

/**
 * Parses raw CSV content adhering to RFC 4180 (handling quoted values, escaped commas, newlines).
 *
 * By default blank lines are dropped. Pass `{ keepBlankRows: true }` to keep them as
 * empty arrays so that a row's index still equals its spreadsheet row number — this is
 * what makes "Row #12" in an error message point at Excel row 12.
 */
export function parseCsvToMatrix(
  csvText: string,
  options: { keepBlankRows?: boolean } = {}
): string[][] {
  const { keepBlankRows = false } = options;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (currentVal.length === 0 && !inQuotes) {
        // Opening quote at start of cell
        inQuotes = true;
      } else if (inQuotes && nextChar === '"') {
        // Escaped double quote ("") inside quoted cell
        currentVal += '"';
        i++;
      } else if (inQuotes) {
        // Closing quote
        inQuotes = false;
      } else {
        // Loose literal quote inside cell text (e.g. 4" valve)
        currentVal += '"';
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n in CRLF
      }
      currentRow.push(currentVal.trim());
      currentVal = '';
      if (keepBlankRows) {
        rows.push(currentRow);
      } else if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentVal += char;
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (keepBlankRows) {
      rows.push(currentRow);
    } else if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  // A trailing newline produces one final empty row; it carries no data either way.
  if (keepBlankRows && rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.every(cell => cell.length === 0)) rows.pop();
  }

  return rows;
}

/**
 * Escapes a cell value strictly according to CSV RFC 4180 rules.
 */
function escapeCsvCell(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Generates the official template CSV content with exact, high-value columns and realistic examples.
 */
export function generateCsvTemplate(): string {
  const headers = [
    'PO Number',
    'Customer Name',
    'Customer PO Ref',
    'Customer PO Date',
    'Booked Amount',
    'Contractual Delivery Date',
    'Product Name',
    'Design Type',
    'Quantity',
    'S1_CustomerPO_Actual',
    'S2_PMBaseline_Actual',
    'S3_CORB_Actual',
    'S4_BOMRelease_Actual',
    'S5_WORelease_Actual',
    'S6_SubSupplierPO_Actual',
    'S7_MaterialOrderDate',
    'S7_MaterialExpectedDate',
    'S7_MaterialReceipt_Actual',
    'S7_InspectionResult',
    'S8_Machining_Actual',
    'S9_Assembly_Actual',
    'S10_FG_Actual',
    'S11_Inspection_Actual',
    'S12_Painting_Actual',
    'S13_TRN_Actual',
    'S14_Shipment_Actual'
  ];

  const sampleRows = [
    // Multi-line in-flight Existing Design order (active at Stage 8 - Machining, 42-day standard flow)
    [
      'PO-2026-801',
      'Saudi Aramco',
      'ARAMCO-PO-9901',
      '2026-09-10',
      '150000',
      '2026-11-20',
      'CFT-HV-100 Gate Valve 2 inch 600#',
      'Existing Design',
      '4',
      '2026-09-10',
      '2026-09-13',
      '2026-09-15',
      '2026-09-19',
      '2026-09-21',
      '2026-09-24',
      '2026-09-24',
      '2026-10-08',
      '2026-10-06',
      'Passed',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    [
      'PO-2026-801',
      'Saudi Aramco',
      'ARAMCO-PO-9901',
      '2026-09-10',
      '150000',
      '2026-11-20',
      'CFT-HV-200 Gate Valve 3 inch 900#',
      'Existing Design',
      '2',
      '2026-09-10',
      '2026-09-13',
      '2026-09-15',
      '2026-09-19',
      '2026-09-21',
      '2026-09-24',
      '2026-09-24',
      '2026-10-08',
      '2026-10-06',
      'Passed',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    // New Design custom engineered order (active at Stage 3 - CORB Release, 90-day baseline flow)
    [
      'PO-2026-802',
      'ExxonMobil Upstream',
      'EXXON-PROJ-442',
      '2026-09-28',
      '250000',
      '2027-01-15',
      'Custom Engineered 4 inch Class 1500 Subsea Choke Valve',
      'New Design',
      '6',
      '2026-09-28',
      '2026-10-05',
      '',
      '',
      '',
      '',
      '2026-10-05',
      '2026-11-04',
      '',
      'Pending',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ],
    // Completed order with all 14 stages recorded (shipped recently)
    [
      'PO-2026-803',
      'Shell LNG Global',
      'SHELL-2026-019',
      '2026-08-01',
      '95000',
      '2026-10-15',
      'CFT-EMF-100 Electromagnetic Flowmeter DN50',
      'Existing Design',
      '8',
      '2026-08-01',
      '2026-08-04',
      '2026-08-06',
      '2026-08-10',
      '2026-08-12',
      '2026-08-15',
      '2026-08-15',
      '2026-08-29',
      '2026-08-30',
      'Passed',
      '2026-09-15',
      '2026-09-20',
      '2026-09-23',
      '2026-09-26',
      '2026-09-29',
      '2026-10-02',
      '2026-10-06'
    ]
  ];

  const lines = [
    headers.join(','),
    ...sampleRows.map(row => row.map(v => escapeCsvCell(v)).join(','))
  ];

  return lines.join('\r\n');
}

/**
 * Triggers a browser download of the sample CSV template.
 */
export function downloadCsvTemplate(): void {
  const content = generateCsvTemplate();
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'Circor_Bulk_Orders_Template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Converts an Excel workbook into CSV text while preserving physical spreadsheet
 * row numbers, and normalizing text-that-looks-like-a-date into ISO.
 *
 * `XLSX.utils.sheet_to_csv(..., { blankrows: false })` silently removes empty rows,
 * which shifts every subsequent row and makes error messages point at the wrong
 * spreadsheet row. Here blank rows become empty CSV lines instead, so parser row
 * numbers remain faithful to Excel.
 *
 * The workbook is typed loosely so this module keeps no runtime dependency on the
 * xlsx package; the caller passes an already-parsed workbook.
 */
export function workbookToCsv(
  workbook: { SheetNames: string[]; Sheets: Record<string, any>; Workbook?: any },
  sheetName?: string
): string {
  const name = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  if (!sheet || !sheet['!ref']) return '';

  const range = XLSX.utils.decode_range(sheet['!ref'] as string);
  const lines: string[] = [];

  // Emit every row in the range, including blank ones, so that a row's index in the
  // resulting CSV still equals its spreadsheet row number. Error messages such as
  // "Row #12: Invalid Customer PO Date" then point at the row the user must fix.
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] as any;
      cells.push(escapeCsvCell(cellToCsvText(cell)));
    }
    lines.push(cells.join(','));
  }

  // Trim trailing blank lines only; interior blank rows are meaningful.
  while (lines.length > 0 && lines[lines.length - 1].replace(/,/g, '').trim() === '') lines.pop();

  return lines.join('\r\n');
}

/**
 * Formats a single worksheet cell as CSV text.
 *
 * Date cells are emitted as strict YYYY-MM-DD regardless of how the spreadsheet
 * displays them, so "10/08/2026" cannot be re-interpreted later by heuristics.
 * Crucially, this is driven by the cell's actual type/format — never by guessing
 * from the text — because a plain amount such as 75000 is also a valid Excel
 * serial number and must not be turned into a date.
 */
function cellToCsvText(cell: any): string {
  if (!cell) return '';
  if (cell.t === 'd') {
    const value = cell.v instanceof Date ? cell.v : new Date(cell.v);
    if (!Number.isNaN(value.getTime())) return formatDate(value);
  }
  if (cell.t === 'n' && typeof cell.v === 'number' && isDateFormat(cell.z)) {
    const utcValue = (cell.v - 25569) * 86400 * 1000;
    const asDate = new Date(utcValue);
    if (!Number.isNaN(asDate.getTime())) return formatDate(asDate);
  }
  if (cell.w !== undefined && cell.w !== null) return String(cell.w).trim();
  return cell.v === undefined || cell.v === null ? '' : String(cell.v).trim();
}

/**
 * True when a cell's number format renders as a date (e.g. "dd/mm/yyyy", "d-mmm-yy").
 * Number/currency/percentage formats return false so their values stay numeric.
 */
export function isDateFormat(format: string | number | undefined | null): boolean {
  if (format === undefined || format === null) return false;
  if (typeof format === 'number') {
    // Built-in Excel date format ids.
    return (format >= 14 && format <= 22) || (format >= 45 && format <= 47);
  }
  const cleaned = String(format)
    .replace(/"[^"]*"/g, '')      // literal text sections
    .replace(/\[[^\]]*\]/g, '');   // colour/condition sections
  if (/^general$/i.test(cleaned.trim())) return false;
  // A genuine date format needs a day, a year, or a month NAME; a lone "m" is the
  // millions placeholder in currency formats and must not count.
  return /(y+|d+|mmm+)/i.test(cleaned);
}

/**
 * Splits tab-separated text (what a spreadsheet produces when you paste a range)
 * into a matrix. Commas, if present, are handled by the normal CSV path instead.
 */
export function parsePastedTable(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.split('\t').map(cell => cell.trim()))
    .filter(cells => cells.some(cell => cell.length > 0));
}

/** True when pasted text is tab-structured rather than comma-structured. */
export function isTabSeparated(text: string): boolean {
  if (!text || text.includes(',')) return false;
  return text.includes('\t');
}

/**
 * Header column aliases dictionary for forgiving and user-friendly imports.
 */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Recognises spreadsheet column labels. Used to tell a genuine 2-tier header block
 * apart from a data row, so a customer or product called "Scope" cannot be mistaken
 * for a header row and shift every subsequent row out of alignment.
 */
const HEADER_LABEL_PATTERN = /^(project\s*(no|number)|po\s*(no|number|date|ref)|order\s*(no|date)|customer|client|scope|product|description|item|qty|quantity|nos|price|value|amount|booked|delivery|cotd|promised|planned|actual|delay|status|remarks?|date|design|category|incoterm|corb|bom|machining|assembly|painting|trn|fg|inspection|dispatch|shipment|material)/i;

/**
 * Computes a strictly chronological, contiguous baseline schedule respecting all explicit planned dates from Excel
 * while smoothly interpolating unrecorded intermediate stages based on their standard durations.
 */
export function computeAlignedBaselineDates(
  poStartDate: string,
  targetDeliveryDate: string | undefined,
  milestoneKeys: string[],
  explicitPlannedEnds: (string | undefined)[],
  standardDurations: number[]
): { start: string; end: string; duration: number }[] {
  const n = milestoneKeys.length;
  const result: { start: string; end: string; duration: number }[] = [];

  // 1. Establish known anchor points
  const anchors: (string | undefined)[] = [...explicitPlannedEnds];

  // Stage 0 always anchors at poStartDate
  if (!anchors[0]) {
    anchors[0] = poStartDate;
  }

  // Final stage anchors at targetDeliveryDate if not explicitly provided in Excel
  if (!anchors[n - 1] && targetDeliveryDate) {
    anchors[n - 1] = targetDeliveryDate;
  }

  // 2. Identify all fixed anchor indices
  const fixedIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (anchors[i]) {
      fixedIndices.push(i);
    }
  }

  // Ensure chronological order of anchors (if an entered date is inverted, clamp forward)
  for (let k = 1; k < fixedIndices.length; k++) {
    const prevIdx = fixedIndices[k - 1];
    const currIdx = fixedIndices[k];
    const prevDate = anchors[prevIdx]!;
    const currDate = anchors[currIdx]!;
    const minDays = currIdx - prevIdx;
    if (getDaysDifference(prevDate, currDate) < minDays) {
      anchors[currIdx] = addDays(prevDate, minDays);
    }
  }

  // 3. Interpolate planned end dates for intermediate milestones between each pair of fixed anchors
  const plannedEnds: string[] = new Array(n);
  for (let k = 0; k < fixedIndices.length; k++) {
    plannedEnds[fixedIndices[k]] = anchors[fixedIndices[k]]!;
  }

  for (let k = 0; k < fixedIndices.length - 1; k++) {
    const idxA = fixedIndices[k];
    const idxB = fixedIndices[k + 1];
    const dateA = plannedEnds[idxA];
    const dateB = plannedEnds[idxB];
    const count = idxB - idxA;

    if (count > 1) {
      // There are intermediate milestones between idxA and idxB
      const totalSpanDays = Math.max(count, getDaysDifference(dateA, dateB));
      const subDurations = standardDurations.slice(idxA + 1, idxB + 1);
      const totalStdDays = subDurations.reduce((sum, d) => sum + d, 0) || 1;

      let allocatedDays = 0;
      for (let step = 1; step < count; step++) {
        const currIdx = idxA + step;
        const stdD = standardDurations[currIdx] || 1;
        const remainingSteps = count - step;
        const remainingSpan = totalSpanDays - allocatedDays;
        const targetShare = Math.round((stdD / totalStdDays) * totalSpanDays);
        const daysForThis = Math.max(1, Math.min(targetShare, remainingSpan - remainingSteps));
        allocatedDays += daysForThis;
        plannedEnds[currIdx] = addDays(dateA, allocatedDays);
      }
    }
  }

  // 4. Construct strictly contiguous start and end dates
  let prevEnd = poStartDate;
  for (let i = 0; i < n; i++) {
    const end = plannedEnds[i];
    let start: string;
    if (i === 0) {
      start = poStartDate;
    } else {
      start = addDays(prevEnd, 1);
      if (start > end) {
        start = end;
      }
    }
    const duration = Math.max(1, getDaysDifference(start, end) + 1);
    result.push({ start, end, duration });
    prevEnd = end;
  }

  return result;
}

/**
 * Fills only the omitted stages that are bounded by two explicit Excel actual
 * dates. Dates are allocated by the configured stage durations, so a longer
 * stage receives a proportionally larger share of the elapsed interval.
 */
export function inferMissingActualDates(
  milestoneKeys: string[],
  explicitActualDates: (string | undefined)[],
  completedThroughIndex: number,
  standardDurations: number[]
): Record<string, string> {
  const resolved: (string | undefined)[] = [...explicitActualDates];
  const explicitIndices = explicitActualDates
    .map((date, index) => date ? index : -1)
    .filter(index => index >= 0);

  for (let anchor = 0; anchor < explicitIndices.length - 1; anchor++) {
    const previousIndex = explicitIndices[anchor];
    const nextIndex = explicitIndices[anchor + 1];
    if (nextIndex > completedThroughIndex || nextIndex - previousIndex < 2) continue;

    const previousDate = resolved[previousIndex]!;
    const nextDate = resolved[nextIndex]!;
    const spanDays = Math.max(nextIndex - previousIndex, getDaysDifference(previousDate, nextDate));
    const weights = standardDurations.slice(previousIndex + 1, nextIndex + 1)
      .map(duration => Math.max(1, duration || 1));
    const totalWeight = weights.reduce((sum, duration) => sum + duration, 0);
    let previousAllocated = 0;

    for (let index = previousIndex + 1; index < nextIndex; index++) {
      const weightThroughStage = weights
        .slice(0, index - previousIndex)
        .reduce((sum, duration) => sum + duration, 0);
      const remainingStages = nextIndex - index;
      const proportionalOffset = Math.round((weightThroughStage / totalWeight) * spanDays);
      const allocated = Math.max(
        previousAllocated + 1,
        Math.min(proportionalOffset, spanDays - remainingStages)
      );
      resolved[index] = addDays(previousDate, allocated);
      previousAllocated = allocated;
    }
  }

  return resolved.reduce<Record<string, string>>((dates, date, index) => {
    if (date) dates[milestoneKeys[index]] = date;
    return dates;
  }, {});
}

/**
 * Resolves a product line's catalog item.
 *
 * Exact code/name matches are preferred. Fuzzy matching is allowed but requires the
 * shorter string to be long enough to be meaningful, so a one-word scope like "Valve"
 * cannot silently inherit an unrelated product's materials and lead times.
 */
export function findCatalogItem(
  products: ProductMasterItem[],
  productName: string
): ProductMasterItem | undefined {
  const target = (productName || '').trim().toLowerCase();
  if (!target) return undefined;

  const exact = products.find(p =>
    (p.productCode || '').trim().toLowerCase() === target ||
    (p.productName || '').trim().toLowerCase() === target
  );
  if (exact) return exact;

  // Fuzzy: only when the shorter side carries at least 8 characters of signal.
  const MIN_FUZZY_LENGTH = 8;
  let best: ProductMasterItem | undefined;
  let bestScore = 0;
  for (const product of products) {
    const name = (product.productName || '').trim().toLowerCase();
    const code = (product.productCode || '').trim().toLowerCase();
    for (const candidate of [name, code]) {
      if (!candidate) continue;
      const shorter = Math.min(candidate.length, target.length);
      if (shorter < MIN_FUZZY_LENGTH) continue;
      if (!candidate.includes(target) && !target.includes(candidate)) continue;
      const score = shorter / Math.max(candidate.length, target.length);
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }
  }
  return best;
}

/**
 * Main parser and validator function for CSV imports.
 */
export function parseAndValidateCsv(
  csvContent: string,
  existingPOs: PurchaseOrder[],
  templates: CategoryTemplate[],
  products: ProductMasterItem[],
  activeRole: string = 'Project Management'
): ImportPreviewResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const todayStr = todayLocal();

  if (!csvContent || !csvContent.trim()) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: ['The uploaded CSV file is empty. Please provide valid spreadsheet data.'],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  // Keep blank rows so matrix indices stay aligned with real spreadsheet row numbers.
  const matrix = parseCsvToMatrix(csvContent, { keepBlankRows: true });
  if (matrix.length < 2) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: ['The CSV must contain a header row and at least one data row.'],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  let startDataRow = 1;
  let rawHeaders = matrix[0];

  // Two-tier (merged) headers are only possible when the first two rows BOTH look like
  // headers. Checking row 2 alone used to mis-fire on ordinary files whose first data row
  // happened to contain a word like "Scope" or "COTD" (e.g. a customer named "Scope Ltd").
  const looksLikeHeaderRow = (cells: string[]): boolean => {
    const nonEmpty = cells.filter(c => c.trim().length > 0);
    if (nonEmpty.length === 0) return false;
    // A header row is mostly recognisable labels and never holds a bare date or a number.
    const dateOrNumber = nonEmpty.filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.trim()) || /^[0-9.,$%-]+$/.test(c.trim()));
    const knownLabel = nonEmpty.filter(c => HEADER_LABEL_PATTERN.test(c.trim()));
    return dateOrNumber.length === 0 && knownLabel.length >= Math.max(2, Math.ceil(nonEmpty.length * 0.3));
  };

  // A merged/grouped header block is necessarily SPARSE (only the group labels are filled),
  // while a real data row is dense. The strong markers alone identify the known tracker
  // layout; otherwise both rows must look like headers and row 1 must be sparser.
  const hasTrackerBlockMarker = matrix[0].some(c => /Mini-BOM|PO - Long Leads|Change Requests|Material Receipts/i.test(c.trim()));
  const is2TierHeader = matrix.length >= 3
    && looksLikeHeaderRow(matrix[1])
    && (
      hasTrackerBlockMarker ||
      (looksLikeHeaderRow(matrix[0]) &&
        matrix[0].filter(c => c.trim().length > 0).length < matrix[1].filter(c => c.trim().length > 0).length)
    );

  if (is2TierHeader) {
    startDataRow = 2;
    let currentCategory = '';
    rawHeaders = matrix[1].map((subHeader, colIdx) => {
      const parentHeader = matrix[0][colIdx]?.trim() || '';
      if (parentHeader) {
        currentCategory = parentHeader;
      }
      const cleanSub = subHeader?.trim() || '';
      if (currentCategory && ['Planned', 'Actual', 'Delay'].includes(cleanSub)) {
        return `${currentCategory} ${cleanSub}`.trim();
      }
      return cleanSub || currentCategory;
    });
  }

  // Verify that there are data rows beyond the headers
  const actualDataRows = matrix.slice(startDataRow).filter(r => r.some(c => c.trim().length > 0));
  if (actualDataRows.length === 0) {
    return {
      isValid: false,
      totalRows: 0,
      totalPOs: 0,
      totalProductLines: 0,
      errors: [
        is2TierHeader
          ? 'No order rows found. The uploaded spreadsheet contains valid headers (Rows 1 & 2), but has no order rows filled in below Row 2. Please enter your order data (PO NO, Customer Name, Scope, PO Date, Promised Date) starting from Row 3 and re-upload.'
          : 'The CSV must contain a header row and at least one data row.'
      ],
      warnings: [],
      previewPOs: [],
      previewRows: []
    };
  }

  // Headers are indexed per normalized name. Duplicates are kept as a list rather than
  // overwriting, because "split" tracker sheets repeat labels like "Planned"/"Delay".
  const headerIndex: Record<string, number[]> = {};
  rawHeaders.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    if (!norm) return;
    (headerIndex[norm] ||= []).push(idx);
  });

  const getColIdx = (possibleNames: string[]): number => {
    for (const name of possibleNames) {
      const norm = normalizeHeader(name);
      const hits = headerIndex[norm];
      if (hits !== undefined && hits.length > 0) return hits[0];
    }
    return -1;
  };

  // Header Indices
  const poNumIdx = getColIdx(['PO Number', 'PONumber', 'po_number', 'PO_No', 'PO NO', 'Project No', 'Project Number', 'Order No', 'Order Number']);
  const custNameIdx = getColIdx(['Customer Name', 'Customer', 'Client Name', 'Client']);
  // "PO NO" is deliberately NOT an alias here: it is the PO-number column on every
  // tracker layout, and aliasing it made customerPoRef echo the PO number back.
  const poRefIdx = getColIdx(['Customer PO Ref', 'PO Reference', 'Customer Ref', 'PO Ref', 'Customer PO Number', 'Customer Order No']);
  const poDateIdx = getColIdx(['Customer PO Date', 'PO Date', 'Order Date', 'Date']);
  const delDateIdx = getColIdx(['Contractual Delivery Date', 'Delivery Date', 'Target Delivery Date', 'Promised Date', 'COTD']);
  const bookedAmtIdx = getColIdx([
    'Booked Amount', 'BookedAmount', 'Booked_Amount', 'Booked Amt', 'BookedAmt',
    'Booked Amount ($)', 'Booked Amount (USD)', 'Booked Amount (INR)', 'Booked Amount (Rs)',
    'Booked Value', 'Order Value', 'PO Value', 'Contract Value', 'PO Amount',
    'Total Amount', 'Amount', 'Value', 'Price'
  ]);
  const prodNameIdx = getColIdx(['Product Name', 'Product', 'Product Line', 'Scope', 'Item Description', 'Description', 'Valve Type']);
  const categoryIdx = getColIdx(['Category', 'Product Category']);
  const designTypeIdx = getColIdx(['Design Type', 'Design']);
  const qtyIdx = getColIdx(['Quantity', 'Qty', 'Quantity (Nos)', 'Nos']);
  const statusIdx = getColIdx([
    'Shippment status', 'Shipment status', 'Shipment Status', 'Shippment Status',
    'Order Status', 'OrderStatus', 'PO Status', 'Status', 'Current Status', 'Stage Status', 'State'
  ]);

  // Stage 7 Raw Material Specific Column Indices
  const matOrderDateIdx = getColIdx(['S7_MaterialOrderDate', 'S7_MaterialOrderedDate', 'S7_MaterialOrder_Actual', 'Material Order Date', 'Material Ordered Date', 'S7_OrderDate']);
  const matExpectedDateIdx = getColIdx(['S7_MaterialExpectedDate', 'S7_MaterialExpected_Actual', 'Material Expected Date', 'Material Delivery Date', 'S7_ExpectedDate']);
  const matInspectionIdx = getColIdx(['S7_InspectionResult', 'Inspection Result', 'Incoming Inspection', 'S7_Inspection']);
  const remarksIdx = getColIdx(['Remarks', 'Remark', 'Delay Reason', 'Notes', 'Work Notes', 'Comments', 'delay_reason']);

  // Columns already claimed by a non-stage field, so a fuzzy stage alias can never
  // steal them (e.g. Stage 6's short "PO Date" alias must not capture the PO Date column).
  const reservedCols = new Set<number>();
  [poNumIdx, custNameIdx, poRefIdx, poDateIdx, delDateIdx, bookedAmtIdx, prodNameIdx,
   categoryIdx, designTypeIdx, qtyIdx, statusIdx, matOrderDateIdx, matExpectedDateIdx,
   matInspectionIdx, remarksIdx].forEach(idx => { if (idx >= 0) reservedCols.add(idx); });

  /**
   * Resolves a stage column by candidate alias, in priority order.
   *
   * Priority tiers (highest first):
   *   1. Explicit canonical headers (S4_BOMRelease_Actual, stage_4_actual, ...)
   *   2. Stage-specific aliases that carry the stage name
   *   3. Anonymous combined headers produced by the 2-tier merge ("BOM Actual")
   *
   * Within a tier, `requireAll` tokens must ALL appear in the normalized header, and
   * `rejectAny` tokens must NOT appear. This is what stops "Mini-BOM Actual" from
   * being mistaken for the real BOM stage: the Mini-BOM block has no stage qualifier
   * but is explicitly excluded from the BOM slot.
   */
  const resolveStageCol = (
    candidates: string[],
    opts: { reject?: string[]; allowReserved?: boolean } = {}
  ): number => {
    const reject = (opts.reject || []).map(normalizeHeader).filter(Boolean);
    for (const candidate of candidates) {
      const norm = normalizeHeader(candidate);
      if (!norm) continue;
      const hits = headerIndex[norm];
      if (!hits) continue;
      for (const idx of hits) {
        if (!opts.allowReserved && reservedCols.has(idx)) continue;
        const normalizedFull = normalizeHeader(rawHeaders[idx] || '');
        if (reject.some(r => normalizedFull.includes(r))) continue;
        return idx;
      }
    }
    return -1;
  };

  // Milestone columns: resolve the three slot kinds per stage in one pass so that a
  // column can never be claimed by two different slots.
  const claimedStageCols = new Set<number>();
  const claim = (idx: number): number => {
    if (idx < 0 || claimedStageCols.has(idx)) return -1;
    claimedStageCols.add(idx);
    return idx;
  };

  const stageColIndices = STANDARD_STAGES_IMPORT_MAP.map(s => {
    const n = s.stage;
    const actualAliases = STAGE_ACTUAL_ALIASES[n] || [];
    const plannedAliases = STAGE_PLANNED_ALIASES[n] || [];
    const delayAliases = STAGE_DELAY_ALIASES[n] || [];

    // --- 1. ACTUAL -----------------------------------------------------------
    // Canonical, unambiguous names first; then tracker aliases. Mini-BOM is never a
    // valid source for the real BOM stage, and combined headers are only trusted
    // when they name this stage.
    const actualCanonical = resolveStageCol([
      s.colHeader,
      `Stage_${n}_Actual`,
      `Stage${n}_Actual`,
      `S${n}_Actual`,
      `S${n}`,
      s.key,
      s.name
    ]);
    const actualAlias = actualCanonical < 0
      ? resolveStageCol(actualAliases, { reject: STAGE_ACTUAL_REJECTS[n] })
      : -1;
    const actualColIdx = claim(actualCanonical >= 0 ? actualCanonical : actualAlias);

    // --- 2. PLANNED ----------------------------------------------------------
    const plannedCanonical = resolveStageCol([
      `S${n}_Planned`,
      `Stage_${n}_Planned`,
      `Stage${n}_Planned`,
      `Stage_${n}_Target`,
      `Stage${n}_Target`,
      `${s.key}_planned`
    ]);
    let plannedColIdx: number;
    if (plannedCanonical >= 0) {
      plannedColIdx = claim(plannedCanonical);
    } else {
      // A combined "X Planned" header is authoritative; otherwise fall back to the
      // actual column for stages whose planned date is simply the recorded date.
      plannedColIdx = claim(resolveStageCol(plannedAliases, { reject: STAGE_PLANNED_REJECTS[n] }));
      if (plannedColIdx < 0 && STAGE_PLANNED_FALLS_BACK_TO_ACTUAL.has(n)) {
        plannedColIdx = actualColIdx;
      }
    }

    // --- 3. DELAY ------------------------------------------------------------
    const delayColIdx = claim(resolveStageCol(
      [`S${n}_Delay`, `Stage_${n}_Delay`, `Stage${n}_Delay`, `${s.key}_delay`, ...delayAliases],
      { reject: STAGE_DELAY_REJECTS[n] }
    ));

    return {
      stage: s.stage,
      key: s.key,
      name: s.name,
      colIdx: actualColIdx,
      actualColIdx,
      plannedColIdx,
      delayColIdx,
      defaultDays: s.defaultDays
    };
  });

  if (poNumIdx === -1) errors.push('Missing required column header: "PO Number" (or "PO NO" / "Project No")');
  if (custNameIdx === -1) errors.push('Missing required column header: "Customer Name"');
  if (poDateIdx === -1) errors.push('Missing required column header: "Customer PO Date" (or "PO Date")');
  if (delDateIdx === -1) errors.push('Missing required column header: "Contractual Delivery Date" (or "Promised Date" / "COTD")');
  if (prodNameIdx === -1) errors.push('Missing required column header: "Product Name" (or "Scope")');

  // Optional columns that silently fall back to a default. Reported once per import so
  // the user knows what the engine assumed, without turning a valid file into a warning.
  if (qtyIdx === -1) {
    info.push('No "Quantity" column found — every product line was imported with Quantity 1. Add the column to import real quantities.');
  }
  if (designTypeIdx === -1) {
    info.push('No "Design Type" column found — every product line was imported as "Existing Design". Add the column to import engineered (New Design) lines.');
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      totalRows: matrix.length - 1,
      totalPOs: 0,
      totalProductLines: 0,
      errors,
      warnings,
      info,
      previewPOs: [],
      previewRows: []
    };
  }

  // Intermediate Raw Data Structure grouped by PO Number
  interface RawLineItem {
    rowIndex: number;
    tagNumber: string;
    productName: string;
    category: string;
    qty: number;
    designType: DesignType;
    stageActualDates: Record<string, string>; // stageKey -> YYYY-MM-DD
    stagePlannedDates: Record<string, string>; // stageKey -> YYYY-MM-DD
    stageDelays: Record<string, number>; // stageKey -> delay in days
    matOrderDate?: string;
    matExpectedDate?: string;
    matReceivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    remarks?: string;
    orderStatus?: string;
    errors: string[];
    warnings: string[];
  }

  interface RawPOGroup {
    poNumber: string;
    customerName: string;
    customerPoRef: string;
    poDate: string;
    bookedAmount?: number;
    deliveryDate?: string;
    lines: RawLineItem[];
    /** True once a line-level amount has been applied to the group total. */
    amountFromLine?: boolean;
  }

  // Pre-index existing POs and catalog items for O(1) performance with 500+ orders
  const existingPoSet = new Set(existingPOs.map(p => p.poNumber.trim().toLowerCase()));
  const warnedExistingPos = new Set<string>();

  const poGroups: Map<string, RawPOGroup> = new Map();
  const previewRows: ImportPreviewRow[] = [];

  for (let r = startDataRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (row.length === 0 || row.every(c => !c.trim())) continue;

    const rowNum = r + 1;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    // Rows can be shorter than the header (trailing empty cells are omitted by many
    // exporters). Reading past the end must yield '' rather than throwing a TypeError
    // that aborts the whole import with a generic alert.
    const cellAt = (idx: number): string => (idx >= 0 && idx < row.length && row[idx] != null ? String(row[idx]) : '');

    const poNumber = cellAt(poNumIdx).trim();
    const customerName = cellAt(custNameIdx).trim();
    const customerPoRef = cellAt(poRefIdx).trim();
    const rawPoDate = cellAt(poDateIdx);
    const poDate = normalizeCsvDate(rawPoDate);
    const rawBookedAmt = cellAt(bookedAmtIdx).trim();
    const parsedBookedAmt = parseBookedAmount(rawBookedAmt);
    const rawProdName = cellAt(prodNameIdx).trim();
    const productName = rawProdName;
    const rawCategory = cellAt(categoryIdx).trim();
    const category = rawCategory || 'High-Pressure Control Valves';
    const rawQty = cellAt(qtyIdx);
    const parsedQty = parseQuantityValue(rawQty);
    const qty = (!rawQty || isNaN(parsedQty) || parsedQty < 1) ? 1 : parsedQty;
    const rawDesign = cellAt(designTypeIdx).trim();
    const designType: DesignType = /new/i.test(rawDesign) ? 'New Design' : 'Existing Design';
    const rawDelDate = cellAt(delDateIdx);
    const deliveryDate = normalizeCsvDate(rawDelDate);

    // Stage 7 Procurement Columns (Only 3 Dates + Inspection Result)
    const rawMatOrderDate = cellAt(matOrderDateIdx).trim();
    const matOrderDate = normalizeCsvDate(rawMatOrderDate);
    const rawMatExpectedDate = cellAt(matExpectedDateIdx).trim();
    const matExpectedDate = normalizeCsvDate(rawMatExpectedDate);
    const rawInspection = cellAt(matInspectionIdx).trim();
    // Unrecognised text must NOT be treated as a passed quality gate.
    const parsedInspection: 'Passed' | 'Rejected' | 'Pending' =
      /^pass/i.test(rawInspection) ? 'Passed' :
      /^rej/i.test(rawInspection) ? 'Rejected' :
      'Pending';

    const rawRemarks = cellAt(remarksIdx).trim();
    const rawStatus = cellAt(statusIdx).trim();

    if (!poNumber) {
      rowErrors.push(`Row #${rowNum}: Missing PO Number.`);
    }

    if (!customerName) {
      rowErrors.push(`Row #${rowNum}: Missing Customer Name.`);
    }

    if (!rawPoDate) {
      rowErrors.push(`Row #${rowNum}: Missing Customer PO Date.`);
    } else if (!poDate) {
      rowErrors.push(`Row #${rowNum}: Invalid Customer PO Date "${rawPoDate}". Expected valid date (e.g. YYYY-MM-DD or DD/MM/YYYY).`);
    }

    if (!rawDelDate || !rawDelDate.trim()) {
      rowErrors.push(`Row #${rowNum}: Missing Contractual Delivery Date.`);
    } else if (!deliveryDate) {
      rowErrors.push(`Row #${rowNum}: Invalid Contractual Delivery Date "${rawDelDate}". Expected valid date (e.g. YYYY-MM-DD or DD/MM/YYYY).`);
    } else if (poDate && deliveryDate < poDate) {
      rowErrors.push(`Row #${rowNum}: Contractual Delivery Date (${deliveryDate}) cannot be earlier than Customer PO Date (${poDate}).`);
    }

    if (!rawProdName) {
      rowErrors.push(`Row #${rowNum}: Missing Product Name.`);
    }

    if (rawQty && (isNaN(parsedQty) || parsedQty < 1)) {
      rowErrors.push(`Row #${rowNum}: Invalid Quantity "${rawQty}". Must be a positive integer.`);
    }

    // A present-but-unreadable amount is a real data problem worth flagging; an absent
    // column is a documented default and is reported once via `info` instead.
    if (rawBookedAmt && parsedBookedAmt === undefined) {
      rowWarnings.push(`Row #${rowNum}: Booked Amount "${rawBookedAmt}" could not be read as a number and was left blank.`);
    }
    if (rawDesign && !/new|existing/i.test(rawDesign)) {
      rowWarnings.push(`Row #${rowNum}: Design Type "${rawDesign}" not recognised — defaulted to "Existing Design".`);
    }

    // Check if PO exists in current database (O(1) fast lookup)
    const poAlreadyExists = existingPoSet.has(poNumber.toLowerCase());
    if (poAlreadyExists) {
      // One notice per PO — a five-line PO used to emit the identical warning five times.
      if (!warnedExistingPos.has(poNumber.toLowerCase())) {
        warnedExistingPos.add(poNumber.toLowerCase());
        rowWarnings.push(`PO "${poNumber}" already exists in the system. Importing will create an updated entry with generated suffix.`);
      }
    }

    // Parse milestone actual dates, planned dates, and explicit delay values
    const stageActualDates: Record<string, string> = {};
    const stagePlannedDates: Record<string, string> = {};
    const stageDelays: Record<string, number> = {};
    let completedCount = 0;
    let lastActualDate: string | undefined = poDate || todayStr;

    stageColIndices.forEach(stageDef => {
      // 1. Parse milestone actual date
      if (stageDef.actualColIdx !== -1 && row[stageDef.actualColIdx]) {
        const rawDate = row[stageDef.actualColIdx].trim();
        if (rawDate && rawDate !== '0' && rawDate !== '-' && rawDate !== 'N/A' && rawDate !== 'NA' && rawDate !== 'null' && rawDate !== 'undefined') {
          const parsed = normalizeCsvDate(rawDate);
          if (parsed) {
            // Check chronological sanity
            if (lastActualDate && parsed < lastActualDate && stageDef.stage !== 5) {
              rowWarnings.push(`Row #${rowNum}: ${stageDef.name} actual date (${parsed}) is earlier than previous milestone date (${lastActualDate}).`);
            }
            stageActualDates[stageDef.key] = parsed;
            completedCount++;
            lastActualDate = parsed;
          } else if (rawDate.length > 3 && !/^\d+$/.test(rawDate) && !/^(shipped|in assembly|pending|passed|failed|rejected|yes|no|fob|cif)$/i.test(rawDate)) {
            rowWarnings.push(`Row #${rowNum}: Unrecognized date format for ${stageDef.name}: "${rawDate}".`);
          }
        }
      }

      // 2. Parse milestone planned date
      if (stageDef.plannedColIdx !== -1 && row[stageDef.plannedColIdx]) {
        const rawPlanned = row[stageDef.plannedColIdx].trim();
        if (rawPlanned && rawPlanned !== '0' && rawPlanned !== '-' && rawPlanned !== 'N/A' && rawPlanned !== 'NA' && rawPlanned !== 'null' && rawPlanned !== 'undefined') {
          const parsed = normalizeCsvDate(rawPlanned);
          if (parsed) {
            stagePlannedDates[stageDef.key] = parsed;
          }
        }
      }

      // 3. Parse explicit milestone delay value (in days)
      if (stageDef.delayColIdx !== -1 && row[stageDef.delayColIdx]) {
        const rawDelay = row[stageDef.delayColIdx].trim();
        const parsedDelay = parseNumericDelay(rawDelay);
        if (parsedDelay !== undefined) {
          stageDelays[stageDef.key] = parsedDelay;
        }
      }
    });

    // Ensure Stage 1 always has actual date = poDate if not explicitly given
    if (!stageActualDates['po_from_customer'] && poDate) {
      stageActualDates['po_from_customer'] = poDate;
    }
    // Ensure Stage 1 planned date defaults to poDate if not explicitly given
    if (!stagePlannedDates['po_from_customer'] && poDate) {
      stagePlannedDates['po_from_customer'] = poDate;
    }

    // Determine highest completed stage index and calculate accurate bridged completion count & active stage
    let maxCompletedIndex = -1;
    stageColIndices.forEach((sDef, idx) => {
      if (stageActualDates[sDef.key]) {
        maxCompletedIndex = idx;
      }
    });

    // Explicit status text can advance the active stage past the last dated milestone.
    maxCompletedIndex = applyStatusBridge(maxCompletedIndex, rawStatus, STANDARD_STAGES_IMPORT_MAP.length - 1);

    const effectiveCompletedCount = maxCompletedIndex >= 0 ? maxCompletedIndex + 1 : (poDate ? 1 : 0);

    let currentActiveStageName = '1. Customer Purchase Order (PO)';
    if (effectiveCompletedCount === 14) {
      currentActiveStageName = '14. Final Shipment & Dispatch (Completed)';
    } else if (maxCompletedIndex >= 0 && maxCompletedIndex < 13) {
      currentActiveStageName = STANDARD_STAGES_IMPORT_MAP[maxCompletedIndex + 1].name;
    } else if (poDate) {
      currentActiveStageName = STANDARD_STAGES_IMPORT_MAP[1].name;
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    const previewRow: ImportPreviewRow = {
      rowIndex: rowNum,
      poNumber,
      customerName,
      // Must mirror the line number assigned when the PO group is materialised,
      // otherwise the preview table labels rows that never exist (e.g. LINE-03 on a
      // single-line PO). A PO's line ordinal is the count already queued for that PO.
      lineNumber: `LINE-${String((poGroups.get(poNumber.trim().toLowerCase())?.lines.length || 0) + 1).padStart(2, '0')}`,
      productName,
      category,
      designType,
      qty,
      bookedAmount: parsedBookedAmt,
      customerPoDate: poDate || rawPoDate,
      contractualDeliveryDate: deliveryDate,
      completedStagesCount: effectiveCompletedCount,
      currentActiveStageName,
      status: effectiveCompletedCount === 14 ? 'Completed' : (effectiveCompletedCount > 1 ? 'In Progress' : 'Baseline Pending'),
      errors: rowErrors,
      warnings: rowWarnings
    };
    previewRows.push(previewRow);

    if (poNumber && poDate) {
      const amountForRow = parsedBookedAmt !== undefined && !isNaN(parsedBookedAmt) ? parsedBookedAmt : undefined;
      const poNumberKey = poNumber.trim().toLowerCase();
      if (!poGroups.has(poNumberKey)) {
        // Group case-insensitively so "PO-7" and "po-7" are the same order, matching how
      // the persistence layer detects an existing PO.
      poGroups.set(poNumberKey, {
          poNumber,
          customerName,
          customerPoRef: customerPoRef || `PO-REF-${poNumber}`,
          poDate,
          bookedAmount: amountForRow,
          deliveryDate,
          lines: [],
          // Remember whether the amount came from a line-level value so repeated
          // values on later lines of the same PO are never double-counted.
          amountFromLine: amountForRow !== undefined
        });
      } else {
        const existingGroup = poGroups.get(poNumberKey)!;
        if (existingGroup.bookedAmount === undefined || isNaN(existingGroup.bookedAmount)) {
          if (amountForRow !== undefined) {
            existingGroup.bookedAmount = amountForRow;
            existingGroup.amountFromLine = true;
          }
        } else if (amountForRow !== undefined && amountForRow !== existingGroup.bookedAmount) {
          // A multi-line PO priced line-by-line: sum the distinct line amounts so the
          // order value is not silently truncated to whichever line came first.
          existingGroup.bookedAmount += amountForRow;
        }
        // Repeating the PO-level total on every line must not inflate the order value.
        if (existingGroup.customerName === '' && customerName) existingGroup.customerName = customerName;
        if (!existingGroup.customerPoRef || existingGroup.customerPoRef === `PO-REF-${poNumber}`) {
          if (customerPoRef) existingGroup.customerPoRef = customerPoRef;
        }
        if (!existingGroup.deliveryDate && deliveryDate) existingGroup.deliveryDate = deliveryDate;
      }
      poGroups.get(poNumberKey)!.lines.push({
        rowIndex: rowNum,
        tagNumber: `LINE-${String(poGroups.get(poNumberKey)!.lines.length + 1).padStart(2, '0')}`,
        productName,
        category,
        qty,
        designType,
        stageActualDates,
        stagePlannedDates,
        stageDelays,
        matOrderDate: matOrderDate || undefined,
        matExpectedDate: matExpectedDate || undefined,
        matReceivedDate: stageActualDates['material_receipt'] || undefined,
        inspectionResult: rawInspection ? parsedInspection : (stageActualDates['material_receipt'] ? 'Passed' : 'Pending'),
        remarks: rawRemarks || undefined,
        orderStatus: rawStatus || undefined,
        errors: rowErrors,
        warnings: rowWarnings
      });
    }
  }

  // Convert raw PO Groups into full typed PurchaseOrder[]
  const previewPOs: PurchaseOrder[] = [];

  poGroups.forEach(group => {
    // The map key is a normalized (lower-cased) lookup key; the display PO number must
    // keep the casing the user actually typed.
    const poNum = group.poNumber;
    const poId = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const effectivePoDate = group.poDate;

    const productLines: ProductLine[] = group.lines.map((rawLine, lineIdx) => {
      const lineId = `line-${poId}-${lineIdx + 1}`;
      const lineNum = `LINE-${String(lineIdx + 1).padStart(2, '0')}`;
      const designType = rawLine.designType;

      // Find matching catalog item. An unbounded substring match meant a scope of just
      // "Valve" resolved to whichever catalog entry sorted first and silently replaced
      // the line's material plan. Exact matches win; fuzzy matches require a meaningful
      // amount of shared text.
      const catalogItem = findCatalogItem(products, rawLine.productName);
      const tmpl = templates.find(t => t.categoryName.toLowerCase() === rawLine.category.toLowerCase() && t.designType === designType)
        || templates.find(t => t.designType === designType)
        || templates[0];

      // Build standard materials (or default critical-path material based on design type)
      let lineMaterials: MaterialItem[] = resolveLineMaterials({
        catalogItem,
        qty: rawLine.qty,
        lineId
      });

      const isNew = designType === 'New Design';
      const defaultLeadTime = isNew ? 30 : 14;

      const effectiveMatOrderDate = rawLine.matOrderDate || rawLine.stageActualDates['sub_supplier_po'] || rawLine.stageActualDates['wo_release'];
      const effectiveMatExpectedDate = rawLine.matExpectedDate || (effectiveMatOrderDate ? addDays(effectiveMatOrderDate, Math.max(0, defaultLeadTime - 1)) : undefined);
      const effectiveMatReceivedDate = rawLine.stageActualDates['material_receipt'] || rawLine.matReceivedDate;
      const effectiveInspectionResult = rawLine.inspectionResult || (effectiveMatReceivedDate ? 'Passed' : 'Pending');

      if (lineMaterials.length === 0) {
        lineMaterials = [
          {
            id: `mat-${lineId}-1`,
            itemCode: isNew ? 'MAT-RAW-FORGING-NEW' : 'MAT-RAW-CASTING-STD',
            description: isNew ? 'Custom High-Grade Forging / Cast Ingot' : 'Standard Valve Body Casting Material',
            qty: rawLine.qty || 1,
            unit: 'Pcs',
            supplierName: isNew ? 'Specialty Forgings Inc.' : 'Sandvik Precision Castings',
            leadTimeDays: defaultLeadTime,
            isCriticalPath: true,
            orderedDate: effectiveMatOrderDate,
            expectedDate: effectiveMatExpectedDate,
            receivedDate: effectiveMatReceivedDate,
            inspectionResult: effectiveInspectionResult
          }
        ];
      } else {
        lineMaterials = lineMaterials.map(m => ({
          ...m,
          orderedDate: m.orderedDate || effectiveMatOrderDate,
          expectedDate: m.expectedDate || effectiveMatExpectedDate || (effectiveMatOrderDate ? addDays(effectiveMatOrderDate, Math.max(0, (m.leadTimeDays || defaultLeadTime) - 1)) : undefined),
          receivedDate: m.receivedDate || (m.isCriticalPath ? effectiveMatReceivedDate : undefined),
          inspectionResult: m.inspectionResult || (effectiveMatReceivedDate ? 'Passed' : m.inspectionResult || 'Pending')
        }));
      }

      // Build baseline schedule starting at effectivePoDate aligned with contractual delivery date
      const baseMilestones = buildTemplateSchedule({
        template: tmpl,
        designType,
        materials: lineMaterials,
        startDate: effectivePoDate,
        lineId,
        targetEndDate: group.deliveryDate
      });

      // Extract explicit planned ends for all 14 stages from Excel (if provided)
      const explicitPlannedEnds = baseMilestones.map(m => rawLine.stagePlannedDates[m.key]);
      const milestoneKeys = baseMilestones.map(m => m.key);
      const standardDurations = baseMilestones.map(m => m.committedDurationDays || 1);

      // Compute strictly monotonic, gapless, valid baseline schedule respecting all Excel planned dates
      const alignedBaselines = computeAlignedBaselineDates(
        effectivePoDate,
        group.deliveryDate,
        milestoneKeys,
        explicitPlannedEnds,
        standardDurations
      );

      // Determine the highest milestone index that has an explicit actual completion date
      let maxCompletedIndex = -1;
      baseMilestones.forEach((m, idx) => {
        if (rawLine.stageActualDates[m.key]) {
          maxCompletedIndex = idx;
        }
      });

      // Same resolver as the preview table so the preview can never promise a stage
      // sequence that the imported order does not actually get.
      maxCompletedIndex = applyStatusBridge(maxCompletedIndex, rawLine.orderStatus, baseMilestones.length - 1);

      const inferredActualDates = inferMissingActualDates(
        milestoneKeys,
        baseMilestones.map(m => rawLine.stageActualDates[m.key]),
        maxCompletedIndex,
        standardDurations
      );

      // Apply historical completion dates, bridge omitted stages, and activate the real live stage
      let runningChainDate = effectivePoDate;
      let runningCumulativeDelay = 0;

      const configuredMilestones: Milestone[] = baseMilestones.map((m, mIdx) => {
        const explicitActualEnd = rawLine.stageActualDates[m.key];
        const actualEnd = inferredActualDates[m.key];
        const excelDelay = rawLine.stageDelays[m.key];
        const isCompleted = mIdx <= maxCompletedIndex;
        const isActiveStage = mIdx === maxCompletedIndex + 1;

        const alignedBase = alignedBaselines[mIdx];
        const explicitPlannedEnd = rawLine.stagePlannedDates[m.key];
        const effectivePlannedEnd = explicitPlannedEnd || alignedBase.end;
        const baselineStart = alignedBase.start > effectivePlannedEnd ? effectivePlannedEnd : alignedBase.start;
        const baselineDuration = Math.max(1, getDaysDifference(baselineStart, effectivePlannedEnd) + 1);

        // Calculate and preserve distinct revised target dates separate from actual entered dates
        const revisedTargetStart = addDays(baselineStart, runningCumulativeDelay);
        const revisedTargetEnd = addDays(effectivePlannedEnd, runningCumulativeDelay);

        let delayReason = m.delayReason;
        let delayCategory = m.delayCategory;
        let varianceDays = 0;

        if (actualEnd || isCompleted) {
          // Completed milestone (either explicitly dated in Excel or auto-bridged operational predecessor)
          const isExplicit = Boolean(explicitActualEnd);
          // Use explicit actual date from Excel when present; otherwise use inferred or planned date.
          const effectiveActualEnd = explicitActualEnd || actualEnd || effectivePlannedEnd;
          const actualStart = actualEnd
            ? ((m.key === 'material_receipt' && effectiveMatOrderDate)
              ? effectiveMatOrderDate
              : (runningChainDate <= effectiveActualEnd ? runningChainDate : effectiveActualEnd))
            : baselineStart;
          runningChainDate = effectiveActualEnd > runningChainDate ? effectiveActualEnd : runningChainDate;

          let calculatedDelay = 0;
          if (effectivePlannedEnd && effectiveActualEnd && effectiveActualEnd > effectivePlannedEnd) {
            calculatedDelay = getDaysDifference(effectivePlannedEnd, effectiveActualEnd);
          }
          // The milestone's variance against original baseline:
          // If the milestone ended on or after its revised timeline, its variance is at least runningCumulativeDelay
          // This ensures that completing as per the revised timeline never creates a false 'delay resolved'
          const effectiveDelay = Math.max(
            calculatedDelay,
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            effectiveActualEnd >= revisedTargetEnd ? runningCumulativeDelay : 0
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : `${m.name} delayed by +${effectiveDelay}d (Planned: ${effectivePlannedEnd}, Actual: ${effectiveActualEnd})`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          } else if (effectiveActualEnd < effectivePlannedEnd) {
            varianceDays = getDaysDifference(effectivePlannedEnd, effectiveActualEnd);
          }

          // Update running cumulative delay for downstream milestones
          runningCumulativeDelay = Math.max(0, varianceDays);

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
            committedDurationDays: baselineDuration,
            actualStartDate: actualStart,
            actualEndDate: effectiveActualEnd,
            forecastStartDate: actualStart,
            forecastEndDate: effectiveActualEnd || effectivePlannedEnd,
            status: 'Completed' as MilestoneStatus,
            completionPct: 100,
            varianceDays,
            delayReason,
            delayCategory,
            docRef: m.key === 'po_from_customer'
              ? 'PO-INTAKE'
              : (isExplicit ? 'LEGACY-IMPORT' : (actualEnd ? 'AUTO-INFERRED' : 'AUTO-BRIDGED'))
          };
        } else if (isActiveStage) {
          // Active milestone (ready to start or in-progress)
          const hasExplicitActualStart = Boolean(rawLine.stageActualDates[m.key]);
          const stageStart = (m.key === 'material_receipt' && effectiveMatOrderDate)
            ? effectiveMatOrderDate
            : (hasExplicitActualStart ? rawLine.stageActualDates[m.key] : (runningChainDate > revisedTargetStart ? runningChainDate : revisedTargetStart));
          const stageForecastEnd = (m.key === 'material_receipt' && effectiveMatExpectedDate)
            ? effectiveMatExpectedDate
            : addDays(stageStart, baselineDuration - 1);
          runningChainDate = addDays(stageForecastEnd, 1);

          const effectiveDelay = Math.max(
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            runningCumulativeDelay
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : `${m.name} delayed by +${effectiveDelay}d vs planned target (${effectivePlannedEnd})`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          }

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
            committedDurationDays: baselineDuration,
            actualStartDate: stageStart,
            actualEndDate: undefined,
            forecastStartDate: stageStart,
            forecastEndDate: stageForecastEnd,
            status: (effectiveDelay > 3 ? 'Delayed' : (effectiveDelay > 0 ? 'At Risk' : 'In Progress')) as MilestoneStatus,
            completionPct: 30,
            varianceDays,
            delayReason,
            delayCategory
          };
        } else {
          // Future pending stages: STRICTLY NO actualStartDate!
          const stageStart = runningChainDate > revisedTargetStart ? runningChainDate : revisedTargetStart;
          const stageForecastEnd = addDays(stageStart, baselineDuration - 1);
          runningChainDate = addDays(stageForecastEnd, 1);

          const effectiveDelay = Math.max(
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            runningCumulativeDelay
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : `${m.name} projected delay +${effectiveDelay}d`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          }

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
            committedDurationDays: baselineDuration,
            actualStartDate: undefined,
            actualEndDate: undefined,
            forecastStartDate: stageStart,
            forecastEndDate: stageForecastEnd,
            status: 'Not Started' as MilestoneStatus,
            completionPct: 0,
            varianceDays,
            delayReason,
            delayCategory
          };
        }
      });

      // Ensure lineMaterials critical-path expectedDate aligns with Stage 7's revised target date
      const s7Configured = configuredMilestones.find(m => m.key === 'material_receipt');
      if (s7Configured) {
        lineMaterials = lineMaterials.map(m => ({
          ...m,
          leadTimeDays: s7Configured.committedDurationDays || m.leadTimeDays,
          expectedDate: rawLine.matExpectedDate || s7Configured.currentBaselineEndDate || m.expectedDate
        }));
      }

      const rawProductLine: ProductLine = {
        id: lineId,
        lineNumber: lineNum,
        productName: rawLine.productName || 'Industrial Valve Line Item',
        category: rawLine.category || 'High-Pressure Control Valves',
        qty: rawLine.qty,
        designType,
        milestones: configuredMilestones,
        materials: lineMaterials,
        overallVarianceDays: 0,
        status: 'In Progress'
      };

      // Run calculation engine to normalize and recalculate all dates & variances
      const recalculated = recalculateProductLine(rawProductLine, todayStr);
      return {
        ...recalculated,
        materials: lineMaterials,
        milestones: recalculated.milestones.map((ms, idx) => ({
          ...ms,
          currentBaselineEndDate: configuredMilestones[idx]?.currentBaselineEndDate || ms.currentBaselineEndDate || ms.committedBaselineEndDate
        }))
      };
    });

    // Derive PO dates
    const calculatedDeliveryDate = getOrderDeliveryDate(productLines, effectivePoDate);
    const poDeliveryDate = group.deliveryDate && isValidDateString(group.deliveryDate)
      ? group.deliveryDate
      : calculatedDeliveryDate;
    // The final milestone forecast already includes the imported actual
    // sequence and any explicit delay. Adding maxLineVariance again shifts the
    // revised date twice and produced incorrect imported timelines.
    const finalRevisedDeliveryDate = productLines.reduce((latest, line) => {
      const finalMilestone = line.milestones[line.milestones.length - 1];
      const finalDate = finalMilestone?.actualEndDate
        || finalMilestone?.forecastEndDate
        || finalMilestone?.committedBaselineEndDate;
      return finalDate && finalDate > latest ? finalDate : latest;
    }, poDeliveryDate);

    // Determine PO Status:
    // If all lines are completed -> Completed
    // If Stage 2 (PM Baseline) is completed on all lines -> In Progress
    // Else -> Baseline Pending
    const allLinesCompleted = productLines.every(l => l.status === 'Completed');
    const pmBaselineCompleted = productLines.every(l => {
      const pmMs = l.milestones.find(m => m.key === 'pm_baseline');
      return pmMs && pmMs.status === 'Completed';
    });

    let poStatus: PurchaseOrder['status'] = 'Baseline Pending';
    if (allLinesCompleted) {
      poStatus = 'Completed';
    } else if (pmBaselineCompleted) {
      poStatus = 'In Progress';
    }

    let finalActualDeliveryDate: string | undefined = undefined;
    for (const l of productLines) {
      const shipMs = l.milestones.find(m => m.stageOrder === 14 || m.key === 'shipment');
      if (shipMs?.actualEndDate) {
        finalActualDeliveryDate = shipMs.actualEndDate;
        break;
      }
    }

    const newPO: PurchaseOrder = {
      id: poId,
      poNumber: poNum,
      customerName: group.customerName,
      customerPoRef: group.customerPoRef,
      poDate: effectivePoDate,
      startDate: effectivePoDate,
      bookedAmount: group.bookedAmount,
      contractReviewRef: `CR-IMP-${poNum}`,
      committedDeliveryDate: poDeliveryDate,
      revisedDeliveryDate: finalRevisedDeliveryDate,
      actualDeliveryDate: allLinesCompleted ? (finalActualDeliveryDate || poDeliveryDate) : finalActualDeliveryDate,
      status: poStatus,
      productLines,
      revisions: [
        {
          revNumber: 0,
          requestedBy: activeRole,
          approvedBy: activeRole,
          approvedAt: new Date().toISOString(),
          reason: 'Bulk Data Import with historical milestone completions.',
          docRef: `IMP-${poNum}`,
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

    previewPOs.push(newPO);
  });

  return {
    isValid: errors.length === 0 && previewPOs.length > 0,
    totalRows: previewRows.length,
    totalPOs: previewPOs.length,
    // Count the lines actually attached to the orders, not the preview rows: a row can
    // be shown in the preview yet excluded from the order (e.g. an unparseable PO date).
    totalProductLines: previewPOs.reduce((sum, po) => sum + po.productLines.length, 0),
    errors,
    warnings,
    info,
    previewPOs,
    previewRows
  };
}
