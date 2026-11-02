const fs = require('fs');
const file = 'src/services/csvImportService.ts';
let code = fs.readFileSync(file, 'utf8');

const isCrlf = code.includes('\r\n');
if (isCrlf) {
  code = code.replace(/\r\n/g, '\n');
}

const targetStart = `      // Apply historical completion dates, bridge omitted stages, and activate the real live stage
      let runningChainDate = effectivePoDate;`;

const targetEnd = `      const rawProductLine: ProductLine = {
        id: lineId,`;

const startIdx = code.indexOf(targetStart);
const endIdx = code.indexOf(targetEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('Target markers not found in csvImportService.ts!', startIdx, endIdx);
  process.exit(1);
}

const replacement = `      // Apply historical completion dates, bridge omitted stages, and activate the real live stage
      let runningChainDate = effectivePoDate;
      let runningCumulativeDelay = 0;

      const configuredMilestones: Milestone[] = baseMilestones.map((m, mIdx) => {
        const explicitActualEnd = rawLine.stageActualDates[m.key];
        const actualEnd = inferredActualDates[m.key];
        const excelDelay = rawLine.stageDelays[m.key];
        const isCompleted = mIdx <= maxCompletedIndex;
        const isActiveStage = mIdx === maxCompletedIndex + 1;

        const alignedBase = alignedBaselines[mIdx];
        const explicitPlannedEnd = rawLine.stagePlannedDates[m.key];
        const effectivePlannedEnd = explicitPlannedEnd || alignedBase.end;
        const baselineStart = alignedBase.start > effectivePlannedEnd ? effectivePlannedEnd : alignedBase.start;
        const baselineDuration = Math.max(1, getDaysDifference(baselineStart, effectivePlannedEnd) + 1);

        // Calculate and preserve distinct revised target dates separate from actual entered dates
        const revisedTargetStart = addDays(baselineStart, runningCumulativeDelay);
        const revisedTargetEnd = addDays(effectivePlannedEnd, runningCumulativeDelay);

        let delayReason = m.delayReason;
        let delayCategory = m.delayCategory;
        let varianceDays = 0;

        if (actualEnd || isCompleted) {
          // Completed milestone (either explicitly dated in Excel or auto-bridged operational predecessor)
          const isExplicit = Boolean(explicitActualEnd);
          // Use explicit actual date from Excel when present; otherwise use inferred or planned date.
          const effectiveActualEnd = explicitActualEnd || actualEnd || effectivePlannedEnd;
          const actualStart = actualEnd
            ? ((m.key === 'material_receipt' && effectiveMatOrderDate)
              ? effectiveMatOrderDate
              : (runningChainDate <= effectiveActualEnd ? runningChainDate : effectiveActualEnd))
            : baselineStart;
          runningChainDate = effectiveActualEnd > runningChainDate ? effectiveActualEnd : runningChainDate;

          let calculatedDelay = 0;
          if (effectivePlannedEnd && effectiveActualEnd && effectiveActualEnd > effectivePlannedEnd) {
            calculatedDelay = getDaysDifference(effectivePlannedEnd, effectiveActualEnd);
          }
          // The milestone's variance against original baseline:
          // If the milestone ended on or after its revised timeline, its variance is at least runningCumulativeDelay.
          // This ensures that completing as per the revised timeline never creates a false 'delay resolved'.
          const effectiveDelay = Math.max(
            calculatedDelay,
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            effectiveActualEnd >= revisedTargetEnd ? runningCumulativeDelay : 0
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : \`\${m.name} delayed by +\${effectiveDelay}d (Planned: \${effectivePlannedEnd}, Actual: \${effectiveActualEnd})\`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          } else if (effectiveActualEnd < effectivePlannedEnd) {
            varianceDays = getDaysDifference(effectivePlannedEnd, effectiveActualEnd);
          }

          // Update running cumulative delay for downstream milestones
          runningCumulativeDelay = Math.max(0, varianceDays);

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
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

          const effectiveDelay = Math.max(
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            runningCumulativeDelay
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : \`\${m.name} delayed by +\${effectiveDelay}d vs planned target (\${effectivePlannedEnd})\`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          }

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
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
          const stageStart = runningChainDate > revisedTargetStart ? runningChainDate : revisedTargetStart;
          const stageForecastEnd = addDays(stageStart, baselineDuration - 1);
          runningChainDate = addDays(stageForecastEnd, 1);

          const effectiveDelay = Math.max(
            excelDelay !== undefined && excelDelay > 0 ? excelDelay : 0,
            runningCumulativeDelay
          );

          if (effectiveDelay > 0) {
            varianceDays = effectiveDelay;
            delayReason = (rawLine.remarks && rawLine.remarks.trim())
              ? rawLine.remarks.trim()
              : \`\${m.name} projected delay +\${effectiveDelay}d\`;
            delayCategory = getDelayCategoryForMilestone(m.key);
          }

          return {
            ...m,
            committedBaselineStartDate: baselineStart,
            committedBaselineEndDate: effectivePlannedEnd,
            currentBaselineEndDate: revisedTargetEnd,
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

`;

code = code.slice(0, startIdx) + replacement + code.slice(endIdx);

if (isCrlf) {
  code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(file, code, 'utf8');
console.log('Successfully updated csvImportService.ts with robust bulk import dates');
