const fs = require('fs');
const file = 'src/services/calculationEngine.ts';
let code = fs.readFileSync(file, 'utf8');

const isCrlf = code.includes('\r\n');
if (isCrlf) {
  code = code.replace(/\r\n/g, '\n');
}

// 1. Fix normalizeLineDates: if (start && end && end < start) end = start;
const bugStart = `    if (start && end && end < start) {
      start = end;
    }`;
const fixStart = `    if (start && end && end < start) end = start;`;

if (code.includes(bugStart)) {
  code = code.replace(bugStart, fixStart);
  console.log('Fixed normalizeLineDates start/end ordering');
}

// 2. Replace the variance calculation section in recalculateProductLine
const vStartStr = '    const effEnd = ms.actualEndDate || forecastEnd;\n    let varianceDays: number;';
const vEndStr = '    let status: MilestoneStatus = ms.status;';

const vStartIdx = code.indexOf(vStartStr);
const vEndIdx = code.indexOf(vEndStr);

if (vStartIdx === -1 || vEndIdx === -1) {
  console.error('Variance block markers not found!', vStartIdx, vEndIdx);
  process.exit(1);
}

const newVarianceBlock = `    const effEnd = ms.actualEndDate || forecastEnd;
    let varianceDays: number;

    const prevMs = msIndex > 0 ? updatedMilestones[msIndex - 1] : undefined;
    const inheritedDelay = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;

    if (isMaterialStage) {
      const matLeadTime = (criticalMat && typeof criticalMat.leadTimeDays === 'number' && criticalMat.leadTimeDays > 0)
        ? criticalMat.leadTimeDays
        : duration;
      const targetOrderStart = (ms.committedBaselineStartDate && forecastStart > ms.committedBaselineStartDate)
        ? forecastStart
        : (ms.committedBaselineStartDate || forecastStart);
      const targetDelivery = targetOrderStart ? addDays(targetOrderStart, Math.max(0, matLeadTime - 1)) : forecastEnd;
      const revisedTarget = ms.committedBaselineEndDate
        ? addDays(ms.committedBaselineEndDate, inheritedDelay)
        : forecastEnd;
      const crossingLine = criticalMat?.expectedDate || revisedTarget || targetDelivery || ms.committedBaselineEndDate;

      if (ms.actualEndDate) {
        if (crossingLine && ms.actualEndDate > crossingLine) {
          const newDelay = getDaysDifference(crossingLine, ms.actualEndDate);
          varianceDays = inheritedDelay + newDelay;
        } else if (crossingLine && ms.actualEndDate < crossingLine) {
          const baselineDiff = ms.committedBaselineEndDate
            ? getDaysDifference(ms.committedBaselineEndDate, ms.actualEndDate)
            : 0;
          const daysEarly = getDaysDifference(ms.actualEndDate, crossingLine);
          // Recover time from crossing line, but physical variance cannot fall below baseline deviation when late against baseline
          varianceDays = Math.max(baselineDiff, inheritedDelay - daysEarly);
        } else {
          varianceDays = inheritedDelay;
        }
      } else {
        if (forecastEnd && crossingLine && forecastEnd > crossingLine) {
          const newDelay = getDaysDifference(crossingLine, forecastEnd);
          varianceDays = inheritedDelay + newDelay;
        } else {
          varianceDays = inheritedDelay;
        }
      }
    } else {
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
    }

`;

code = code.slice(0, vStartIdx) + newVarianceBlock + code.slice(vEndIdx);

// 3. Add calculateContractualDeliveryVariance if not present
if (!code.includes('export function calculateContractualDeliveryVariance')) {
  const helperCode = `
/**
 * Calculates customer contractual delivery variance and delivery risk.
 * 
 * Separates the 3 critical schedule metrics:
 * 1. Individual milestone variance = effEnd - committedBaselineEndDate
 * 2. Overall manufacturing schedule variance = finalMilestone.varianceDays
 * 3. Customer contractual delivery variance = projectedDeliveryDate - committedDeliveryDate
 */
export function calculateContractualDeliveryVariance(
  committedDeliveryDate: string,
  projectedDeliveryDate: string
): {
  contractualVarianceDays: number;
  isContractuallyDelayed: boolean;
  isContractuallyAtRisk: boolean;
  bufferDaysRemaining: number;
} {
  if (!isValidDateString(committedDeliveryDate) || !isValidDateString(projectedDeliveryDate)) {
    return {
      contractualVarianceDays: 0,
      isContractuallyDelayed: false,
      isContractuallyAtRisk: false,
      bufferDaysRemaining: 0
    };
  }

  const diff = getDaysDifference(committedDeliveryDate, projectedDeliveryDate);
  return {
    contractualVarianceDays: diff, // > 0 means delivery breaches customer contract; < 0 means ahead of contract
    isContractuallyDelayed: diff > 0,
    isContractuallyAtRisk: diff > -3 && diff <= 0,
    bufferDaysRemaining: Math.max(0, -diff)
  };
}
`;
  code += helperCode;
}

if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(file, code, 'utf8');
console.log('Successfully updated calculationEngine.ts with production-ready logic');
