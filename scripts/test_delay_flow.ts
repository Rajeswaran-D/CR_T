import * as XLSX from 'xlsx';
import { parseAndValidateCsv, workbookToCsv } from '../src/services/csvImportService';
import { extractDelayFlow } from '../src/components/common/DelayAnalysisFlow';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'One_Mock_Order_Formatted.xlsx');
const buf = fs.readFileSync(filePath);
const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
const csvContent = workbookToCsv(workbook);
const res = parseAndValidateCsv(csvContent, [], [], []);

const po = res.previewPOs[0];
const flow = extractDelayFlow(po);

console.log('=== DELAY FLOW FOR PRJ-2026-006 ===');
console.log('hasDelays:', flow.hasDelays);
console.log('hasHistoricalDelays:', flow.hasHistoricalDelays);
console.log('isRecovered:', flow.isRecovered);
console.log('netVarianceDays:', flow.netVarianceDays);
console.log('totalDaysDelayed:', flow.totalDaysDelayed);
console.log('totalDaysRecovered:', flow.totalDaysRecovered);
console.log('Root Cause:', flow.rootDelayStep?.stageName);

console.log('--- DELAY STEPS ---');
flow.delaySteps.forEach(s => {
  console.log(`Stage ${s.stageOrder} (${s.stageName}): added=${s.stageDelayAdded}d, cum=${s.cumulativeDelay}d, isRecovery=${s.isRecovery}, isRoot=${s.isRootCause}, reason=${s.delayReason}`);
});
