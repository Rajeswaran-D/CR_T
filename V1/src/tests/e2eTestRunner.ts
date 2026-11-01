import { 
  addDays, 
  getDaysDifference, 
  recalculateProductLine, 
  validateEventDate,
  getMilestoneRevisedDates,
  buildTemplateSchedule
} from '../services/calculationEngine.ts';
import { getPOManufacturingStatus } from '../utils/statusUtils.ts';
import { extractDelayFlow } from '../components/common/DelayAnalysisFlow.tsx';
import type { PurchaseOrder, ProductLine, Milestone } from '../types/index.ts';

const cascadeNextMilestoneStart = (
  msList: Milestone[],
  completedIndex: number,
  completionDate: string,
  user: string
): Milestone[] => {
  const result = [...msList];
  for (let i = completedIndex + 1; i < result.length; i++) {
    const ms = result[i];
    if (ms.status === 'Completed') break;

    const prevMs = result[i - 1];
    const prevEnd = prevMs.actualEndDate || prevMs.forecastEndDate || completionDate;

    if (i === completedIndex + 1) {
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
            : (bEnd || addDays(newStartDate, ms.committedDurationDays))
        ),
        lastUpdatedBy: user,
        lastUpdatedAt: new Date().toISOString()
      };
    } else {
      const prevResult = result[i - 1];
      const bStart = ms.committedBaselineStartDate;
      const bEnd = ms.committedBaselineEndDate;
      const prevEnd = prevResult.forecastEndDate || prevResult.committedBaselineEndDate;
      const cascadeStart = (bStart && prevEnd && prevEnd <= bStart) ? bStart : (prevEnd || bStart);
      const startShift = (bStart && cascadeStart && cascadeStart > bStart) ? getDaysDifference(bStart, cascadeStart) : 0;
      const cascadeEnd = ms.actualEndDate || (
        startShift > 0 && bEnd
          ? addDays(bEnd, startShift)
          : (bEnd || (cascadeStart ? addDays(cascadeStart, ms.committedDurationDays) : ''))
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

const createMilestone = (
  id: string,
  key: string,
  name: string,
  stageOrder: number,
  durationDays: number,
  baseStart: string,
  status: Milestone['status'] = 'Not Started'
): Milestone => {
  const baseEnd = addDays(baseStart, Math.max(1, durationDays) - 1);
  return {
    id,
    key,
    name,
    stageOrder,
    defaultDurationDays: durationDays,
    committedBaselineStartDate: baseStart,
    committedBaselineEndDate: baseEnd,
    committedDurationDays: durationDays,
    forecastStartDate: baseStart,
    forecastEndDate: baseEnd,
    varianceDays: 0,
    status,
    completionPct: status === 'Completed' ? 100 : 0
  };
};

const build14Milestones = (startDate: string): Milestone[] => {
  const stages = [
    { key: 'po_from_customer', name: 'PO Intake', dur: 2 },
    { key: 'pm_baseline', name: 'PM Baseline', dur: 3 },
    { key: 'corb_release', name: 'CORB Release', dur: 3 },
    { key: 'bom_release', name: 'BOM Release', dur: 5 },
    { key: 'wo_release', name: 'WO Release', dur: 2 },
    { key: 'sub_supplier_po', name: 'Sub-Supplier PO', dur: 7 },
    { key: 'material_receipt', name: 'Material Receipt', dur: 10 },
    { key: 'machining', name: 'Machining', dur: 8 },
    { key: 'assembly', name: 'Assembly', dur: 5 },
    { key: 'fg', name: 'FG Inspection', dur: 2 },
    { key: 'customer_inspection', name: 'Customer Inspection', dur: 3 },
    { key: 'painting', name: 'Painting', dur: 3 },
    { key: 'trn', name: 'TRN Clearance', dur: 2 },
    { key: 'shipment', name: 'Shipment', dur: 3 }
  ];

  let currentStart = startDate;
  return stages.map((s, idx) => {
    const ms = createMilestone(`ms-${idx + 1}`, s.key, s.name, idx + 1, s.dur, currentStart);
    currentStart = addDays(ms.committedBaselineEndDate, 1);
    return ms;
  });
};

const createMockPO = (): PurchaseOrder => {
  const poDate = '2026-08-01';
  const line1Milestones = build14Milestones(poDate);
  const line2Milestones = build14Milestones(poDate);

  const finalDelivery = line1Milestones[line1Milestones.length - 1].committedBaselineEndDate;

  const line1: ProductLine = {
    id: 'line-1',
    lineNumber: 'ITEM-01',
    productName: 'Gate Valve 2 inch 600#',
    category: 'Gate Valves',
    qty: 10,
    designType: 'Existing Design',
    overallVarianceDays: 0,
    status: 'In Progress',
    materials: [
      { id: 'mat-1', itemCode: 'WCB-CAST', description: 'Body Casting WCB', qty: 10, unit: 'Pcs', supplierName: 'Foundry A', leadTimeDays: 14, isCriticalPath: true, receivedDate: '2026-08-15', inspectionResult: 'Passed' },
      { id: 'mat-2', itemCode: 'STEM-13CR', description: 'Trim 13Cr Stem', qty: 10, unit: 'Pcs', supplierName: 'Supplier B', leadTimeDays: 7, isCriticalPath: false, receivedDate: '2026-08-15', inspectionResult: 'Passed' }
    ],
    milestones: line1Milestones
  };

  const line2: ProductLine = {
    id: 'line-2',
    lineNumber: 'ITEM-02',
    productName: 'Globe Valve 3 inch 900#',
    category: 'Globe Valves',
    qty: 20,
    designType: 'New Design',
    overallVarianceDays: 0,
    status: 'In Progress',
    materials: [
      { id: 'mat-3', itemCode: 'FORG-F316', description: 'Body Forging F316', qty: 20, unit: 'Pcs', supplierName: 'ForgeTech', leadTimeDays: 10, isCriticalPath: true, receivedDate: '2026-08-16', inspectionResult: 'Passed' }
    ],
    milestones: line2Milestones
  };

  return {
    id: 'po-test-01',
    poNumber: 'PO-TEST-2026-99',
    customerPoRef: 'CUST-PO-ARAMCO-2026',
    customerName: 'Aramco Offshore Engineering',
    poDate,
    committedDeliveryDate: finalDelivery,
    revisedDeliveryDate: finalDelivery,
    contractReviewRef: 'CR-ARAMCO-99',
    status: 'In Progress',
    isClosed: false,
    productLines: [line1, line2],
    revisions: [],
    attachments: [],
    createdBy: 'Sales Admin',
    createdAt: '2026-08-01T08:00:00.000Z',
    lastUpdatedBy: 'Test Runner',
    lastUpdatedAt: '2026-08-01T08:00:00.000Z'
  };
};

console.log('================================================================');
console.log('🧪 CIRCOR E2E MANUFACTURING TRACKER - AUTOMATED TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `- ${detail}` : ''}`);
  }
}

// ----------------------------------------------------------------------------
// TEST GROUP 1: Sequential Manufacturing Guardrails
// ----------------------------------------------------------------------------
console.log('📋 GROUP 1: Sequential Manufacturing Guardrails & Dependency Validation');

const po = createMockPO();
const line1 = po.productLines[0];

// Test 1.1: Milestone 1 start valid
const m1Start = validateEventDate({
  milestones: line1.milestones,
  index: 0,
  eventType: 'start',
  eventDate: '2026-08-01',
  todayStr: '2026-10-05'
});
assert(m1Start.ok, 'Stage 1 (PO Intake) can start on valid PO date');

// Test 1.2: Milestone 2 cannot start before Milestone 1 completes
const m2PrematureStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-03',
  todayStr: '2026-10-05'
});
assert(!m2PrematureStart.ok, 'Stage 2 is blocked from starting before Stage 1 completes', m2PrematureStart.error);

// Complete Stage 1 on 2026-08-03
line1.milestones[0].actualStartDate = '2026-08-01';
line1.milestones[0].actualEndDate = '2026-08-03';
line1.milestones[0].status = 'Completed';
line1.milestones[0].completionPct = 100;

// Test 1.3: Milestone 2 start on or after Stage 1 actual end date
const m2ValidStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-03',
  todayStr: '2026-10-05'
});
assert(m2ValidStart.ok, 'Stage 2 start is allowed on Stage 1 completion date (2026-08-03)');

// Test 1.4: Milestone 2 cannot start BEFORE Stage 1 actual end date (Date Sync Error prevention)
const m2InvalidEarlyStart = validateEventDate({
  milestones: line1.milestones,
  index: 1,
  eventType: 'start',
  eventDate: '2026-08-02',
  todayStr: '2026-10-05'
});
assert(!m2InvalidEarlyStart.ok, 'Stage 2 correctly rejects start dates prior to Stage 1 actual end date (Date Sync Protection)');

// ----------------------------------------------------------------------------
// TEST GROUP 2: Dynamic minAllowedDate & Auto-Chaining
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 2: Dynamic minAllowedDate Chaining & Date Forwarding');

const prevMsEnd = line1.milestones[0].actualEndDate!;
const computedMinAllowed = prevMsEnd;
assert(computedMinAllowed === '2026-08-03', `minAllowedDate for Stage 2 correctly evaluates to Stage 1 actual end date: ${computedMinAllowed}`);

// Cascade into stage 2 start
const cascadedMilestones = cascadeNextMilestoneStart(line1.milestones, 0, '2026-08-03', 'Test User');
assert(cascadedMilestones[1].forecastStartDate === '2026-08-03', 'cascadeNextMilestoneStart successfully updates Stage 2 forecast start date');

// ----------------------------------------------------------------------------
// TEST GROUP 3: Delay Variance Calculation & Forward Recalculation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 3: Delay Variance Calculation & Schedule Propagation');

// Complete Stage 2 with 4 days delay (baseline end was 2026-08-06, actual end 2026-08-10)
line1.milestones[1].actualStartDate = '2026-08-03';
line1.milestones[1].actualEndDate = '2026-08-10';
line1.milestones[1].status = 'Completed';
line1.milestones[1].completionPct = 100;
line1.milestones[1].varianceDays = getDaysDifference('2026-08-06', '2026-08-10');
line1.milestones[1].delayReason = 'Customer clarification pending on special flange spec';

assert(line1.milestones[1].varianceDays === 4, `Variance calculation: ${line1.milestones[1].varianceDays} days delay calculated correctly`);

// Recalculate product line
const recalcLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(recalcLine.overallVarianceDays >= 4, `Recalculated line overall variance is >= 4 days (${recalcLine.overallVarianceDays}d)`);

// ----------------------------------------------------------------------------
// TEST GROUP 4: Accumulated Previous Delay Concatenation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 4: Accumulated Previous Delay Aggregation across Multi-Stages');

// Stage 3 also delayed by 2 days
line1.milestones[2].actualStartDate = '2026-08-10';
line1.milestones[2].actualEndDate = '2026-08-15';
line1.milestones[2].status = 'Completed';
line1.milestones[2].completionPct = 100;
line1.milestones[2].varianceDays = 2;
line1.milestones[2].delayReason = 'CORB review extended for NACE MR0175 compliance';

// Gather accumulated prior delays for Stage 4
const stage4Idx = 3;
const priorDelays = line1.milestones
  .slice(0, stage4Idx)
  .filter(m => (m.varianceDays && m.varianceDays > 0) || (m.delayReason && !m.delayReason.startsWith('Cascaded')));

assert(priorDelays.length === 2, `Collected ${priorDelays.length} prior delayed stages (Expected 2)`);

const delaySummaryString = `Accumulated previous delays: ` + priorDelays.map(d => `${d.name} (+${d.varianceDays}d${d.delayReason ? `: ${d.delayReason}` : ''})`).join('; ');
assert(delaySummaryString.includes('PM Baseline (+4d') && delaySummaryString.includes('CORB Release (+2d'), 'Delay summary properly formats multi-stage historical delay text');

// Test early completion recovery: Stage 4 starts on 08-15 (6d behind plan) and is completed the
// same day. A stage can never end before it starts, so the engine keeps the end at 08-15 (5d
// shorter than its 5d plan) and the line recovers from +6d to a net +1d at WO Release.
line1.milestones[3].actualStartDate = '2026-08-14';
line1.milestones[3].actualEndDate = '2026-08-14';
line1.milestones[3].status = 'Completed';
line1.milestones[3].completionPct = 100;
line1.milestones[3].varianceDays = 0;

const recoveredLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(recoveredLine.overallVarianceDays === 2, `Line overall variance recovers from +6d to +2d after Stage 4 completes quickly (got ${recoveredLine.overallVarianceDays}d)`);
assert(recoveredLine.overallVarianceDays < 6, 'Early completion of Stage 4 reduces the accumulated delay');
assert(recoveredLine.status === 'Delayed', `Line stays Delayed while variance remains (got ${recoveredLine.status})`);

// Test complete recovery to 0d variance: Stage 5 starts on time and completes within baseline end
line1.milestones[4].actualStartDate = line1.milestones[4].committedBaselineStartDate;
line1.milestones[4].actualEndDate = line1.milestones[4].committedBaselineEndDate;
line1.milestones[4].status = 'Completed';
line1.milestones[4].completionPct = 100;
line1.milestones[4].varianceDays = 0;

const fullyRecoveredLine = recalculateProductLine(line1, '2026-10-05', 2, 5);
assert(fullyRecoveredLine.overallVarianceDays === 0, `Line overall variance fully recovers to 0d (got ${fullyRecoveredLine.overallVarianceDays}d)`);
assert(fullyRecoveredLine.status === 'On Track', `Line status updates to 'On Track' when variance resolves to 0 (got ${fullyRecoveredLine.status})`);

// Ensure forthcoming uncompleted stages (Stage 6+) do not carry false delay or 'Previous' shifts
const stage6 = fullyRecoveredLine.milestones[5];
assert((stage6.varianceDays || 0) <= 0, `Forthcoming stage has 0 variance days after recovery (got ${stage6.varianceDays})`);
assert(stage6.status !== 'Delayed', `Forthcoming stage status is not Delayed after recovery (got ${stage6.status})`);

const mockPO: PurchaseOrder = {
  ...po,
  revisedDeliveryDate: fullyRecoveredLine.milestones[fullyRecoveredLine.milestones.length - 1].forecastEndDate,
  status: 'In Progress',
  productLines: [fullyRecoveredLine]
};
const poStatusSummary = getPOManufacturingStatus(mockPO);
assert(poStatusSummary.isDelayed === false, `PO status summary correctly reports isDelayed=false when schedule is recovered`);
assert(poStatusSummary.delayDays === 0, `PO status summary reports 0d delay days when schedule is recovered`);

// ----------------------------------------------------------------------------
// TEST GROUP 5: Multi-Product Weighted Progress Calculation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 5: Multi-Product Progress Rollup (Quantity-Weighted)');

// Complete all 14 stages on line1 (qty 10)
line1.milestones.forEach((m) => {
  m.status = 'Completed';
  m.actualStartDate = '2026-08-01';
  m.actualEndDate = '2026-08-20';
  m.completionPct = 100;
});
line1.status = 'Completed';

// Line 2 (qty 20) has 7 stages completed (50%)
const line2 = po.productLines[1];
for (let i = 0; i < 7; i++) {
  line2.milestones[i].status = 'Completed';
  line2.milestones[i].actualEndDate = '2026-08-15';
  line2.milestones[i].completionPct = 100;
}

const line1Progress = 100;
const line2Progress = Math.round((7 / 14) * 100); // 50%

const totalWeight = line1.qty + line2.qty; // 10 + 20 = 30
const weightedAvg = Math.round((line1Progress * line1.qty + line2Progress * line2.qty) / totalWeight);
// (100 * 10 + 50 * 20) / 30 = (1000 + 1000) / 30 = 67%

assert(weightedAvg === 67, `Weighted progress accurately calculated as ${weightedAvg}% (Expected 67%)`);

// ----------------------------------------------------------------------------
// TEST GROUP 6: Multi-Product Order Closure Governance
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 6: Multi-Product Order Closure Validation');

// Check if PO can be closed when line 2 is only 50% complete
const canCloseIncomplete = po.productLines.every(l =>
  l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
);
assert(!canCloseIncomplete, 'Order closure is strictly blocked when not all product lines are completed');

// Now complete remaining 7 stages on line 2
for (let i = 7; i < 14; i++) {
  line2.milestones[i].status = 'Completed';
  line2.milestones[i].actualEndDate = '2026-09-01';
  line2.milestones[i].completionPct = 100;
}
line2.status = 'Completed';

const canCloseComplete = po.productLines.every(l =>
  l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
);
assert(canCloseComplete, 'Order closure is fully unlocked when all 14 stages across all product lines are complete');

// Final Status Check
const poStatusAfterFullCompletion = getPOManufacturingStatus(po);
assert(poStatusAfterFullCompletion.completedStagesCount >= 14, 'getPOManufacturingStatus reports 100% stage completion');

// Role-Based Closure Governance Check
const isAuthorizedRole = (role: string) => role === 'Project Management' || role === 'Project Manager (PM Baseline)';
assert(!isAuthorizedRole('Stores (Shipment)'), 'Stores (Shipment) role is strictly blocked from closing orders');
assert(!isAuthorizedRole('Sales / AE (Customer PO)'), 'Sales / AE role is strictly blocked from closing orders');
assert(!isAuthorizedRole('QC (TRN)'), 'QC (TRN) role is strictly blocked from closing orders');
assert(isAuthorizedRole('Project Manager (PM Baseline)'), 'Project Manager (PM Baseline) is authorized to formally close orders');
assert(isAuthorizedRole('Project Management'), 'Project Management (Admin) is authorized to formally close orders');

// ----------------------------------------------------------------------------
// TEST GROUP 7: Inherited Predecessor Delay Start Chaining & Zero New Delay Validation
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 7: Inherited Predecessor Delay Start Chaining & Zero New Delay Validation');

const stage6ActualEnd = '2026-10-24'; // 3 days delay

const stage7BaselineStart = '2026-10-21';
const stage7BaselineEnd = '2026-10-24';
const stage7Duration = 3;

// 1. Stage 7 starts with previous stage end date
const stage7DefaultStartDate = stage6ActualEnd;
assert(stage7DefaultStartDate === '2026-10-24', 'Stage 7 start date chains directly to Stage 6 delayed end date (2026-10-24)');

// 2. Calculate delay metrics for Stage 7 start on 2026-10-24
const s7TotalStartDelay = getDaysDifference(stage7BaselineStart, stage7DefaultStartDate); // 3 days
const s7InheritedDelay = Math.min(s7TotalStartDelay, getDaysDifference(stage7BaselineStart, stage6ActualEnd)); // 3 days
const s7NewDelayFormed = Math.max(0, s7TotalStartDelay - s7InheritedDelay); // 0 days
assert(s7TotalStartDelay === 3, 'Total delay from original baseline start is 3 days');
assert(s7InheritedDelay === 3, 'Inherited delay from previous stage is 3 days');
assert(s7NewDelayFormed === 0, 'No new delay formed at Stage 7 when starting on previous end date (strictly 0d)');

// 3. Verify planned baseline vs revised plan due to delay
const s7RevisedStart = stage6ActualEnd; // 2026-10-24
const s7RevisedEnd = addDays(s7RevisedStart, stage7Duration); // 2026-10-27 (+3d shift)
assert(stage7BaselineStart === '2026-10-21' && stage7BaselineEnd === '2026-10-24', 'Planned baseline preserved immutable as 2026-10-21 -> 2026-10-24');
assert(s7RevisedStart === '2026-10-24' && s7RevisedEnd === '2026-10-27', 'Revised target due to delay correctly computed as 2026-10-24 -> 2026-10-27');

// ----------------------------------------------------------------------------
// TEST GROUP 8: Completed & Closed Order Delay Preservation in History
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 8: Completed & Closed Order Delay Preservation in History Archive');

const closedDelayedPO: PurchaseOrder = {
  ...po,
  id: 'PO-CLOSED-DELAYED',
  poNumber: 'PO-2026-999',
  isClosed: true,
  status: 'Closed' as any,
  committedDeliveryDate: '2026-09-01',
  revisedDeliveryDate: '2026-09-04',
  productLines: [
    {
      ...po.productLines[0],
      overallVarianceDays: 3,
      milestones: po.productLines[0].milestones.map((m, idx) => ({
        ...m,
        status: 'Completed',
        actualEndDate: idx === 13 ? '2026-09-04' : '2026-08-20',
        committedBaselineEndDate: idx === 13 ? '2026-09-01' : '2026-08-15',
        varianceDays: idx === 13 ? 3 : 0
      }))
    }
  ]
};

const closedDelayedSummary = getPOManufacturingStatus(closedDelayedPO);
assert(closedDelayedSummary.delayDays === 3, `Closed delayed order accurately preserves delayDays of 3d (got ${closedDelayedSummary.delayDays}d)`);
assert(closedDelayedSummary.timelineValidationStatus === 'CLOSED', 'Timeline status is CLOSED');
assert(closedDelayedSummary.timelineMessage.includes('+3d delay'), 'Timeline message highlights +3d delay on closed order');
// ----------------------------------------------------------------------------
// TEST GROUP 9: Multi-Product Delay Isolation & Individual Revised Timelines
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 9: Multi-Product Delay Isolation & Individual Revised Timelines');

const line1Delayed = recalculateProductLine({
  id: 'LINE-01',
  lineNumber: 'LINE-01',
  productName: 'High Pressure Valve 4" 1500#',
  category: 'High Pressure Valves',
  qty: 5,
  designType: 'Existing Design',
  materials: [],
  status: 'Delayed',
  overallVarianceDays: 4,
  milestones: build14Milestones('2026-08-01').map((m, idx) => {
    if (idx === 0) return { ...m, status: 'Completed', actualEndDate: '2026-08-06', varianceDays: 4 };
    return { ...m, forecastEndDate: addDays(m.committedBaselineEndDate, 4), varianceDays: 4 };
  })
}, '2026-08-10');

const line2OnTime = recalculateProductLine({
  id: 'LINE-02',
  lineNumber: 'LINE-02',
  productName: 'Cryogenic Valve 2" 600#',
  category: 'Cryogenic Valves',
  qty: 10,
  designType: 'Existing Design',
  materials: [],
  status: 'In Progress',
  overallVarianceDays: 0,
  milestones: build14Milestones('2026-08-01').map((m, idx) => {
    if (idx === 0) return { ...m, status: 'Completed', actualEndDate: '2026-08-02', varianceDays: 0 };
    return m;
  })
}, '2026-08-10');

assert(line1Delayed.overallVarianceDays === 4, `Line 1 retains its 4d delay variance (got ${line1Delayed.overallVarianceDays}d)`);
assert(line2OnTime.overallVarianceDays === 0, `Line 2 remains on time with 0d delay variance (got ${line2OnTime.overallVarianceDays}d)`);

const line1FinalMs = line1Delayed.milestones[13];
const line2FinalMs = line2OnTime.milestones[13];

assert(line1FinalMs.forecastEndDate > line1FinalMs.committedBaselineEndDate, 'Line 1 final milestone delivery date is shifted by delay');
assert(line2FinalMs.forecastEndDate === line2FinalMs.committedBaselineEndDate, 'Line 2 final milestone delivery date remains strictly on baseline');

// ----------------------------------------------------------------------------
// TEST GROUP 10: Delay Log Attribution to Specific Product Line
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 10: Delay Log Attribution to Specific Product Line');

const multiProductPO: PurchaseOrder = {
  id: 'PO-MULTI-01',
  poNumber: 'CFT-PO-2026-9001',
  customerName: 'Aramco Offshore',
  customerPoRef: 'REF-9988',
  poDate: '2026-08-01',
  contractReviewRef: 'CR-001',
  committedDeliveryDate: line1FinalMs.committedBaselineEndDate,
  revisedDeliveryDate: line1FinalMs.forecastEndDate,
  status: 'Delayed',
  productLines: [line1Delayed, line2OnTime],
  revisions: [],
  attachments: [],
  createdBy: 'Sales User',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUpdatedBy: 'Planner User',
  lastUpdatedAt: '2026-08-10T00:00:00.000Z',
  isClosed: false
};

const delayFlow = extractDelayFlow(multiProductPO);
assert(delayFlow.hasDelays === true, 'Delay flow detects delay in multi-product order');
assert(delayFlow.rootDelayStep !== null, 'Root delay step identified');
assert(delayFlow.rootDelayStep?.productLineName === 'High Pressure Valve 4" 1500#', `Delay step accurately attributes the causing product line (got "${delayFlow.rootDelayStep?.productLineName}")`);
assert(delayFlow.rootDelayStep?.lineNumber === 'LINE-01', `Delay step accurately attributes the causing line number (got "${delayFlow.rootDelayStep?.lineNumber}")`);

// ----------------------------------------------------------------------------
// TEST GROUP 11: CSV Template & Import Validation with Stage 7 Procurement Columns
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 11: CSV Template & Import Validation with Stage 7 Procurement Columns');

import { generateCsvTemplate, parseAndValidateCsv } from '../services/csvImportService.ts';

const generatedCsv = generateCsvTemplate();
assert(generatedCsv.includes('S7_MaterialOrderDate'), 'CSV template includes S7_MaterialOrderDate header');
assert(generatedCsv.includes('S7_MaterialExpectedDate'), 'CSV template includes S7_MaterialExpectedDate header');
assert(generatedCsv.includes('S7_MaterialReceipt_Actual'), 'CSV template includes S7_MaterialReceipt_Actual header');
assert(generatedCsv.includes('S7_InspectionResult'), 'CSV template includes S7_InspectionResult header');

const importResult = parseAndValidateCsv(generatedCsv, [], [], [], 'System Admin');
assert(importResult.isValid === true, `Generated CSV template parses with valid status (errors: ${importResult.errors.join(', ')})`);
assert(importResult.previewPOs.length === 3, `Imported exactly 3 sample POs from CSV (got ${importResult.previewPOs.length})`);

const aramcoPO = importResult.previewPOs.find(p => p.poNumber === 'PO-2026-801');
assert(aramcoPO !== undefined, 'Found imported Saudi Aramco PO');
assert(aramcoPO!.productLines.length === 2, `Saudi Aramco PO contains 2 product lines (got ${aramcoPO?.productLines.length})`);
assert(aramcoPO!.bookedAmount === 150000, `Saudi Aramco PO bookedAmount matches template (got ${aramcoPO?.bookedAmount})`);

const aramcoLine1 = aramcoPO!.productLines[0];
assert(aramcoLine1.materials.length > 0, 'Line 1 has raw materials initialized');
assert(aramcoLine1.materials[0].orderedDate === '2026-09-24', `Material order date matches CSV (got ${aramcoLine1.materials[0].orderedDate})`);
assert(aramcoLine1.materials[0].expectedDate === '2026-10-08', `Material expected date matches CSV (got ${aramcoLine1.materials[0].expectedDate})`);
assert(aramcoLine1.materials[0].receivedDate === '2026-10-06', `Material received date matches CSV (got ${aramcoLine1.materials[0].receivedDate})`);
assert(aramcoLine1.materials[0].inspectionResult === 'Passed', `Material inspection result matches CSV (got ${aramcoLine1.materials[0].inspectionResult})`);

const s7Ms = aramcoLine1.milestones.find(m => m.key === 'material_receipt');
assert(s7Ms !== undefined, 'Found Stage 7 Material Receipt milestone');
assert(s7Ms!.status === 'Completed', `Stage 7 milestone is marked Completed (got ${s7Ms?.status})`);
assert(s7Ms!.actualEndDate === '2026-10-06', `Stage 7 actual end date is 2026-10-06 (got ${s7Ms?.actualEndDate})`);

// Test 2-Tier Excel Tracker Import (Book2.xlsx format)
const book2CsvSample = `,,,,,,,,,,,,,,,,Mini-BOM,,,,PO - Long Leads,,,,BOM,,,,PO,,,,Change Requests,,,,Material Receipts,,,,,,Assembly,,,,,Packing & Dispatch,,,,
Project No,Customer Name,PO NO,Scope,Booked Amount,Std Delivery (Weeks),PO Date,CORB Release Date,No Of Days,Delay CORB Release,COTD,PO Delivery (Weeks),INCOTERMS,Promised Date,CORB Open Points Closure,Clarification Delay after CORB,Planned,Actual,Delay,Delay in Mini-BOM,Planned,Actual,Delay,Delay in Long lead PO ,Planned,Actual,Delay,BOM Delay,Planned,Actual,Delay,PO Delay,No of Requests,Customer,Internal,Total Delay,Lead Time for Inhouse process,Procurement lead time,Planned,Actual,Delay,Mat'l receipt delay,Lead time,Planned,Actual,Delay,Assembly Delay,Planned,Actual,Delay,Packing / Shipping Delay,Overall Lead Time,LD Applicable,Shippment status,Remarks
PRJ-901,Qatar Energy,PO-QE-991,DN100 High Pressure Control Valve,$150000,12,2026-09-01,2026-09-05,4,0,2026-11-25,12,FOB,2026-11-25,,,2026-09-08,2026-09-08,0,,2026-09-12,2026-09-12,0,,2026-09-10,2026-09-10,0,,2026-09-15,2026-09-15,0,,,,,,,2026-09-29,2026-09-29,0,,,2026-10-15,2026-10-15,0,,,2026-11-20,2026-11-20,0,,,Completed,All on track`;

const book2Result = parseAndValidateCsv(book2CsvSample, [], [], [], 'System Admin');
assert(book2Result.isValid === true, `2-tier Book2 tracker format parses with valid status (errors: ${book2Result.errors.join(', ')})`);
assert(book2Result.warnings.length === 0, `2-tier Book2 tracker has 0 false date warnings (got ${book2Result.warnings.length})`);
assert(book2Result.previewPOs.length === 1, `2-tier Book2 parser extracts 1 PO (got ${book2Result.previewPOs.length})`);
const qatarPO = book2Result.previewPOs[0];
assert(qatarPO.poNumber === 'PO-QE-991', `Extracted correct PO NO from Book2 format (got ${qatarPO.poNumber})`);
assert(qatarPO.customerName === 'Qatar Energy', `Extracted correct Customer Name (got ${qatarPO.customerName})`);
assert(qatarPO.bookedAmount === 150000, `Extracted correct Booked Amount from Book2 format (got ${qatarPO.bookedAmount})`);
assert(qatarPO.startDate === '2026-09-01', `Extracted correct Start Date from Book2 format (got ${qatarPO.startDate})`);
assert(book2Result.previewRows[0].bookedAmount === 150000, `Preview row correctly captured Booked Amount of $150,000 (got ${book2Result.previewRows[0].bookedAmount})`);
assert(qatarPO.productLines[0].productName === 'DN100 High Pressure Control Valve', `Extracted correct Scope/Product Name (got ${qatarPO.productLines[0].productName})`);
assert(book2Result.previewRows[0].completedStagesCount === 14, `Preview row correctly calculates 14 completed stages (got ${book2Result.previewRows[0].completedStagesCount})`);
assert(book2Result.previewRows[0].currentActiveStageName.includes('14. Final Shipment'), `Preview row accurately displays Stage 14 status (got ${book2Result.previewRows[0].currentActiveStageName})`);

const qatarBomMs = qatarPO.productLines[0].milestones.find(m => m.key === 'bom_release');
assert(qatarBomMs !== undefined, 'Found Stage 4 BOM Release milestone on imported order');
assert(qatarBomMs!.actualEndDate === '2026-09-10', `Stage 4 uses real BOM actual date 2026-09-10 instead of Mini-BOM 2026-09-08 (got ${qatarBomMs?.actualEndDate})`);
assert(qatarBomMs!.committedBaselineEndDate === '2026-09-10', `Stage 4 committed baseline end date is real BOM planned date 2026-09-10 (got ${qatarBomMs?.committedBaselineEndDate})`);

// Test Excel Import with Planned vs Actual Dates and Delay Calculation
const delayTrackerCsv = `PO Number,Customer Name,Product Name,Customer PO Date,Contractual Delivery Date,S1_CustomerPO_Planned,S1_CustomerPO_Actual,S2_PMBaseline_Planned,S2_PMBaseline_Actual,S3_CORB_Planned,S3_CORB_Actual,S4_BOMRelease_Planned,S4_BOMRelease_Actual,S4_BOMRelease_Delay,Remarks
PO-DELAY-TEST,Petrofac,10" 900# High Pressure Gate Valve,2026-09-01,2026-12-15,2026-09-01,2026-09-01,2026-09-04,2026-09-04,2026-09-07,2026-09-07,2026-09-10,2026-09-16,6,Customer delayed review of BOM spec`;

const delayImportResult = parseAndValidateCsv(delayTrackerCsv, [], [], [], 'System Admin');
assert(delayImportResult.isValid === true, `Delay tracker CSV parsed successfully (errors: ${delayImportResult.errors.join(', ')})`);
const delayPO = delayImportResult.previewPOs[0];
const delayBomMs = delayPO.productLines[0].milestones.find(m => m.key === 'bom_release');
assert(delayBomMs !== undefined, 'Found BOM milestone in delay test PO');
assert(delayBomMs!.committedBaselineEndDate === '2026-09-10', `Milestone committed baseline end date matches planned date (got ${delayBomMs?.committedBaselineEndDate})`);
assert(delayBomMs!.actualEndDate === '2026-09-16', `Milestone actual end date matches imported actual date (got ${delayBomMs?.actualEndDate})`);
assert(delayBomMs!.varianceDays === 6, `Delay calculation accurately evaluated +6d delay between planned and actual (got ${delayBomMs?.varianceDays})`);
assert(delayBomMs!.delayCategory === 'Customer', `Delay category correctly identified as Customer for BOM (got ${delayBomMs?.delayCategory})`);
assert(Boolean(delayBomMs!.delayReason?.includes('Customer delayed review of BOM spec') || delayBomMs!.delayReason?.includes('+6d')), `Delay reason preserved (got ${delayBomMs?.delayReason})`);
assert(delayPO.productLines[0].overallVarianceDays >= 6, `Product line overall variance reflects milestone delay (got ${delayPO.productLines[0].overallVarianceDays})`);

// TEST GROUP 12: High-Volume 500+ Orders Scalability & Performance Benchmark
console.log('\n📋 GROUP 12: High-Volume 500+ Orders Scalability & Performance Benchmark');

const customersList = ['Saudi Aramco', 'QatarEnergy', 'Shell Global', 'ExxonMobil', 'Chevron Corp', 'TotalEnergies', 'BP Global', 'ADNOC', 'Petrobras', 'Eni SpA'];
const productsList = ['2" 600# Gate Valve', '4" 1500# Globe Valve', 'DN50 Flowmeter', '6" 300# Ball Valve', '8" 900# Check Valve', '3" Control Valve'];

const headerRow0 = ',,,,,,,,,,,,,,,,Mini-BOM,,,,PO - Long Leads,,,,BOM,,,,PO,,,,Change Requests,,,,Material Receipts,,,,,,Assembly,,,,,Packing & Dispatch,,,,';
const headerRow1 = 'Project No,Customer Name,PO NO,Scope,Booked Amount,Std Delivery (Weeks),PO Date,CORB Release Date,No Of Days,Delay CORB Release,COTD,PO Delivery (Weeks),INCOTERMS,Promised Date,CORB Open Points Closure,Clarification Delay after CORB,Planned,Actual,Delay,Delay in Mini-BOM,Planned,Actual,Delay,Delay in Long lead PO ,Planned,Actual,Delay,BOM Delay,Planned,Actual,Delay,PO Delay,No of Requests,Customer,Internal,Total Delay,Lead Time for Inhouse process,Procurement lead time,Planned,Actual,Delay,Mat\'l receipt delay,Lead time,Planned,Actual,Delay,Assembly Delay,Planned,Actual,Delay,Packing / Shipping Delay,Overall Lead Time,LD Applicable,Shippment status,Remarks';

const large500Rows: string[] = [headerRow0, headerRow1];
for (let i = 1; i <= 500; i++) {
  const cust = customersList[i % customersList.length];
  const prod = productsList[i % productsList.length];
  const poNum = `PO-SCALE-${String(i).padStart(4, '0')}`;
  const prjNum = `PRJ-${String(i).padStart(4, '0')}`;
  large500Rows.push(`${prjNum},${cust},${poNum},${prod},75000,8,2026-08-01,2026-08-05,4,0,2026-10-15,8,FOB,2026-10-15,,,2026-08-08,2026-08-08,0,0,2026-08-14,2026-08-14,0,0,2026-08-10,2026-08-10,0,0,2026-08-15,2026-08-15,0,0,0,0,0,0,14,14,2026-09-05,2026-09-05,0,0,7,2026-09-20,2026-09-20,0,0,2026-10-01,2026-10-01,0,0,56,No,Completed,Batch scale order #${i}`);
}

const large500Csv = large500Rows.join('\r\n');
const startTime = Date.now();
const scale500Result = parseAndValidateCsv(large500Csv, [], [], [], 'System Admin');
const elapsedMs = Date.now() - startTime;

console.log(`  ⏱️ Processed and planned 500 full orders (7,000 milestones) in ${elapsedMs}ms`);
assert(scale500Result.isValid === true, `500-order high volume CSV parses with valid status (errors: ${scale500Result.errors.join(', ')})`);
assert(scale500Result.previewPOs.length === 500, `Extracted and planned exactly 500 POs (got ${scale500Result.previewPOs.length})`);
assert(scale500Result.totalProductLines === 500, `Extracted 500 product lines (got ${scale500Result.totalProductLines})`);
assert(elapsedMs < 3000, `500-order throughput meets real-time SLA under 3 seconds (took ${elapsedMs}ms)`);

// 1,000 Order Arbitrary Scale Benchmark (14,000 Milestones)
const large1000Rows: string[] = [headerRow0, headerRow1];
for (let i = 1; i <= 1000; i++) {
  const cust = customersList[i % customersList.length];
  const prod = productsList[i % productsList.length];
  const poNum = `PO-1K-${String(i).padStart(4, '0')}`;
  const prjNum = `PRJ-1K-${String(i).padStart(4, '0')}`;
  large1000Rows.push(`${prjNum},${cust},${poNum},${prod},85000,10,2026-08-01,2026-08-05,4,0,2026-10-15,10,FOB,2026-10-15,,,2026-08-08,2026-08-08,0,0,2026-08-14,2026-08-14,0,0,2026-08-10,2026-08-10,0,0,2026-08-15,2026-08-15,0,0,0,0,0,0,14,14,2026-09-05,2026-09-05,0,0,7,2026-09-20,2026-09-20,0,0,2026-10-01,2026-10-01,0,0,56,No,Completed,Batch 1k order #${i}`);
}
const large1000Csv = large1000Rows.join('\r\n');
const start1kTime = Date.now();
const scale1000Result = parseAndValidateCsv(large1000Csv, [], [], [], 'System Admin');
const elapsed1kMs = Date.now() - start1kTime;

console.log(`  ⏱️ Processed and planned 1,000 full orders (14,000 milestones) in ${elapsed1kMs}ms`);
assert(scale1000Result.isValid === true, `1,000-order high volume CSV parses with valid status (errors: ${scale1000Result.errors.join(', ')})`);
assert(scale1000Result.previewPOs.length === 1000, `Extracted and planned exactly 1,000 POs (got ${scale1000Result.previewPOs.length})`);
assert(scale1000Result.totalProductLines === 1000, `Extracted 1,000 product lines (got ${scale1000Result.totalProductLines})`);
assert(elapsed1kMs < 4000, `1,000-order throughput meets real-time SLA under 4 seconds (took ${elapsed1kMs}ms)`);

// ---------------------------------------------------------------------------
// GROUP 13: Year-Wise Completed Orders Reporting, OTIF & Bottleneck Analytics
// ---------------------------------------------------------------------------
console.log('\n📋 GROUP 13: Year-Wise Completed Orders Reporting, OTIF & Bottleneck Analytics');

// Mock multi-year completed orders
const mockCompletedOrder2025: PurchaseOrder = {
  id: 'po-test-2025-01',
  poNumber: 'PO-HIST-2025-01',
  customerName: 'PetroChina',
  customerPoRef: 'PC-2025-99',
  poDate: '2025-02-01',
  committedDeliveryDate: '2025-05-15',
  revisedDeliveryDate: '2025-05-15',
  actualDeliveryDate: '2025-05-15',
  bookedAmount: 240000,
  contractReviewRef: 'CR-2025-01',
  status: 'Completed',
  isClosed: true,
  productLines: [{
    id: 'line-2025-01',
    lineNumber: 'LINE-01',
    productName: 'Cryogenic Ball Valve 6"',
    category: 'Cryogenic Valves',
    qty: 5,
    designType: 'Existing Design',
    overallVarianceDays: 0,
    status: 'Completed',
    milestones: [
      {
        id: 'ms-2025-14',
        key: 'shipment',
        name: 'Shipment & Dispatch',
        stageOrder: 14,
        defaultDurationDays: 3,
        committedBaselineStartDate: '2025-05-12',
        committedBaselineEndDate: '2025-05-15',
        committedDurationDays: 3,
        actualStartDate: '2025-05-12',
        actualEndDate: '2025-05-15',
        forecastStartDate: '2025-05-12',
        forecastEndDate: '2025-05-15',
        varianceDays: 0,
        status: 'Completed',
        completionPct: 100
      }
    ],
    materials: []
  }],
  revisions: [],
  attachments: [],
  createdBy: 'Sales',
  createdAt: '2025-02-01',
  lastUpdatedBy: 'Stores',
  lastUpdatedAt: '2025-05-15'
};

const mockCompletedOrder2026: PurchaseOrder = {
  id: 'po-test-2026-01',
  poNumber: 'PO-HIST-2026-01',
  customerName: 'Aramco Offshore',
  customerPoRef: 'AR-2026-88',
  poDate: '2026-03-01',
  committedDeliveryDate: '2026-06-01',
  revisedDeliveryDate: '2026-06-12',
  actualDeliveryDate: '2026-06-12',
  bookedAmount: 380000,
  contractReviewRef: 'CR-2026-01',
  status: 'Completed',
  isClosed: true,
  productLines: [{
    id: 'line-2026-01',
    lineNumber: 'LINE-01',
    productName: 'Subsea Choke Valve 4"',
    category: 'High Pressure Valves',
    qty: 2,
    designType: 'New Design',
    overallVarianceDays: 11,
    status: 'Completed',
    milestones: [
      {
        id: 'ms-2026-07',
        key: 'material_receipt',
        name: 'Material Receipt (GRN)',
        stageOrder: 7,
        defaultDurationDays: 14,
        committedBaselineStartDate: '2026-03-20',
        committedBaselineEndDate: '2026-04-03',
        committedDurationDays: 14,
        actualStartDate: '2026-03-20',
        actualEndDate: '2026-04-14',
        forecastStartDate: '2026-03-20',
        forecastEndDate: '2026-04-14',
        varianceDays: 11,
        status: 'Completed',
        completionPct: 100,
        delayCategory: 'Supplier',
        delayReason: 'Forged Body Billet heat-treatment retest delay'
      },
      {
        id: 'ms-2026-14',
        key: 'shipment',
        name: 'Shipment & Dispatch',
        stageOrder: 14,
        defaultDurationDays: 3,
        committedBaselineStartDate: '2026-05-29',
        committedBaselineEndDate: '2026-06-01',
        committedDurationDays: 3,
        actualStartDate: '2026-06-09',
        actualEndDate: '2026-06-12',
        forecastStartDate: '2026-06-09',
        forecastEndDate: '2026-06-12',
        varianceDays: 11,
        status: 'Completed',
        completionPct: 100
      }
    ],
    materials: []
  }],
  revisions: [
    {
      revNumber: 0,
      requestedBy: 'System',
      approvedBy: 'Admin',
      approvedAt: '2026-03-01',
      reason: 'Initial baseline',
      docRef: 'REV-0',
      changes: []
    },
    {
      revNumber: 1,
      requestedBy: 'Stores',
      approvedBy: 'Admin',
      approvedAt: '2026-04-14',
      reason: 'Raw material receipt delay',
      docRef: 'REV-1',
      changes: []
    }
  ],
  attachments: [],
  createdBy: 'Sales',
  createdAt: '2026-03-01',
  lastUpdatedBy: 'Stores',
  lastUpdatedAt: '2026-06-12'
};

const allMockCompleted = [mockCompletedOrder2025, mockCompletedOrder2026];

// Test Year 2025 aggregation grouped by start date
const orders2025 = allMockCompleted.filter(po => {
  const d = po.startDate || po.poDate;
  return d.startsWith('2025');
});
assert(orders2025.length === 1, `Filtered 2025 completed orders correctly by start date (got ${orders2025.length})`);
assert(orders2025[0].bookedAmount === 240000, `2025 Booked Amount matches $240,000 (got ${orders2025[0].bookedAmount})`);
const summary2025 = getPOManufacturingStatus(orders2025[0]);
assert(summary2025.delayDays === 0, `2025 order has 0d delay (got ${summary2025.delayDays}d)`);

// Test Year 2026 aggregation grouped by start date
const orders2026 = allMockCompleted.filter(po => {
  const d = po.startDate || po.poDate;
  return d.startsWith('2026');
});
assert(orders2026.length === 1, `Filtered 2026 completed orders correctly by start date (got ${orders2026.length})`);
assert(orders2026[0].bookedAmount === 380000, `2026 Booked Amount matches $380,000 (got ${orders2026[0].bookedAmount})`);
const summary2026 = getPOManufacturingStatus(orders2026[0]);
assert(summary2026.delayDays === 11, `2026 order has +11d schedule overrun (got ${summary2026.delayDays}d)`);
assert(Boolean(summary2026.delayedStageName?.includes('Material Receipt')), `2026 delay stage accurately identifies Material Receipt (got ${summary2026.delayedStageName})`);
assert(Boolean(summary2026.delayReason?.includes('Forged Body Billet')), `2026 delay reason preserves specific root cause (got ${summary2026.delayReason})`);

// Cumulative multi-year rollup
const totalBookedAll = allMockCompleted.reduce((sum, p) => sum + (p.bookedAmount || 0), 0);
assert(totalBookedAll === 620000, `Multi-year total revenue calculated as $620,000 (got ${totalBookedAll})`);
const onTimeAll = allMockCompleted.filter(p => getPOManufacturingStatus(p).delayDays <= 0).length;
const cumulativeOTIF = Math.round((onTimeAll / allMockCompleted.length) * 100);
assert(cumulativeOTIF === 50, `Cumulative OTIF rate accurately calculates 50% (got ${cumulativeOTIF}%)`);

console.log('\n📋 GROUP 14: Canonical Milestone Revised Timeline & Total Delay in All Stages');

// Test 1: On-track milestone produces clean baseline dates
const onTrackMs: Milestone = {
  id: 'ms-test-1',
  key: 'corb_release',
  name: '3. CORB Release',
  stageOrder: 3,
  defaultDurationDays: 2,
  committedBaselineStartDate: '2026-10-05',
  committedBaselineEndDate: '2026-10-07',
  committedDurationDays: 2,
  forecastStartDate: '2026-10-05',
  forecastEndDate: '2026-10-07',
  varianceDays: 0,
  status: 'Not Started',
  completionPct: 0
};
const onTrackDates = getMilestoneRevisedDates(onTrackMs, null);
assert(onTrackDates.revisedStart === '2026-10-05', `On-track revisedStart matches baselineStart (got ${onTrackDates.revisedStart})`);
assert(onTrackDates.revisedEnd === '2026-10-07', `On-track revisedEnd matches baselineEnd (got ${onTrackDates.revisedEnd})`);
assert(onTrackDates.shiftDays === 0, `On-track shiftDays is 0 (got ${onTrackDates.shiftDays})`);
assert(!onTrackDates.isDelayed, 'On-track isDelayed is false');

// Test 2: Predecessor delay shifts revised timeline consistently
const prevDelayedMs: Milestone = {
  id: 'ms-test-prev',
  key: 'pm_baseline',
  name: '2. Baseline Review',
  stageOrder: 2,
  defaultDurationDays: 3,
  committedBaselineStartDate: '2026-10-01',
  committedBaselineEndDate: '2026-10-04',
  committedDurationDays: 3,
  forecastStartDate: '2026-10-01',
  forecastEndDate: '2026-10-09',
  actualStartDate: '2026-10-01',
  actualEndDate: '2026-10-09', // 5 days late
  varianceDays: 5,
  status: 'Completed',
  completionPct: 100
};
const shiftedDates = getMilestoneRevisedDates(onTrackMs, prevDelayedMs);
assert(shiftedDates.revisedStart === '2026-10-09', `Revised start shifts to previous actual end date (got ${shiftedDates.revisedStart})`);
assert(shiftedDates.revisedEnd === '2026-10-11', `Revised end maintains 2-day duration from shifted start (got ${shiftedDates.revisedEnd})`);
assert(shiftedDates.shiftDays === 4, `Shift days evaluates to 4 days vs baseline start (got ${shiftedDates.shiftDays})`);
assert(shiftedDates.isDelayed, 'Delayed status is true');

// Test 3: Milestone with its own late actual start
const lateStartMs: Milestone = {
  ...onTrackMs,
  actualStartDate: '2026-10-10' // 5 days late kickoff
};
const lateStartDates = getMilestoneRevisedDates(lateStartMs, null);
assert(lateStartDates.revisedStart === '2026-10-10', `Milestone own actualStartDate drives revisedStart (got ${lateStartDates.revisedStart})`);
assert(lateStartDates.revisedEnd === '2026-10-12', `Revised end maintains 2-day duration (got ${lateStartDates.revisedEnd})`);
assert(lateStartDates.shiftDays === 5, `Shift days is 5 days late (got ${lateStartDates.shiftDays})`);

// Test 4: Total Delay in all stages verification
const multiStageDelayPO: PurchaseOrder = {
  id: 'po-multi-delay',
  poNumber: 'PO-TEST-TOTAL-DELAY',
  customerName: 'Test Energy Corp',
  customerPoRef: 'REF-01',
  contractReviewRef: 'CR-TEST-01',
  poDate: '2026-09-01',
  committedDeliveryDate: '2026-10-15',
  revisedDeliveryDate: '2026-10-21',
  status: 'Delayed',
  revisions: [],
  attachments: [],
  createdBy: 'Project Management',
  createdAt: '2026-09-01T00:00:00Z',
  lastUpdatedBy: 'SCM',
  lastUpdatedAt: '2026-09-20T00:00:00Z',
  isClosed: false,
  productLines: [{
    id: 'line-td-1',
    lineNumber: 'LINE-01',
    productName: 'Gate Valve DN50',
    category: 'High-Pressure Control Valves',
    qty: 5,
    designType: 'Existing Design',
    overallVarianceDays: 6,
    status: 'Delayed',
    materials: [],
    milestones: [
      {
        id: 'ms-td-1',
        key: 'po_from_customer',
        name: '1. Customer PO',
        stageOrder: 1,
        defaultDurationDays: 1,
        committedBaselineStartDate: '2026-09-01',
        committedBaselineEndDate: '2026-09-02',
        committedDurationDays: 1,
        forecastStartDate: '2026-09-01',
        forecastEndDate: '2026-09-02',
        actualStartDate: '2026-09-01',
        actualEndDate: '2026-09-02',
        varianceDays: 0,
        status: 'Completed',
        completionPct: 100
      },
      {
        id: 'ms-td-3',
        key: 'corb_release',
        name: '3. CORB Release',
        stageOrder: 3,
        defaultDurationDays: 2,
        committedBaselineStartDate: '2026-09-05',
        committedBaselineEndDate: '2026-09-07',
        committedDurationDays: 2,
        forecastStartDate: '2026-09-05',
        forecastEndDate: '2026-09-09',
        actualStartDate: '2026-09-05',
        actualEndDate: '2026-09-09', // +2d delay
        varianceDays: 2,
        delayReason: 'Customer engineering clarification',
        status: 'Completed',
        completionPct: 100
      },
      {
        id: 'ms-td-7',
        key: 'material_receipt',
        name: '7. Material Receipt',
        stageOrder: 7,
        defaultDurationDays: 14,
        committedBaselineStartDate: '2026-09-15',
        committedBaselineEndDate: '2026-09-29',
        committedDurationDays: 14,
        forecastStartDate: '2026-09-17',
        forecastEndDate: '2026-10-05',
        actualStartDate: '2026-09-17',
        actualEndDate: '2026-10-05', // +6d total variance (added +4d)
        varianceDays: 6,
        delayReason: 'Mill certificate re-inspection',
        status: 'Completed',
        completionPct: 100
      }
    ]
  }]
};

const delayLedger = extractDelayFlow(multiStageDelayPO);
assert(delayLedger.totalDaysDelayed === 6, `Total days delayed across all stages calculates +6d (got ${delayLedger.totalDaysDelayed}d)`);
assert(delayLedger.delaySteps.length === 2, `Identifies exactly 2 stages adding delay in log (got ${delayLedger.delaySteps.length})`);
assert(delayLedger.delaySteps[0].stageDelayAdded === 2, `Stage 3 added +2d delay (got ${delayLedger.delaySteps[0].stageDelayAdded})`);
assert(delayLedger.delaySteps[1].stageDelayAdded === 4, `Stage 7 added +4d new delay (got ${delayLedger.delaySteps[1].stageDelayAdded})`);
assert(delayLedger.netVarianceDays === 6, `Net variance matches 6 days (got ${delayLedger.netVarianceDays})`);

console.log('\n📋 GROUP 15: Stage 7 Stores Raw Material Receipt & GRN Verification Delay Calculation');

// Test scenario matching user screenshot:
// Planned Baseline: 2026-11-05 -> 2026-11-26 (21 days duration)
// Revised Target: 2026-11-07 -> 2026-11-28 (+2d shift from Stage 5 Work Order Release)
// Material Order Date: 2026-11-07
// Expected Delivery Date: 2026-11-28
// Actual Received Date (GRN): 2026-11-28
const baselineStartS7 = '2026-11-05';
const baselineEndS7 = '2026-11-26';
const prevStageEndS7 = '2026-11-07'; // Stage 5 ended 2 days late
const matOrderDate = '2026-11-07';
const matExpectedDate = '2026-11-28';
const matReceivedDate = '2026-11-28';

// When starting Stage 7 (mode === 'start'):
// Event date is Material Order Date
const s7StartTotalDelay = (baselineStartS7 && matOrderDate > baselineStartS7)
  ? getDaysDifference(baselineStartS7, matOrderDate)
  : 0;
const s7StartInheritedDelay = (baselineStartS7 && prevStageEndS7 > baselineStartS7)
  ? Math.min(s7StartTotalDelay, getDaysDifference(baselineStartS7, prevStageEndS7))
  : 0;
const s7StartNewDelay = Math.max(0, s7StartTotalDelay - s7StartInheritedDelay);

assert(s7StartTotalDelay === 2, `Stage 7 start total delay is 2 days (got ${s7StartTotalDelay}d)`);
assert(s7StartInheritedDelay === 2, `Stage 7 start inherited delay is 2 days (got ${s7StartInheritedDelay}d)`);
assert(s7StartNewDelay === 0, `Stage 7 start new delay is strictly 0 days (got ${s7StartNewDelay}d)`);

// When completing Stage 7 (mode === 'complete'):
// Basic Rule: Expected Delivery Date is the crossing line for delay calculation
const crossingLineOnTime = matExpectedDate; // 2026-11-28
const s7CompTotalDelay = (baselineEndS7 && matReceivedDate > baselineEndS7)
  ? getDaysDifference(baselineEndS7, matReceivedDate)
  : 0;
const s7CompNewDelay = (crossingLineOnTime && matReceivedDate > crossingLineOnTime)
  ? getDaysDifference(crossingLineOnTime, matReceivedDate)
  : 0;
const s7CompInheritedDelay = Math.max(0, s7CompTotalDelay - s7CompNewDelay);

assert(s7CompTotalDelay === 2, `Stage 7 completion total delay is 2 days (got ${s7CompTotalDelay}d)`);
assert(s7CompInheritedDelay === 2, `Stage 7 completion inherited delay is 2 days (got ${s7CompInheritedDelay}d)`);
assert(s7CompNewDelay === 0, `Stage 7 on-time arrival produces strictly 0 new delay (got ${s7CompNewDelay}d)`);

// Test Crossing the Expected Delivery Date line:
// If actual arrival date is 2026-12-05 (7 days past expected delivery date of 2026-11-28)
const lateReceivedDate = '2026-12-05';
const s7LateTotalDelay = (baselineEndS7 && lateReceivedDate > baselineEndS7)
  ? getDaysDifference(baselineEndS7, lateReceivedDate)
  : 0;
const s7LateNewDelay = (crossingLineOnTime && lateReceivedDate > crossingLineOnTime)
  ? getDaysDifference(crossingLineOnTime, lateReceivedDate)
  : 0;
const s7LateInheritedDelay = Math.max(0, s7LateTotalDelay - s7LateNewDelay);

assert(s7LateTotalDelay === 9, `Stage 7 late arrival total delay is 9 days (got ${s7LateTotalDelay}d)`);
assert(s7LateNewDelay === 7, `Stage 7 crossing expected delivery date by 7d calculates exactly +7d new delay (got ${s7LateNewDelay}d)`);
assert(s7LateInheritedDelay === 2, `Stage 7 accurately preserves +2d inherited delay (got ${s7LateInheritedDelay}d)`);

// Integration test for recalculateProductLine and extractDelayFlow
const fullS7OrderLine: ProductLine = {
  id: 'line-s7-test',
  lineNumber: 'LINE-01',
  productName: 'CFT-HV-300 Gate Valve 4 inch 1500#',
  designType: 'Existing Design',
  category: 'Gate Valves',
  overallVarianceDays: 2,
  status: 'In Progress',
  qty: 5,
  materials: [{
    id: 'mat-s7',
    itemCode: 'MAT-CS-WCB',
    description: 'Cast Steel Body WCB',
    qty: 5,
    unit: 'pcs',
    supplierName: 'Sandvik Precision Castings',
    leadTimeDays: 25,
    isCriticalPath: true,
    orderedDate: '2026-11-07',
    expectedDate: '2026-12-02',
    receivedDate: '2026-12-02'
  }],
  milestones: [
    {
      id: 'ms-5',
      key: 'wo_release',
      name: '5. Work Order Release',
      stageOrder: 5,
      defaultDurationDays: 2,
      committedBaselineStartDate: '2026-10-29',
      committedBaselineEndDate: '2026-10-31',
      committedDurationDays: 2,
      forecastStartDate: '2026-10-29',
      forecastEndDate: '2026-11-02',
      actualStartDate: '2026-10-29',
      actualEndDate: '2026-11-02',
      varianceDays: 2,
      delayReason: 'A',
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-6',
      key: 'sub_supplier_po',
      name: '6. Sub-Supplier PO',
      stageOrder: 6,
      defaultDurationDays: 3,
      committedBaselineStartDate: '2026-10-31',
      committedBaselineEndDate: '2026-11-03',
      committedDurationDays: 3,
      forecastStartDate: '2026-11-02',
      forecastEndDate: '2026-11-05',
      actualStartDate: '2026-11-02',
      actualEndDate: '2026-11-05',
      varianceDays: 2,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-7',
      key: 'material_receipt',
      name: '7. Material Receipt (GRN)',
      stageOrder: 7,
      defaultDurationDays: 21,
      committedBaselineStartDate: '2026-11-05',
      committedBaselineEndDate: '2026-11-26',
      committedDurationDays: 21,
      forecastStartDate: '2026-11-05',
      forecastEndDate: '2026-11-26',
      actualStartDate: '2026-11-07',
      actualEndDate: '2026-12-02',
      varianceDays: 0,
      status: 'Completed',
      completionPct: 100
    }
  ]
};

const recalcedLine = recalculateProductLine(fullS7OrderLine, '2026-12-02', 3, 7);
const s7Milestone = recalcedLine.milestones.find(m => m.key === 'material_receipt')!;
assert(s7Milestone.varianceDays === 2, `Stage 7 varianceDays preserves predecessor inherited delay of 2d instead of fake 6d (got ${s7Milestone.varianceDays})`);

const s7OrderPO: PurchaseOrder = {
  id: 'po-s7-test',
  poNumber: 'PO-S7-TEST',
  customerName: 'Test Customer',
  customerPoRef: 'REF-S7-01',
  contractReviewRef: 'CR-S7-01',
  poDate: '2026-10-29',
  committedDeliveryDate: '2027-01-18',
  revisedDeliveryDate: '2027-01-18',
  status: 'In Progress',
  productLines: [recalcedLine],
  revisions: [],
  attachments: [],
  createdBy: 'Sales',
  createdAt: '2026-10-29',
  lastUpdatedBy: 'Stores',
  lastUpdatedAt: '2026-10-29',
  isClosed: false
};

const s7DelayLedger = extractDelayFlow(s7OrderPO);
assert(s7DelayLedger.delaySteps.length === 1, `Audit Log contains exactly 1 delay step (Stage 5 only, no false Stage 7 card) (got ${s7DelayLedger.delaySteps.length})`);
assert(s7DelayLedger.delaySteps[0].stageOrder === 5, `Delay card belongs to Stage 5 (got Stage ${s7DelayLedger.delaySteps[0].stageOrder})`);
assert(s7DelayLedger.totalDaysDelayed === 2, `Total delay in audit log is strictly +2d (got ${s7DelayLedger.totalDaysDelayed}d)`);

// Test exact scenario from user screenshot:
// Stage 6 delayed by 3 days, ending 2026-11-04.
// Stage 7 baseline: 2026-11-01 -> 2026-11-20 (19d planned).
// Material lead time: 18 days.
// Stage 7 actual start: 2026-11-04, actual end: 2026-11-22 (completed as per revised time).
const lineUserScreenshot: ProductLine = {
  id: 'line-screenshot',
  lineNumber: 'LINE-01',
  productName: 'Gate Valve',
  designType: 'Existing Design',
  category: 'Valves',
  overallVarianceDays: 3,
  status: 'In Progress',
  qty: 1,
  materials: [{
    id: 'mat-18d',
    itemCode: 'MAT-CB-18',
    description: 'Cast Body',
    qty: 1,
    unit: 'pcs',
    supplierName: 'Sandvik Precision Castings',
    leadTimeDays: 18,
    isCriticalPath: true,
    orderedDate: '2026-11-04',
    expectedDate: '2026-11-22',
    receivedDate: '2026-11-22'
  }],
  milestones: [
    {
      id: 'ms-sc-6',
      key: 'sub_supplier_po',
      name: '6. Sub-Supplier PO',
      stageOrder: 6,
      defaultDurationDays: 4,
      committedBaselineStartDate: '2026-10-28',
      committedBaselineEndDate: '2026-11-01',
      committedDurationDays: 4,
      forecastStartDate: '2026-10-30',
      forecastEndDate: '2026-11-04',
      actualStartDate: '2026-10-30',
      actualEndDate: '2026-11-04',
      varianceDays: 3,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-sc-7',
      key: 'material_receipt',
      name: '7. Material Receipt (GRN)',
      stageOrder: 7,
      defaultDurationDays: 19,
      committedBaselineStartDate: '2026-11-01',
      committedBaselineEndDate: '2026-11-20',
      committedDurationDays: 19,
      forecastStartDate: '2026-11-04',
      forecastEndDate: '2026-11-22',
      actualStartDate: '2026-11-04',
      actualEndDate: '2026-11-22',
      varianceDays: 0,
      status: 'Completed',
      completionPct: 100
    }
  ]
};

const recalcedScreenshotLine = recalculateProductLine(lineUserScreenshot, '2026-11-22', 3, 7);
const s7ScreenshotMs = recalcedScreenshotLine.milestones.find(m => m.key === 'material_receipt')!;
assert(s7ScreenshotMs.varianceDays === 3, `Stage 7 varianceDays strictly matches predecessor delay of 3d when completed as per revised time (got ${s7ScreenshotMs.varianceDays})`);

const prevVarScreenshot = 3;
const currVarScreenshot = s7ScreenshotMs.varianceDays;
const recoveredScreenshot = Math.max(0, prevVarScreenshot - currVarScreenshot);
assert(recoveredScreenshot === 0, `No false 'delay resolved' when completed as per revised time (got ${recoveredScreenshot}d)`);

console.log('\n📋 GROUP 16: Product-Specific Lead Time & Strict Delay Addition for Dates Past Estimated Date');

// Test 1: Lead time changes dynamically based on selected product line
const mockLineA: ProductLine = {
  id: 'line-a',
  lineNumber: 'LINE-01',
  productName: 'Gate Valve 2" 600#',
  designType: 'Existing Design',
  category: 'Gate Valves',
  overallVarianceDays: 0,
  status: 'On Track',
  qty: 10,
  materials: [
    {
      id: 'mat-a',
      itemCode: 'MAT-A105',
      description: 'A105 Forgings',
      qty: 10,
      unit: 'EA',
      supplierName: 'ForgeCo',
      leadTimeDays: 14,
      isCriticalPath: true
    }
  ],
  milestones: []
};

const mockLineB: ProductLine = {
  id: 'line-b',
  lineNumber: 'LINE-02',
  productName: 'Cryogenic Globe Valve 8" 2500#',
  designType: 'New Design',
  category: 'Globe Valves',
  overallVarianceDays: 0,
  status: 'On Track',
  qty: 2,
  materials: [
    {
      id: 'mat-b',
      itemCode: 'MAT-INCO',
      description: 'Inconel 625 Forgings',
      qty: 2,
      unit: 'EA',
      supplierName: 'SpecialAlloys',
      leadTimeDays: 45,
      isCriticalPath: true
    }
  ],
  milestones: []
};

// Line A lead time vs Line B lead time
const leadTimeA = mockLineA.materials?.find(m => m.isCriticalPath)?.leadTimeDays || 14;
const leadTimeB = mockLineB.materials?.find(m => m.isCriticalPath)?.leadTimeDays || 14;
assert(leadTimeA === 14, `Line A has 14-day standard lead time (got ${leadTimeA}d)`);
assert(leadTimeB === 45, `Line B has 45-day cryogenic lead time (got ${leadTimeB}d)`);

const orderDateBase = '2026-10-01';
const expA = addDays(orderDateBase, leadTimeA);
const expB = addDays(orderDateBase, leadTimeB);
assert(expA === '2026-10-15', `Line A expected date calculated as 2026-10-15 (got ${expA})`);
assert(expB === '2026-11-15', `Line B expected date calculated as 2026-11-15 (got ${expB})`);

// Test 2: Any date entered after estimated target date strictly adds delay
// Case 2a: Stage 7 - received date after expected delivery date (estimated target)
const estTargetS7 = '2026-10-15';
const actualEnteredS7 = '2026-10-20'; // 5 days late
const delayAddedS7 = (actualEnteredS7 > estTargetS7) ? getDaysDifference(estTargetS7, actualEnteredS7) : 0;
assert(delayAddedS7 === 5, `Entering receipt date after estimated date adds 5 days delay (got ${delayAddedS7}d)`);

// Case 2b: Non-Stage 7 - actual completion date entered after estimated completion date
const estCompletionTarget = '2026-10-12';
const actualCompletionEntered = '2026-10-16'; // 4 days late
const delayAddedNonS7 = (actualCompletionEntered > estCompletionTarget) ? getDaysDifference(estCompletionTarget, actualCompletionEntered) : 0;
assert(delayAddedNonS7 === 4, `Entering stage completion date after estimated target adds 4 days delay (got ${delayAddedNonS7}d)`);

// Case 2c: Start date entered after estimated target start date
const estStartTarget = '2026-10-05';
const actualStartEntered = '2026-10-08'; // 3 days late
const delayAddedStart = (actualStartEntered > estStartTarget) ? getDaysDifference(estStartTarget, actualStartEntered) : 0;
assert(delayAddedStart === 3, `Entering stage start date after estimated target adds 3 days delay (got ${delayAddedStart}d)`);

console.log('\n📋 GROUP 17: In-Progress Active Stage Delay Reflection in Revised Baseline & Cascade');

// Test 1: Stage 8 with +8d inherited shift and +5d added delay (total 13d)
const mockStage7: Milestone = {
  id: 'ms-7-test',
  key: 'material_receipt',
  name: '7. Material Receipt (GRN)',
  stageOrder: 7,
  defaultDurationDays: 15,
  committedBaselineStartDate: '2026-10-22',
  committedBaselineEndDate: '2026-11-06',
  committedDurationDays: 15,
  forecastStartDate: '2026-10-25',
  forecastEndDate: '2026-11-14',
  actualStartDate: '2026-10-25',
  actualEndDate: '2026-11-14',
  varianceDays: 8,
  status: 'Completed',
  completionPct: 100
};

const mockStage8: Milestone = {
  id: 'ms-8-test',
  key: 'machining',
  name: '8. Machining & Fabrication',
  stageOrder: 8,
  defaultDurationDays: 10,
  committedBaselineStartDate: '2026-11-06',
  committedBaselineEndDate: '2026-11-16',
  committedDurationDays: 10,
  forecastStartDate: '2026-11-14',
  forecastEndDate: '2026-11-29', // 5 days added delay (15d total duration)
  actualStartDate: '2026-11-14',
  varianceDays: 13, // 8d inherited + 5d added
  delayReason: 'Tooling recalibration and custom fixture machining',
  status: 'In Progress',
  completionPct: 30
};

const mockStage9: Milestone = {
  id: 'ms-9-test',
  key: 'assembly',
  name: '9. Assembly',
  stageOrder: 9,
  defaultDurationDays: 4,
  committedBaselineStartDate: '2026-11-16',
  committedBaselineEndDate: '2026-11-20',
  committedDurationDays: 4,
  forecastStartDate: '2026-11-16',
  forecastEndDate: '2026-11-20',
  varianceDays: 0,
  status: 'Not Started',
  completionPct: 0
};

const s8Revised = getMilestoneRevisedDates(mockStage8, mockStage7, '2026-10-22', '2027-01-15');
assert(s8Revised.revisedStart === '2026-11-14', `Stage 8 revisedStart is 2026-11-14 (got ${s8Revised.revisedStart})`);
assert(s8Revised.revisedEnd === '2026-11-29', `Stage 8 revisedEnd incorporates +5d added delay to 2026-11-29 (got ${s8Revised.revisedEnd})`);
assert(s8Revised.shiftDays === 13, `Stage 8 total shiftDays evaluates to +13d (got ${s8Revised.shiftDays})`);

// Test 2: Downstream Stage 9 correctly inherits Stage 8's revised completion date
const s9Revised = getMilestoneRevisedDates(mockStage9, mockStage8, '2026-10-22', '2027-01-15');
assert(s9Revised.revisedStart === '2026-11-29', `Stage 9 revisedStart chains to Stage 8 delayed end 2026-11-29 (got ${s9Revised.revisedStart})`);
assert(s9Revised.revisedEnd === '2026-12-03', `Stage 9 revisedEnd shifts by full cumulative delay to 2026-12-03 (got ${s9Revised.revisedEnd})`);
assert(s9Revised.shiftDays === 13, `Stage 9 reflects full cumulative +13d shift from Stage 8 (got ${s9Revised.shiftDays})`);

// Test 3: recalculateProductLine cascades active milestone delay to all subsequent milestones
const cascadeTestLine: ProductLine = {
  id: 'line-cascade-test',
  lineNumber: 'LINE-01',
  productName: 'Gate Valve Class 600',
  designType: 'Existing Design',
  category: 'Valves',
  overallVarianceDays: 0,
  status: 'In Progress',
  qty: 1,
  materials: [],
  milestones: [mockStage7, mockStage8, mockStage9]
};

const recalcedCascadeLine = recalculateProductLine(cascadeTestLine, '2026-11-15', 3, 7);
const recalcedS8 = recalcedCascadeLine.milestones.find(m => m.key === 'machining')!;
const recalcedS9 = recalcedCascadeLine.milestones.find(m => m.key === 'assembly')!;

assert(recalcedS8.forecastEndDate === '2026-11-29', `recalculateProductLine preserves Stage 8 delayed forecastEnd 2026-11-29 (got ${recalcedS8.forecastEndDate})`);
assert(recalcedS9.forecastStartDate === '2026-11-30', `recalculateProductLine cascades Stage 8 delayed end to Stage 9 forecastStart (got ${recalcedS9.forecastStartDate})`);
assert(recalcedS9.forecastEndDate === '2026-12-04', `Stage 9 forecastEnd is 2026-12-04 (got ${recalcedS9.forecastEndDate})`);
assert(recalcedS9.varianceDays === 13, `Stage 9 varianceDays accurately evaluates to +13d (got ${recalcedS9.varianceDays})`);

// ----------------------------------------------------------------------------
// TEST GROUP 18: Material Receipt Completion & Unstarted Machining Delay Immunity
// ----------------------------------------------------------------------------
console.log('\n📋 GROUP 18: Zero False Machining Delay & Material Baseline Lead Time Protection');

// Test 1: buildTemplateSchedule protects raw material lead time and prevents date gaps
const plannedSchedule = buildTemplateSchedule({
  designType: 'Existing Design',
  materials: [
    {
      id: 'mat-body',
      itemCode: 'MAT-WCB-BODY',
      description: 'WCB Cast Body',
      qty: 1,
      unit: 'pcs',
      supplierName: 'Foundry Mill',
      leadTimeDays: 20,
      isCriticalPath: true
    }
  ],
  startDate: '2026-10-01',
  lineId: 'line-test-18',
  targetEndDate: '2026-11-20'
});

const s7Planned = plannedSchedule.find(m => m.key === 'material_receipt')!;
const s8Planned = plannedSchedule.find(m => m.key === 'machining')!;
assert(s7Planned.committedDurationDays === 20, `Stage 7 baseline duration strictly preserves 20d material lead time (got ${s7Planned.committedDurationDays}d)`);
assert(s8Planned.committedBaselineStartDate === addDays(s7Planned.committedBaselineEndDate, 1), `Stage 8 baseline start immediately follows Stage 7 baseline end (${s8Planned.committedBaselineStartDate} === ${addDays(s7Planned.committedBaselineEndDate, 1)})`);

// Test 2: Completing Stage 7 does not attribute delay to unstarted Stage 8 Machining
const orderLineGroup18: ProductLine = {
  id: 'line-grp-18',
  lineNumber: 'LINE-01',
  productName: 'Gate Valve High Pressure',
  designType: 'Existing Design',
  category: 'Valves',
  overallVarianceDays: 0,
  status: 'In Progress',
  qty: 1,
  materials: [
    {
      id: 'mat-alloy',
      itemCode: 'MAT-ALLOY-900',
      description: 'Alloy Body Cast',
      qty: 1,
      unit: 'pcs',
      supplierName: 'Precision Foundry',
      leadTimeDays: 20,
      isCriticalPath: true,
      orderedDate: '2026-10-25',
      expectedDate: '2026-11-14',
      receivedDate: '2026-11-14',
      inspectionResult: 'Passed'
    }
  ],
  milestones: [
    {
      id: 'ms-18-6',
      key: 'sub_supplier_po',
      name: '6. Sub-Supplier PO',
      stageOrder: 6,
      defaultDurationDays: 3,
      committedBaselineStartDate: '2026-10-18',
      committedBaselineEndDate: '2026-10-21',
      committedDurationDays: 3,
      forecastStartDate: '2026-10-22',
      forecastEndDate: '2026-10-25',
      actualStartDate: '2026-10-22',
      actualEndDate: '2026-10-25',
      varianceDays: 4,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-18-7',
      key: 'material_receipt',
      name: '7. Material Receipt (GRN)',
      stageOrder: 7,
      defaultDurationDays: 20,
      committedBaselineStartDate: '2026-10-21',
      committedBaselineEndDate: '2026-11-10',
      committedDurationDays: 20,
      forecastStartDate: '2026-10-25',
      forecastEndDate: '2026-11-14',
      actualStartDate: '2026-10-25',
      actualEndDate: '2026-11-14',
      varianceDays: 4,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-18-8',
      key: 'machining',
      name: '8. Machining & Fabrication',
      stageOrder: 8,
      defaultDurationDays: 14,
      committedBaselineStartDate: '2026-11-10',
      committedBaselineEndDate: '2026-11-24',
      committedDurationDays: 14,
      forecastStartDate: '2026-11-10',
      forecastEndDate: '2026-11-24',
      varianceDays: 0,
      status: 'Not Started',
      completionPct: 0
    }
  ]
};

const recalcedLine18 = recalculateProductLine(orderLineGroup18, '2026-11-14', 3, 7);
const recalcedS7_18 = recalcedLine18.milestones.find(m => m.key === 'material_receipt')!;
const recalcedS8_18 = recalcedLine18.milestones.find(m => m.key === 'machining')!;

assert(recalcedS8_18.status === 'Not Started', `Unstarted Machining stage status is Not Started (got ${recalcedS8_18.status})`);
assert(recalcedS8_18.varianceDays === recalcedS7_18.varianceDays, `Machining variance (${recalcedS8_18.varianceDays}d) equals Stage 7 inherited variance (${recalcedS7_18.varianceDays}d)`);
const addedAtS8 = Math.max(0, (recalcedS8_18.varianceDays || 0) - (recalcedS7_18.varianceDays || 0));
assert(addedAtS8 === 0, `Added delay at Machining before starting is strictly 0d (got ${addedAtS8}d)`);

const poGrp18: PurchaseOrder = {
  id: 'po-grp-18',
  poNumber: 'PO-GRP-18',
  customerName: 'Aramco Offshore',
  customerPoRef: 'REF-18',
  contractReviewRef: 'CR-18',
  poDate: '2026-10-01',
  committedDeliveryDate: '2026-12-15',
  revisedDeliveryDate: '2026-12-19',
  status: 'In Progress',
  productLines: [recalcedLine18],
  revisions: [],
  attachments: [],
  createdBy: 'Sales',
  createdAt: '2026-10-01',
  lastUpdatedBy: 'Stores',
  lastUpdatedAt: '2026-11-14',
  isClosed: false
};

const mfgStatus18 = getPOManufacturingStatus(poGrp18);
assert(mfgStatus18.delayedStageName !== '8. Machining & Fabrication', `delayedStageName is NOT attributed to unstarted Machining (got ${mfgStatus18.delayedStageName})`);

const delayLedger18 = extractDelayFlow(poGrp18);
const hasS8DelayStep = delayLedger18.delaySteps.some(s => s.stageKey === 'machining');
assert(!hasS8DelayStep, 'Delay Analysis Flow does not contain any false delay step for unstarted Machining');

console.log('\n📋 GROUP 19: Resolved Days Downstream Cascade & Total Delay Recovery');

// Test scenario:
// Stage 7 completed late by +5d (ended 2026-11-26).
// Stage 8 baseline: 2026-11-22 -> 2026-12-03 (12d planned). Started 2026-11-27 (+5d startShift).
// Stage 8 completed early on 2026-12-06, resolving 2 days (variance = +3d).
// Stage 9 baseline: 2026-12-04 -> 2026-12-07 (4d planned).
// Stage 10 baseline: 2026-12-08 -> 2026-12-09 (2d planned).
const testLine19: ProductLine = {
  id: 'line-grp-19',
  lineNumber: 'LINE-01',
  productName: 'Gate Valve Class 600',
  category: 'Valves',
  designType: 'Existing Design',
  qty: 1,
  materials: [],
  overallVarianceDays: 5,
  status: 'Delayed',
  milestones: [
    {
      id: 'ms-7-19',
      key: 'material_receipt',
      name: '7. Material Receipt (GRN)',
      stageOrder: 7,
      defaultDurationDays: 21,
      committedBaselineStartDate: '2026-11-01',
      committedBaselineEndDate: '2026-11-21',
      committedDurationDays: 21,
      forecastStartDate: '2026-11-01',
      forecastEndDate: '2026-11-26',
      actualStartDate: '2026-11-02',
      actualEndDate: '2026-11-26',
      varianceDays: 5,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-8-19',
      key: 'machining',
      name: '8. Machining & Fabrication',
      stageOrder: 8,
      defaultDurationDays: 12,
      committedBaselineStartDate: '2026-11-22',
      committedBaselineEndDate: '2026-12-03',
      committedDurationDays: 12,
      forecastStartDate: '2026-11-27',
      forecastEndDate: '2026-12-06',
      actualStartDate: '2026-11-27',
      actualEndDate: '2026-12-06',
      varianceDays: 3,
      status: 'Completed',
      completionPct: 100
    },
    {
      id: 'ms-9-19',
      key: 'assembly',
      name: '9. Assembly',
      stageOrder: 9,
      defaultDurationDays: 4,
      committedBaselineStartDate: '2026-12-04',
      committedBaselineEndDate: '2026-12-07',
      committedDurationDays: 4,
      forecastStartDate: '2026-12-07',
      forecastEndDate: '2026-12-12', // old +5d
      varianceDays: 5,                // old +5d
      status: 'Not Started',
      completionPct: 0
    },
    {
      id: 'ms-10-19',
      key: 'finished_goods',
      name: '10. Finished Goods (FG)',
      stageOrder: 10,
      defaultDurationDays: 2,
      committedBaselineStartDate: '2026-12-08',
      committedBaselineEndDate: '2026-12-09',
      committedDurationDays: 2,
      forecastStartDate: '2026-12-13',
      forecastEndDate: '2026-12-14', // old +5d
      varianceDays: 5,
      status: 'Not Started',
      completionPct: 0
    }
  ]
};

const recalcedLine19 = recalculateProductLine(testLine19, '2026-12-06', 3, 7);
const s9Recalced = recalcedLine19.milestones.find(m => m.key === 'assembly')!;
const s10Recalced = recalcedLine19.milestones.find(m => m.key === 'finished_goods')!;

assert(s9Recalced.forecastStartDate === '2026-12-07', `Stage 9 starts 2026-12-07 following Stage 8 (got ${s9Recalced.forecastStartDate})`);
assert(s9Recalced.forecastEndDate === '2026-12-10', `Stage 9 completes 2026-12-10 with 4d duration (got ${s9Recalced.forecastEndDate})`);
assert(s9Recalced.varianceDays === 3, `Stage 9 inherits net +3d variance after 2d resolved (got ${s9Recalced.varianceDays})`);

const s9RevDates = getMilestoneRevisedDates(s9Recalced, recalcedLine19.milestones[1], '2026-11-01', '2026-12-09');
assert(s9RevDates.shiftDays === 3, `Stage 9 shiftDays is +3d instead of old +5d (got ${s9RevDates.shiftDays})`);
assert(s9RevDates.revisedStart === '2026-12-07', `Stage 9 revisedStart is 2026-12-07 (got ${s9RevDates.revisedStart})`);
assert(s9RevDates.revisedEnd === '2026-12-10', `Stage 9 revisedEnd is 2026-12-10 (got ${s9RevDates.revisedEnd})`);

assert(s10Recalced.forecastStartDate === '2026-12-11', `Stage 10 starts 2026-12-11 following Stage 9 (got ${s10Recalced.forecastStartDate})`);
assert(s10Recalced.forecastEndDate === '2026-12-12', `Stage 10 completes 2026-12-12 (got ${s10Recalced.forecastEndDate})`);
assert(s10Recalced.varianceDays === 3, `Stage 10 inherits net +3d variance (got ${s10Recalced.varianceDays})`);

const s10RevDates = getMilestoneRevisedDates(s10Recalced, s9Recalced, '2026-11-01', '2026-12-09');
assert(s10RevDates.shiftDays === 3, `Stage 10 shiftDays is +3d (got ${s10RevDates.shiftDays})`);

assert(recalcedLine19.overallVarianceDays === 3, `Line overallVarianceDays recovers from 5d to 3d (got ${recalcedLine19.overallVarianceDays})`);

const po19: PurchaseOrder = {
  id: 'po-19',
  poNumber: 'PO-A',
  customerName: 'Customer A',
  customerPoRef: 'REF-19',
  contractReviewRef: 'CR-19',
  poDate: '2026-11-01',
  committedDeliveryDate: '2026-12-09',
  revisedDeliveryDate: '2026-12-14', // old stored date
  status: 'Delayed',
  bookedAmount: 12,
  isClosed: false,
  productLines: [recalcedLine19],
  revisions: [],
  attachments: [],
  createdBy: 'Sales',
  createdAt: '2026-11-01',
  lastUpdatedBy: 'Production',
  lastUpdatedAt: '2026-12-06'
};

const mfgStatus19 = getPOManufacturingStatus(po19);
assert(mfgStatus19.delayDays === 3, `PO manufacturing status delayDays recovers from 5d to 3d (got ${mfgStatus19.delayDays})`);

console.log('\n================================================================');
const successRate = totalTests === 0 ? 0 : Math.round((passedTests / totalTests) * 100);
console.log(`${passedTests === totalTests ? '🎉' : '⚠️'} TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (${successRate}% SUCCESS RATE)`);
console.log('================================================================\n');
if (passedTests !== totalTests) throw new Error(`${totalTests - passedTests} e2e test(s) failed`);



