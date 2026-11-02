const fs = require('fs');
const file = 'src/services/csvImportService.ts';
let code = fs.readFileSync(file, 'utf8');

const isCrlf = code.includes('\r\n');
if (isCrlf) {
  code = code.replace(/\r\n/g, '\n');
}

// In isActiveStage, set status to In Progress (or Delayed / At Risk) while keeping actualStartDate undefined if not explicitly provided
code = code.replace(
  `status: hasExplicitActualStart
              ? ((effectiveDelay > 3 ? 'Delayed' : (effectiveDelay > 0 ? 'At Risk' : 'In Progress')) as MilestoneStatus)
              : ('Not Started' as MilestoneStatus),`,
  `status: (effectiveDelay > 3 ? 'Delayed' : (effectiveDelay > 0 ? 'At Risk' : 'In Progress')) as MilestoneStatus,`
);

if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(file, code, 'utf8');
console.log('Updated isActiveStage status in csvImportService.ts');
