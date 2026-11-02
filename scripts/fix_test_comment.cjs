const fs = require('fs');
let c = fs.readFileSync('src/tests/e2eTestRunner.ts', 'utf8');
const target = "line1.milestones[3].actualStartDate = '2026-08-14';\nline1.milestones[3].actualEndDate = '2026-08-14';";
const replacement = "line1.milestones[3].actualStartDate = '2026-08-15';\nline1.milestones[3].actualEndDate = '2026-08-15';";

c = c.replace(/\r\n/g, '\n');
c = c.replace(target, replacement);
fs.writeFileSync('src/tests/e2eTestRunner.ts', c, 'utf8');
console.log('Fixed test date');

