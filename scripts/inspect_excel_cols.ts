import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(process.cwd(), 'One_Mock_Order_Formatted.xlsx');
const buf = fs.readFileSync(filePath);
const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

console.log('Row 0 (Header Row 1):', data[0]?.length);
console.log('Row 1 (Header Row 2):', data[1]?.length);
console.log('Row 2 (Data Row 1):', data[2]?.length);

for (let col = 0; col < (data[1] || data[0]).length; col++) {
  const h1 = data[0]?.[col] || '';
  const h2 = data[1]?.[col] || '';
  const val = data[2]?.[col] !== undefined ? data[2][col] : '';
  if (h1 || h2 || val) {
    console.log(`Col ${col.toString().padStart(2, ' ')}: [${h1}] -> [${h2}] = ${val}`);
  }
}
