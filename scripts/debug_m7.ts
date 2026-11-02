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

console.log('Materials:', JSON.stringify(line.materials, null, 2));
const m7 = line.milestones[6];
console.log('Milestone 7:', JSON.stringify(m7, null, 2));
