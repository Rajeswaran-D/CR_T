import * as XLSX from 'xlsx';
import { parseAndValidateCsv, workbookToCsv } from '../src/services/csvImportService';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'One_Mock_Order_Formatted.xlsx');
const buf = fs.readFileSync(filePath);
const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
const csvContent = workbookToCsv(workbook);
const res = parseAndValidateCsv(csvContent, [], [], []);

const po = res.previewPOs[0];
const line = po.productLines[0];

console.log('==================================================================================================================');
console.log('PO:', po.poNumber, '| Customer:', po.customerName, '| Overall Line Variance:', line.overallVarianceDays, '| Status:', line.status);
console.log('==================================================================================================================');

line.milestones.forEach(m => {
  console.log(`Stage ${m.stageOrder.toString().padStart(2, ' ')}. [${m.key}] ${m.name}`);
  console.log(`   Committed Baseline: ${m.committedBaselineStartDate} -> ${m.committedBaselineEndDate} (${m.committedDurationDays}d)`);
  console.log(`   Revised Target End: ${m.currentBaselineEndDate || '-'}`);
  console.log(`   Actual Event Dates: ${m.actualStartDate || '          '} -> ${m.actualEndDate || '          '}`);
  console.log(`   Forecast Dates:     ${m.forecastStartDate} -> ${m.forecastEndDate}`);
  console.log(`   Status: ${m.status.padEnd(11, ' ')} | Variance: ${m.varianceDays >= 0 ? '+' : ''}${m.varianceDays}d | Reason: ${m.delayReason || '-'}`);
  console.log('------------------------------------------------------------------------------------------------------------------');
});
