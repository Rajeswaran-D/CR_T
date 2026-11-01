import type { PurchaseOrder, MilestoneStatus } from '../types';
import { getDaysDifference } from '../services/calculationEngine';

export interface POStatusSummary {
  currentStageKey: string;
  currentStageName: string;
  statusTag: MilestoneStatus;
  progressPercent: number;
  completedStagesCount: number;
  totalStagesCount: number;
  isDelayed: boolean;
  delayDays: number;
  delayedStageName?: string;
  delayReason?: string;
  activeMilestone?: any;
  productLineName: string;
  designType: string;
  timelineValidationStatus: 'VALIDATED_OK' | 'REQUIRES_REVISION_DELAYED' | 'CLOSED';
  timelineMessage: string;
  lastRevNum: number;
}

export function getPOManufacturingStatus(po: PurchaseOrder): POStatusSummary {
  if (!po.productLines || po.productLines.length === 0) {
    return {
      currentStageKey: 'po_from_customer',
      currentStageName: '1. Customer Purchase Order (PO)',
      statusTag: 'In Progress',
      progressPercent: 0,
      completedStagesCount: 0,
      totalStagesCount: 14,
      isDelayed: false,
      delayDays: 0,
      productLineName: 'Manufacturing Line',
      designType: 'Existing Design',
      timelineValidationStatus: 'VALIDATED_OK',
      timelineMessage: 'Timeline Validated — Standard Schedule',
      lastRevNum: 0
    };
  }

  const lineEntries = po.productLines.flatMap(line =>
    (line.milestones || []).map(milestone => ({ line, milestone }))
  );
  const firstLine = po.productLines[0];
  const firstLineMilestones = firstLine?.milestones || [];
  const totalStagesCount = firstLineMilestones.length || 14;
  const completedStagesCount = firstLineMilestones.filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length;
  const progressPercent = totalStagesCount > 0 ? Math.round((completedStagesCount / totalStagesCount) * 100) : 0;

  const allCompleted = totalStagesCount > 0 && completedStagesCount === totalStagesCount && po.productLines.every(l =>
    (l.milestones || []).length > 0 && (l.milestones || []).every(m => m.status === 'Completed' || Boolean(m.actualEndDate))
  );
  const isOrderFinished = po.isClosed || (allCompleted && po.status === 'Completed');

  // Find the earliest active milestone across every product line.
  const activeEntry = lineEntries
    .filter(({ milestone }) => milestone.status !== 'Completed' && !milestone.actualEndDate)
    .sort((a, b) => a.milestone.stageOrder - b.milestone.stageOrder)[0]
    || lineEntries.sort((a, b) => b.milestone.stageOrder - a.milestone.stageOrder)[0];
  const line = activeEntry?.line || firstLine;
  const milestones = line?.milestones || [];
  const activeMilestone = activeEntry?.milestone || milestones[milestones.length - 1];

  // Highest net recorded variance across all product lines in the PO
  const maxPOVariance = Math.max(...po.productLines.map(l => l.overallVarianceDays || 0), 0);

  // Comprehensive check of line delays (final milestone variance, date shift past baseline, or last completed stage variance)
  const lineDelays = po.productLines.map(pLine => {
    const msList = pLine.milestones || [];
    const lineVar = Math.max(0, typeof pLine.overallVarianceDays === 'number' ? pLine.overallVarianceDays : 0);
    
    // Check final milestone of line
    const lastMs = msList[msList.length - 1];
    const lastMsVar = lastMs ? Math.max(0, typeof lastMs.varianceDays === 'number' ? lastMs.varianceDays : 0) : 0;
    const lastMsBaseEnd = po.committedDeliveryDate || lastMs?.committedBaselineEndDate;
    const lastMsDiff = (lastMs?.actualEndDate && lastMsBaseEnd && lastMs.actualEndDate > lastMsBaseEnd)
      ? getDaysDifference(lastMsBaseEnd, lastMs.actualEndDate)
      : 0;

    // Check last completed milestone
    const completedMsList = msList.filter(m => m.status === 'Completed' || Boolean(m.actualEndDate));
    const lastDone = completedMsList[completedMsList.length - 1];
    const lastDoneVar = lastDone ? Math.max(0, typeof lastDone.varianceDays === 'number' ? lastDone.varianceDays : 0) : 0;
    const isFinalDone = lastDone && (lastDone.stageOrder === msList.length || lastDone.key === 'shipment');
    const lastDoneBaseEnd = lastDone?.committedBaselineEndDate;
    const lastDoneActualEnd = lastDone?.actualEndDate;
    const lastDoneDiff = (isFinalDone && lastDoneActualEnd && lastDoneBaseEnd && lastDoneActualEnd > lastDoneBaseEnd)
      ? getDaysDifference(lastDoneBaseEnd, lastDoneActualEnd)
      : 0;

    return Math.max(lineVar, lastMsVar, lastMsDiff, lastDoneVar, lastDoneDiff);
  });

  const maxFinalLineEnd = (po.productLines && po.productLines.length > 0)
    ? po.productLines.reduce((latest, l) => {
        const lastMs = (l.milestones || []).slice(-1)[0];
        const end = lastMs?.actualEndDate || lastMs?.forecastEndDate || lastMs?.committedBaselineEndDate;
        if (!latest) return end || '';
        return end && end > latest ? end : latest;
      }, '')
    : '';
  const effectiveRevisedDeliveryDate = maxFinalLineEnd || po.revisedDeliveryDate;

  const poDateDiff = (effectiveRevisedDeliveryDate && po.committedDeliveryDate && effectiveRevisedDeliveryDate > po.committedDeliveryDate)
    ? getDaysDifference(po.committedDeliveryDate, effectiveRevisedDeliveryDate)
    : 0;

  const actualDeliveryDiff = (po.actualDeliveryDate && po.committedDeliveryDate && po.actualDeliveryDate > po.committedDeliveryDate)
    ? getDaysDifference(po.committedDeliveryDate, po.actualDeliveryDate)
    : 0;

  const totalCalculatedDelay = Math.max(0, maxPOVariance, ...lineDelays, poDateDiff, actualDeliveryDiff);

  // Find all stages that actually introduced a delay (stageDelta > 0 or explicit delay reason with positive variance)
  const delayOriginEntries: Array<{
    line: typeof line;
    milestone: typeof activeMilestone;
    delta: number;
    varianceDays: number;
    delayReason?: string;
  }> = [];

  po.productLines.forEach(pLine => {
    const mList = [...(pLine.milestones || [])].sort((a, b) => a.stageOrder - b.stageOrder);
    for (let i = 0; i < mList.length; i++) {
      const ms = mList[i];
      const prev = i > 0 ? mList[i - 1] : null;
      const currVar = Math.max(
        0,
        typeof ms.varianceDays === 'number'
          ? ms.varianceDays
          : (ms.actualEndDate && ms.committedBaselineEndDate && ms.actualEndDate > ms.committedBaselineEndDate)
            ? getDaysDifference(ms.committedBaselineEndDate, ms.actualEndDate)
            : 0
      );
      const prevVar = prev
        ? Math.max(
            0,
            typeof prev.varianceDays === 'number'
              ? prev.varianceDays
              : (prev.actualEndDate && prev.committedBaselineEndDate && prev.actualEndDate > prev.committedBaselineEndDate)
                ? getDaysDifference(prev.committedBaselineEndDate, prev.actualEndDate)
                : 0
          )
        : 0;
      const delta = currVar - prevVar;
      const isUnstarted = !ms.actualStartDate && !ms.actualEndDate && ms.status !== 'Completed' && ms.status !== 'In Progress';
      const hasExplicitReason = Boolean(ms.delayReason) && !ms.delayReason?.startsWith('Inherited') && !ms.delayReason?.startsWith('Cascaded');

      if (!isUnstarted && ((delta > 0 && currVar > 0) || (hasExplicitReason && currVar > 0))) {
        delayOriginEntries.push({
          line: pLine,
          milestone: ms,
          delta: Math.max(delta, 0),
          varianceDays: currVar,
          delayReason: ms.delayReason
        });
      }
    }
  });

  // Root delay entry prioritization:
  // 1. Stage with an explicit non-inherited delay reason
  // 2. Stage with the largest incremental delay added (delta)
  // 3. Earliest stage that introduced delay
  const entryWithExplicitReason = delayOriginEntries.find(e => e.delayReason && !e.delayReason.startsWith('Inherited') && !e.delayReason.startsWith('Cascaded'));
  const entryWithMaxDelta = [...delayOriginEntries].sort((a, b) => b.delta - a.delta)[0];
  const rootDelayEntry = entryWithExplicitReason || entryWithMaxDelta || delayOriginEntries[0];

  let stageName = activeMilestone ? getStageFriendlyName(activeMilestone.key, line) : '1. Customer Purchase Order (PO)';

  if (isOrderFinished) {
    stageName = '14. Final Shipment & Dispatch';
  }

  const statusTag: MilestoneStatus = isOrderFinished 
    ? 'Completed' 
    : (activeMilestone?.actualStartDate || activeMilestone?.status === 'In Progress' ? 'In Progress' : (activeMilestone?.status || 'In Progress'));

  const activeMilestoneVariance = activeMilestone && !activeMilestone.actualEndDate && typeof activeMilestone.varianceDays === 'number' && activeMilestone.varianceDays > 0
    ? activeMilestone.varianceDays
    : 0;

  // Active delay flag for ongoing work
  const isDelayed = !isOrderFinished && (totalCalculatedDelay > 0 || activeMilestoneVariance > 0);

  // Delayed stage name matches the actual stage where the delay originated
  // Net delay days: preserved on finished/closed orders as well as active delayed orders
  const delayDays = isOrderFinished
    ? totalCalculatedDelay
    : (isDelayed ? Math.max(totalCalculatedDelay, activeMilestoneVariance) : 0);

  // Delayed stage name matches the actual stage where the delay originated (only if order is delayed)
  const delayedStageName = (delayDays > 0 && rootDelayEntry && rootDelayEntry.varianceDays > 0)
    ? getStageFriendlyName(rootDelayEntry.milestone.key, rootDelayEntry.line)
    : (delayDays > 0 && activeMilestone && (activeMilestone.actualStartDate || activeMilestone.actualEndDate)
      ? getStageFriendlyName(activeMilestone.key, line)
      : (delayDays > 0 && delayOriginEntries[0] ? getStageFriendlyName(delayOriginEntries[0].milestone.key, delayOriginEntries[0].line) : undefined));

  const delayReason = delayDays > 0
    ? ((rootDelayEntry?.delayReason && !rootDelayEntry.delayReason.startsWith('Inherited'))
        ? rootDelayEntry.delayReason
        : (line.delayReason && !line.delayReason.startsWith('Inherited')
          ? line.delayReason
          : (rootDelayEntry ? rootDelayEntry.milestone.name : (delayedStageName || activeMilestone?.name))))
    : undefined;

  const lastRevNum = (po.revisions && po.revisions.length > 0) ? po.revisions.length - 1 : 0;

  let timelineValidationStatus: 'VALIDATED_OK' | 'REQUIRES_REVISION_DELAYED' | 'CLOSED' = 'VALIDATED_OK';
  let timelineMessage = `On schedule for committed delivery on ${po.revisedDeliveryDate || po.committedDeliveryDate} (Rev ${lastRevNum} Approved).`;

  if (po.isClosed) {
    timelineValidationStatus = 'CLOSED';
    timelineMessage = delayDays > 0
      ? `Order closed & delivered to client with +${delayDays}d delay — Final Rev ${lastRevNum} archived.`
      : `Order closed & delivered to client on schedule — Final Rev ${lastRevNum} archived.`;
  } else if (po.status === 'Baseline Pending') {
    timelineValidationStatus = 'REQUIRES_REVISION_DELAYED';
    timelineMessage = `Baseline approval pending — Awaiting PM baseline sign-off before manufacturing kickoff.`;
  } else if (isDelayed) {
    timelineValidationStatus = 'REQUIRES_REVISION_DELAYED';
    timelineMessage = `Action Required: +${delayDays}d delay at ${delayedStageName || 'Production'}. Schedule review needed.`;
  } else if (allCompleted) {
    timelineValidationStatus = 'VALIDATED_OK';
    timelineMessage = delayDays > 0
      ? `All manufacturing stages completed with +${delayDays}d delay — Ready for final dispatch sign-off and closure (Rev ${lastRevNum}).`
      : `All manufacturing stages completed — Ready for final dispatch sign-off and closure (Rev ${lastRevNum}).`;
  } else {
    timelineValidationStatus = 'VALIDATED_OK';
    timelineMessage = `On schedule for committed delivery on ${po.revisedDeliveryDate || po.committedDeliveryDate} (Rev ${lastRevNum} Approved).`;
  }

  return {
    currentStageKey: activeMilestone?.key || 'po_from_customer',
    currentStageName: stageName,
    statusTag,
    progressPercent: isOrderFinished ? 100 : progressPercent,
    completedStagesCount: isOrderFinished ? totalStagesCount : completedStagesCount,
    totalStagesCount,
    isDelayed,
    delayDays,
    delayedStageName,
    delayReason,
    activeMilestone,
    productLineName: line.productName,
    designType: line.designType,
    timelineValidationStatus,
    timelineMessage,
    lastRevNum
  };
}

export function getStageFriendlyName(key: string, _line?: any): string {
  switch (key) {
    case 'po_from_customer': return '1. Customer Purchase Order (PO)';
    case 'pm_baseline':
    case 'baseline_review': return '2. Baseline Review & Planning';
    case 'corb_release': return '3. CORB Release';
    case 'bom_release': return '4. BOM Release';
    case 'wo_release': return '5. Work Order (WO) Release';
    case 'sub_supplier_po': return '6. Sub-Supplier PO';
    case 'material_receipt':
    case 'raw_material':
    case 'incoming_inspection': return '7. Material Receipt (GRN)';
    case 'machining': return '8. Machining & Fabrication';
    case 'assembly':
    case 'production': return '9. Assembly';
    case 'fg':
    case 'qc_pass': return '10. Finished Goods (FG)';
    case 'customer_inspection': return '11. Customer Inspection';
    case 'painting': return '12. Painting';
    case 'trn': return '13. TRN';
    case 'shipment':
    case 'dispatch':
    case 'delivery': return '14. Shipment & Dispatch';
    default: return key;
  }
}
