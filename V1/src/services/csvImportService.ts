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
  previewPOs: PurchaseOrder[];
  previewRows: ImportPreviewRow[];
}

/**
 * Normalizes loose date input formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD-Mon-YYYY)
 * into strict ISO calendar string 'YYYY-MM-DD'.
 */
export function normalizeCsvDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const str = raw.trim();
  if (!str) return undefined;

  // Ignore durations, counts, percentages, and non-date numbers (e.g. "5", "7", "14", "100%", "5 days", "1 pcs")
  if (/^\d{1,3}(%|\s*(days?|nos|pcs|weeks?))?$/i.test(str) || str.endsWith('%')) {
    return undefined;
  }
  // Ignore non-date text statuses
  if (/^(shipped|in assembly|pending material|pending|passed|failed|rejected|yes|no|fob|cif|ex works|ex-works|in progress|completed|on time|delayed)$/i.test(str)) {
    return undefined;
  }

  // Already standard ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return isValidDateString(str) ? str : undefined;
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
        }

        const iso = `${p3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isValidDateString(iso)) return iso;
      }
    }
  }

  // Support Excel numeric serial dates (e.g. 46275 for dates in 2026)
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial > 30000 && serial < 60000) {
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
 */
export function parseCsvToMatrix(csvText: string): string[][] {
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
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentVal += char;
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
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
 * Header column aliases dictionary for forgiving and user-friendly imports.
 */
function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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
 * Main parser and validator function for CSV imports.
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

export function parseAndValidateCsv(
  csvContent: string,
  existingPOs: PurchaseOrder[],
  templates: CategoryTemplate[],
  products: ProductMasterItem[],
  activeRole: string = 'Project Management'
): ImportPreviewResult {
  const errors: string[] = [];
  const warnings: string[] = [];
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

  const matrix = parseCsvToMatrix(csvContent);
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

  // Check if Row 1 & Row 2 form a 2-tier merged header (like Book2.xlsx tracker)
  const is2TierHeader = matrix.length >= 2 && (
    matrix[0].some(c => /Mini-BOM|PO - Long Leads|Change Requests|Material Receipts/i.test(c.trim())) ||
    (matrix[1] && matrix[1].some(c => /Project No|Scope|COTD|CORB Release Date/i.test(c.trim())))
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

  const headerMap: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    headerMap[normalizeHeader(h)] = idx;
  });

  const getColIdx = (possibleNames: string[]): number => {
    for (const name of possibleNames) {
      const norm = normalizeHeader(name);
      if (headerMap[norm] !== undefined) return headerMap[norm];
    }
    return -1;
  };

  // Header Indices
  const poNumIdx = getColIdx(['PO Number', 'PONumber', 'po_number', 'PO_No', 'PO NO', 'Project No', 'Project Number', 'Order No', 'Order Number']);
  const custNameIdx = getColIdx(['Customer Name', 'Customer', 'Client Name', 'Client']);
  const poRefIdx = getColIdx(['Customer PO Ref', 'PO Reference', 'Customer Ref', 'PO Ref', 'PO NO']);
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

  // Milestone Date Columns for all 14 Standard Stages (Actual, Planned, Delay)
  const stageColIndices = STANDARD_STAGES_IMPORT_MAP.map(s => {
    // 1. Actual date column detection (Strictly actual BOM data for Stage 4, excluding Mini-BOM)
    const exactCol = getColIdx([
      s.colHeader,
      `Stage_${s.stage}_Actual`,
      `Stage${s.stage}_Actual`,
      `S${s.stage}_Actual`,
      `S${s.stage}`,
      s.key,
      s.name,
      // Comprehensive 14-Stage Specific Aliases (in strict priority order)
      ...(s.stage === 1 ? ['Customer PO Date', 'Customer PO Intake', 'PO Intake', 'PO Date', 'Order Date', 'Date'] : []),
      ...(s.stage === 2 ? ['PM Baseline Actual', 'PM Baseline Date', 'PM Baseline', 'Baseline Review & Planning', 'Baseline Date', 'PM Baseline Schedule'] : []),
      ...(s.stage === 3 ? ['CORB Release Date', 'CORB Release Actual', 'CORB Release', 'CORB Open Points Closure', 'CORB Actual', 'CORB'] : []),
      // Stage 4: Strictly real BOM actual data — Mini-BOM is deliberately excluded so BOM milestone uses actual BOM data
      ...(s.stage === 4 ? ['BOM Release Actual', 'BOM Actual', 'BOM Release Date', 'BOM Release', 'BOM', 'Stage 4 Actual', 'Stage4 Actual', 'S4 Actual'] : []),
      ...(s.stage === 5 ? ['Work Order Release Actual', 'WO Release Actual', 'Work Order Release', 'WO Release Date', 'WO Release', 'Work Order', 'WO Actual', 'WO', 'PO - Long Leads Actual', 'Long Lead PO Actual', 'PO - Long Leads'] : []),
      ...(s.stage === 6 ? ['Sub-Supplier PO Actual', 'Sub Supplier PO Actual', 'Sub-Supplier PO Date', 'Sub Supplier PO Date', 'Sub-Supplier PO', 'Sub Supplier PO', 'PO Actual', 'PO Date', 'PO'] : []),
      ...(s.stage === 7 ? ['Material Receipts Actual', 'Material Receipt Actual', 'Material Receipt Date', 'Mat\'l receipt Actual', 'Material Receipt (GRN)', 'Material Receipt', 'Material Receipts', 'GRN Actual', 'GRN Date', 'GRN'] : []),
      ...(s.stage === 8 ? ['Machining Actual', 'Machining Date', 'Machining Complete', 'Machining'] : []),
      ...(s.stage === 9 ? ['Assembly Actual', 'Assembly Date', 'Assembly Complete', 'Assembly'] : []),
      ...(s.stage === 10 ? ['FG Actual', 'Finished Goods Actual', 'FG Date', 'Finished Goods', 'FG Complete', 'FG'] : []),
      ...(s.stage === 11 ? ['Customer Inspection Actual', 'Customer Inspection Date', 'Inspection Actual', 'Customer Inspection', 'Inspection Complete', 'Inspection'] : []),
      ...(s.stage === 12 ? ['Painting Actual', 'Painting Date', 'Painting Complete', 'Painting'] : []),
      ...(s.stage === 13 ? ['TRN Actual', 'TRN Date', 'Test Report Notice', 'TRN Complete', 'TRN'] : []),
      ...(s.stage === 14 ? ['Packing & Dispatch Actual', 'Packing & Dispatch Date', 'Packing / Shipping Actual', 'Final Shipment & Dispatch Actual', 'Shipment Actual', 'Dispatch Actual', 'Packing & Dispatch', 'Shipment Date', 'Dispatch Date'] : [])
    ]);

    // 2. Planned date column detection
    const plannedCol = getColIdx([
      `S${s.stage}_Planned`,
      `Stage_${s.stage}_Planned`,
      `Stage${s.stage}_Planned`,
      `Stage_${s.stage}_Target`,
      `Stage${s.stage}_Target`,
      `${s.key}_planned`,
      ...(s.stage === 1 ? ['S1_CustomerPO_Planned', 'Customer PO Planned', 'Customer PO Date', 'PO Date'] : []),
      ...(s.stage === 2 ? ['S2_PMBaseline_Planned', 'PM Baseline Planned', 'PM Baseline Target', 'Baseline Planned', 'PM Baseline Plan'] : []),
      ...(s.stage === 3 ? ['S3_CORB_Planned', 'CORB Release Planned', 'CORB Planned', 'CORB Plan', 'CORB Target'] : []),
      // Stage 4: Real BOM Planned date column
      ...(s.stage === 4 ? ['S4_BOMRelease_Planned', 'BOM Release Planned', 'BOM Planned', 'BOM Plan', 'BOM Target Date', 'BOM Target'] : []),
      ...(s.stage === 5 ? ['S5_WORelease_Planned', 'Work Order Release Planned', 'WO Release Planned', 'Work Order Planned', 'WO Planned', 'PO - Long Leads Planned', 'Long Lead PO Planned'] : []),
      ...(s.stage === 6 ? ['S6_SubSupplierPO_Planned', 'Sub-Supplier PO Planned', 'Sub Supplier PO Planned', 'PO Planned'] : []),
      ...(s.stage === 7 ? ['S7_MaterialReceipt_Planned', 'Material Receipts Planned', 'Material Receipt Planned', 'Mat\'l receipt Planned', 'Material Expected Date', 'S7_MaterialExpectedDate', 'GRN Planned'] : []),
      ...(s.stage === 8 ? ['S8_Machining_Planned', 'Machining Planned', 'Machining Plan', 'Machining Target', 'Lead Time  for Inhouse process', 'Lead Time for Inhouse process', 'Inhouse process'] : []),
      ...(s.stage === 9 ? ['S9_Assembly_Planned', 'Assembly Planned', 'Assembly Plan', 'Assembly Target'] : []),
      ...(s.stage === 10 ? ['S10_FG_Planned', 'FG Planned', 'Finished Goods Planned', 'FG Target'] : []),
      ...(s.stage === 11 ? ['S11_Inspection_Planned', 'Customer Inspection Planned', 'Inspection Planned', 'Customer Inspection Target'] : []),
      ...(s.stage === 12 ? ['S12_Painting_Planned', 'Painting Planned', 'Painting Plan', 'Painting Target'] : []),
      ...(s.stage === 13 ? ['S13_TRN_Planned', 'TRN Planned', 'Test Report Notice Planned', 'TRN Target'] : []),
      ...(s.stage === 14 ? ['S14_Shipment_Planned', 'Packing & Dispatch Planned', 'Packing & Dispatch Plan', 'Packing / Shipping Planned', 'Packing / Shipping Plan', 'Shipment Planned', 'Dispatch Planned', 'Final Shipment Planned', 'Target Delivery Date', 'Promised Date', 'COTD'] : [])
    ]);

    // 3. Explicit delay column detection (in days)
    const delayCol = getColIdx([
      `S${s.stage}_Delay`,
      `Stage_${s.stage}_Delay`,
      `Stage${s.stage}_Delay`,
      `${s.key}_delay`,
      ...(s.stage === 1 ? ['S1_CustomerPO_Delay', 'Customer PO Delay'] : []),
      ...(s.stage === 2 ? ['S2_PMBaseline_Delay', 'PM Baseline Delay', 'Baseline Delay'] : []),
      ...(s.stage === 3 ? ['S3_CORB_Delay', 'Delay CORB Release', 'CORB Release Delay', 'CORB Delay', 'Clarification Delay after CORB'] : []),
      ...(s.stage === 4 ? ['S4_BOMRelease_Delay', 'BOM Delay', 'Delay in BOM', 'BOM Release Delay'] : []),
      ...(s.stage === 5 ? ['S5_WORelease_Delay', 'Work Order Delay', 'WO Release Delay', 'WO Delay', 'Delay in Long lead PO', 'PO - Long Leads Delay', 'Long Lead PO Delay'] : []),
      ...(s.stage === 6 ? ['S6_SubSupplierPO_Delay', 'Sub-Supplier PO Delay', 'PO Delay', 'Delay in PO'] : []),
      ...(s.stage === 7 ? ['S7_MaterialReceipt_Delay', 'Mat\'l receipt delay', 'Material Receipts Delay', 'Material Receipt Delay', 'GRN Delay'] : []),
      ...(s.stage === 8 ? ['S8_Machining_Delay', 'Machining Delay', 'Delay in Machining'] : []),
      ...(s.stage === 9 ? ['S9_Assembly_Delay', 'Assembly Delay', 'Delay in Assembly'] : []),
      ...(s.stage === 10 ? ['S10_FG_Delay', 'FG Delay', 'Finished Goods Delay'] : []),
      ...(s.stage === 11 ? ['S11_Inspection_Delay', 'Customer Inspection Delay', 'Inspection Delay'] : []),
      ...(s.stage === 12 ? ['S12_Painting_Delay', 'Painting Delay'] : []),
      ...(s.stage === 13 ? ['S13_TRN_Delay', 'TRN Delay'] : []),
      ...(s.stage === 14 ? ['S14_Shipment_Delay', 'Packing & Dispatch Delay', 'Packing / Shipping Delay', 'Shipment Delay', 'Dispatch Delay'] : [])
    ]);

    return {
      stage: s.stage,
      key: s.key,
      name: s.name,
      colIdx: exactCol,
      actualColIdx: exactCol,
      plannedColIdx: plannedCol,
      delayColIdx: delayCol,
      defaultDays: s.defaultDays
    };
  });

  if (poNumIdx === -1) errors.push('Missing required column header: "PO Number" (or "PO NO" / "Project No")');
  if (custNameIdx === -1) errors.push('Missing required column header: "Customer Name"');
  if (poDateIdx === -1) errors.push('Missing required column header: "Customer PO Date" (or "PO Date")');
  if (delDateIdx === -1) errors.push('Missing required column header: "Contractual Delivery Date" (or "Promised Date" / "COTD")');
  if (prodNameIdx === -1) errors.push('Missing required column header: "Product Name" (or "Scope")');

  if (errors.length > 0) {
    return {
      isValid: false,
      totalRows: matrix.length - 1,
      totalPOs: 0,
      totalProductLines: 0,
      errors,
      warnings,
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
  }

  // Pre-index existing POs and catalog items for O(1) performance with 500+ orders
  const existingPoSet = new Set(existingPOs.map(p => p.poNumber.trim().toLowerCase()));

  const poGroups: Map<string, RawPOGroup> = new Map();
  const previewRows: ImportPreviewRow[] = [];

  for (let r = startDataRow; r < matrix.length; r++) {
    const row = matrix[r];
    if (row.length === 0 || row.every(c => !c.trim())) continue;

    const rowNum = r + 1;
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    const poNumber = (poNumIdx !== -1 ? row[poNumIdx] : '').trim();
    const customerName = (custNameIdx !== -1 ? row[custNameIdx] : '').trim();
    const customerPoRef = poRefIdx !== -1 ? row[poRefIdx]?.trim() : '';
    const rawPoDate = poDateIdx !== -1 ? row[poDateIdx] : '';
    const poDate = normalizeCsvDate(rawPoDate);
    const rawBookedAmt = bookedAmtIdx !== -1 ? row[bookedAmtIdx]?.trim() : '';
    let parsedBookedAmt: number | undefined = undefined;
    if (rawBookedAmt) {
      const sanitized = rawBookedAmt.replace(/[^0-9.-]+/g, '');
      const n = parseFloat(sanitized);
      if (!isNaN(n) && n >= 0) {
        parsedBookedAmt = n;
      }
    }
    const rawProdName = prodNameIdx !== -1 ? row[prodNameIdx]?.trim() : '';
    const productName = rawProdName;
    const rawCategory = categoryIdx !== -1 ? row[categoryIdx]?.trim() : '';
    const category = rawCategory || 'High-Pressure Control Valves';
    const rawQty = qtyIdx !== -1 ? row[qtyIdx] : '';
    const parsedQty = parseInt(rawQty, 10);
    const qty = (!rawQty || isNaN(parsedQty) || parsedQty < 1) ? 1 : parsedQty;
    const rawDesign = designTypeIdx !== -1 ? row[designTypeIdx]?.trim() : '';
    const designType: DesignType = /new/i.test(rawDesign) ? 'New Design' : 'Existing Design';
    const rawDelDate = delDateIdx !== -1 ? row[delDateIdx] : '';
    const deliveryDate = normalizeCsvDate(rawDelDate);

    // Stage 7 Procurement Columns (Only 3 Dates + Inspection Result)
    const rawMatOrderDate = matOrderDateIdx !== -1 ? row[matOrderDateIdx]?.trim() : '';
    const matOrderDate = normalizeCsvDate(rawMatOrderDate);
    const rawMatExpectedDate = matExpectedDateIdx !== -1 ? row[matExpectedDateIdx]?.trim() : '';
    const matExpectedDate = normalizeCsvDate(rawMatExpectedDate);
    const rawInspection = matInspectionIdx !== -1 ? row[matInspectionIdx]?.trim() : '';
    const parsedInspection: 'Passed' | 'Rejected' | 'Pending' =
      /^pass/i.test(rawInspection) ? 'Passed' :
      /^rej/i.test(rawInspection) ? 'Rejected' :
      /^pend/i.test(rawInspection) ? 'Pending' :
      'Passed';

    const rawRemarks = remarksIdx !== -1 ? row[remarksIdx]?.trim() : '';
    const rawStatus = statusIdx !== -1 ? row[statusIdx]?.trim() : '';

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

    // Check if PO exists in current database (O(1) fast lookup)
    const poAlreadyExists = existingPoSet.has(poNumber.toLowerCase());
    if (poAlreadyExists) {
      rowWarnings.push(`PO "${poNumber}" already exists in the system. Importing will create an updated entry with generated suffix.`);
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
            if (lastActualDate && parsed < lastActualDate) {
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

    // Check explicit status string for active operational alignment
    const statusNorm = rawStatus.toLowerCase();
    if (statusNorm.includes('shipped') || statusNorm.includes('delivered') || statusNorm.includes('dispatched')) {
      maxCompletedIndex = 13;
    } else if (statusNorm.includes('in assembly') || statusNorm.includes('assembly')) {
      maxCompletedIndex = Math.max(maxCompletedIndex, 7); // Stage 8 Machining completed/bridged into Assembly
    } else if (statusNorm.includes('pending material') || statusNorm.includes('awaiting material')) {
      maxCompletedIndex = Math.max(maxCompletedIndex, 5); // Stage 7 Material Receipt actively pending
    } else if (statusNorm.includes('in machining') || statusNorm.includes('machining')) {
      maxCompletedIndex = Math.max(maxCompletedIndex, 6); // Stage 8 Machining active
    }

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
      lineNumber: `LINE-${String(r).padStart(2, '0')}`,
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
      if (!poGroups.has(poNumber)) {
        poGroups.set(poNumber, {
          poNumber,
          customerName,
          customerPoRef: customerPoRef || `PO-REF-${poNumber}`,
          poDate,
          bookedAmount: parsedBookedAmt !== undefined && !isNaN(parsedBookedAmt) ? parsedBookedAmt : undefined,
          deliveryDate,
          lines: []
        });
      } else {
        const existingGroup = poGroups.get(poNumber)!;
        if ((existingGroup.bookedAmount === undefined || isNaN(existingGroup.bookedAmount)) && parsedBookedAmt !== undefined && !isNaN(parsedBookedAmt)) {
          existingGroup.bookedAmount = parsedBookedAmt;
        }
      }
      poGroups.get(poNumber)!.lines.push({
        rowIndex: rowNum,
        tagNumber: `LINE-${String(poGroups.get(poNumber)!.lines.length + 1).padStart(2, '0')}`,
        productName,
        category,
        qty,
        designType,
        stageActualDates,
        stagePlannedDates,
        stageDelays,
        matOrderDate: matOrderDate || undefined,
        matExpectedDate: matExpectedDate || stagePlannedDates['material_receipt'] || undefined,
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

  poGroups.forEach((group, poNum) => {
    const poId = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const effectivePoDate = group.poDate;

    const productLines: ProductLine[] = group.lines.map((rawLine, lineIdx) => {
      const lineId = `line-${poId}-${lineIdx + 1}`;
      const lineNum = `LINE-${String(lineIdx + 1).padStart(2, '0')}`;
      const designType = rawLine.designType;

      // Find matching catalog or category template
      const catalogItem = products.find(p => 
        p.productCode?.toLowerCase() === rawLine.productName.toLowerCase() ||
        p.productName.toLowerCase() === rawLine.productName.toLowerCase() ||
        p.productName.toLowerCase().includes(rawLine.productName.toLowerCase()) ||
        rawLine.productName.toLowerCase().includes(p.productName.toLowerCase())
      );
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

      // If an explicit operational status is provided in Excel, align maxCompletedIndex
      const orderStatusNorm = (rawLine.orderStatus || '').toLowerCase();
      if (orderStatusNorm.includes('shipped') || orderStatusNorm.includes('delivered') || orderStatusNorm.includes('dispatched')) {
        maxCompletedIndex = baseMilestones.length - 1;
      } else if (orderStatusNorm.includes('in assembly') || orderStatusNorm.includes('assembly')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 7); // stages 0..7 (up to Machining) completed/bridged
      } else if (orderStatusNorm.includes('pending material') || orderStatusNorm.includes('awaiting material')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 5); // stages 0..5 completed, Stage 7 active
      } else if (orderStatusNorm.includes('in machining') || orderStatusNorm.includes('machining')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 6); // stages 0..6 completed, Stage 8 active
      } else if (orderStatusNorm.includes('in inspection') || orderStatusNorm.includes('inspection')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 9); // Stage 11 active
      } else if (orderStatusNorm.includes('in painting') || orderStatusNorm.includes('painting')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 10); // Stage 12 active
      } else if (orderStatusNorm.includes('in trn') || orderStatusNorm.includes('trn')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 11); // Stage 13 active
      } else if (orderStatusNorm.includes('in packing') || orderStatusNorm.includes('packing')) {
        maxCompletedIndex = Math.max(maxCompletedIndex, 12); // Stage 14 active
      }

      const inferredActualDates = inferMissingActualDates(
        milestoneKeys,
        baseMilestones.map(m => rawLine.stageActualDates[m.key]),
        maxCompletedIndex,
        standardDurations
      );

      // Apply historical completion dates, bridge omitted stages, and activate the real live stage
      let runningChainDate = effectivePoDate;

      const configuredMilestones: Milestone[] = baseMilestones.map((m, mIdx) => {
        const explicitActualEnd = rawLine.stageActualDates[m.key];
        const actualEnd = inferredActualDates[m.key];
        const excelDelay = rawLine.stageDelays[m.key];
        const isCompleted = mIdx <= maxCompletedIndex;
        const isActiveStage = mIdx === maxCompletedIndex + 1;

        const alignedBase = alignedBaselines[mIdx];
        const baselineStart = alignedBase.start;
        const effectivePlannedEnd = alignedBase.end;
        const baselineDuration = alignedBase.duration;

        let delayReason = m.delayReason;
        let delayCategory = m.delayCategory;
        let varianceDays = 0;

        if (actualEnd || isCompleted) {
          // Completed milestone (either explicitly dated in Excel or auto-bridged operational predecessor)
          const isExplicit = Boolean(explicitActualEnd);
          // A missing historical date is not an actual event. Use the committed
          // baseline only to bridge the imported stage sequence; otherwise the
          // importer invents late completions and double-counts delay.
          const effectiveActualEnd = actualEnd || effectivePlannedEnd;
          const actualStart = actualEnd
            ? ((m.key === 'material_receipt' && effectiveMatOrderDate)
              ? effectiveMatOrderDate
              : (runningChainDate <= actualEnd ? runningChainDate : actualEnd))
            : baselineStart;
          runningChainDate = effectiveActualEnd || runningChainDate;

          let calculatedDelay = 0;
          if (isExplicit && effectivePlannedEnd && effectiveActualEnd && effectiveActualEnd > effectivePlannedEnd) {
            calculatedDelay = getDaysDifference(effectivePlannedEnd, effectiveActualEnd);
          }
          const effectiveDelay = Math.max(calculatedDelay, excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0);

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : `${m.name} delayed by +${effectiveDelay}d (Planned: ${effectivePlannedEnd}, Actual: ${effectiveActualEnd})`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          }

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
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
          // Active in-progress milestone
          const stageStart = (m.key === 'material_receipt' && effectiveMatOrderDate)
            ? effectiveMatOrderDate
            : runningChainDate;
          const stageForecastEnd = (m.key === 'material_receipt' && effectiveMatExpectedDate)
            ? effectiveMatExpectedDate
            : addDays(stageStart, baselineDuration - 1);
          runningChainDate = addDays(stageForecastEnd, 1);

          // A forecast for work that has not completed is not evidence of an
          // actual delay. Only an explicit spreadsheet delay or a late actual
          // completion may create imported variance; otherwise the schedule
          // remains a forecast and cannot grow into a delay on refresh.
          const effectiveDelay = excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0;

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
            committedDurationDays: baselineDuration,
            actualStartDate: stageStart,
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
          const stageStart = runningChainDate;
          const stageForecastEnd = addDays(stageStart, baselineDuration - 1);
          runningChainDate = addDays(stageForecastEnd, 1);

          // Do not mark a future, unstarted stage delayed merely because its
          // projected chain date is later than the baseline. Delay is recorded
          // when the stage has an explicit imported delay value or actual work
          // has completed late.
          const effectiveDelay = excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0;

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
      return recalculateProductLine(rawProductLine, todayStr);
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
    totalProductLines: previewRows.length,
    errors,
    warnings,
    previewPOs,
    previewRows
  };
}
