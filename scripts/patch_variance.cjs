const fs = require('fs');
const file = 'src/services/calculationEngine.ts';
let code = fs.readFileSync(file, 'utf8');

const startStr = '    if (isMaterialStage) {';
const endStr = '    let status: MilestoneStatus = ms.status;';

const startIdx = code.indexOf(startStr);
const endIdx = code.indexOf(endStr);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const target = code.substring(startIdx, endIdx);

const replacement = `const prevMs = msIndex > 0 ? updatedMilestones[msIndex - 1] : undefined;
    const inheritedDelay = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;

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

`;

code = code.slice(0, startIdx) + '    ' + replacement + code.slice(endIdx);
fs.writeFileSync(file, code, 'utf8');
console.log('Successfully updated calculationEngine.ts');

