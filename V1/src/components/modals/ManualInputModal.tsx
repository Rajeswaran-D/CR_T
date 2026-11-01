import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { Milestone, ProductLine, PurchaseOrder } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { getDaysDifference, todayLocal, addDays, getMilestoneRevisedDates } from '../../services/calculationEngine';

interface ManualInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  productLine: ProductLine;
  milestone: Milestone;
  eventType: 'start' | 'complete';
}

export const ManualInputModal: React.FC<ManualInputModalProps> = ({
  isOpen,
  onClose,
  po,
  productLine,
  milestone,
  eventType
}) => {
  const { updateMilestoneEvent, activeRole, purchaseOrders } = useApp();
  const todayStr = todayLocal();

  // Retrieve freshest references from store to avoid role-switch stale props
  const currentPo = purchaseOrders.find(p => p.id === po.id) || po;
  const currentProductLine = currentPo.productLines.find(l => l.id === productLine.id) || productLine;
  const currentMilestone = currentProductLine.milestones.find(m => m.id === milestone.id) || milestone;

  const msIndex = currentProductLine.milestones.findIndex(m => m.key === currentMilestone.key);
  const previousMs = msIndex > 0 ? currentProductLine.milestones[msIndex - 1] : undefined;
  // Use actualEndDate as the authoritative previous end — this is what the chain must start from
  const previousMsActualEnd = previousMs?.actualEndDate;
  const prevEffectiveEnd = previousMsActualEnd || previousMs?.forecastEndDate;
  // Floor for completion date must only be an actual event (actual start or previous actual end)
  const currentMsStart = currentMilestone.actualStartDate || previousMsActualEnd;

  const dur = Math.max(1, currentMilestone.committedDurationDays || 1);
  const isMaterialStage = currentMilestone.key === 'material_receipt';
  const criticalMat = currentProductLine.materials?.find(m => m.isCriticalPath) || currentProductLine.materials?.[0];
  const matLeadTime = criticalMat?.leadTimeDays || currentMilestone.committedDurationDays || 14;

  const plannedStart = currentMilestone.committedBaselineStartDate || currentMilestone.forecastStartDate || todayStr;
  const chainedStart = previousMsActualEnd ? addDays(previousMsActualEnd, 1) : undefined;
  const effectiveTargetStart = (chainedStart && plannedStart && chainedStart > plannedStart)
    ? chainedStart
    : plannedStart;

  const defaultOrderDate = criticalMat?.orderedDate || currentMilestone.actualStartDate || effectiveTargetStart;
  const defaultExpectedDate = criticalMat?.expectedDate || addDays(defaultOrderDate, Math.max(0, matLeadTime - 1));

  const rawDefault = eventType === 'start'
    ? (currentMilestone.actualStartDate || effectiveTargetStart)
    : isMaterialStage
    ? (currentMilestone.actualEndDate || criticalMat?.receivedDate || defaultExpectedDate || todayStr)
    : (currentMilestone.actualEndDate || currentMilestone.forecastEndDate || currentMilestone.committedBaselineEndDate || todayStr);

  const defaultInitialDate = rawDefault;

  const [eventDate, setEventDate] = useState<string>(defaultInitialDate);
  const [targetEndDate, setTargetEndDate] = useState<string>(
    currentMilestone.forecastEndDate || addDays(defaultInitialDate, dur - 1)
  );
  const [backdateReason, setBackdateReason] = useState<string>('');
  const [customDelayReason, setCustomDelayReason] = useState<string>('');
  
  // Material Receipt Specific
  const [orderedDate, setOrderedDate] = useState<string>(defaultOrderDate);
  const [expectedDate, setExpectedDate] = useState<string>(defaultExpectedDate);
  const [inspectionResult, setInspectionResult] = useState<'Passed' | 'Rejected' | 'Pending'>(criticalMat?.inspectionResult || 'Passed');

  // Design Specific
  const [approvalRef, setApprovalRef] = useState<string>('');
  const [drawingNo, setDrawingNo] = useState<string>('');
  const [ecnNo, setEcnNo] = useState<string>('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setEventDate(defaultInitialDate);
    setTargetEndDate(currentMilestone.forecastEndDate || addDays(defaultInitialDate, dur - 1));
    setBackdateReason('');
    setCustomDelayReason('');
    setOrderedDate(defaultOrderDate);
    setExpectedDate(defaultExpectedDate);
    setInspectionResult(criticalMat?.inspectionResult || 'Passed');
    setErrorMessage(null);
  }, [isOpen, currentMilestone.id, eventType, defaultInitialDate, defaultOrderDate, defaultExpectedDate, dur]);

  if (!isOpen) return null;

  const handleOrderDateChange = (newOrderDate: string) => {
    const minFloor = previousMsActualEnd || prevEffectiveEnd || baselineStart;
    const enforcedDate = (minFloor && newOrderDate && newOrderDate < minFloor) ? minFloor : newOrderDate;
    setOrderedDate(enforcedDate);
    if (enforcedDate) {
      const newExpected = addDays(enforcedDate, Math.max(0, matLeadTime - 1));
      setExpectedDate(newExpected);
      // If completing Stage 7 and received date is default, sync with expected date
      if (eventType === 'complete' && (!eventDate || eventDate === expectedDate || eventDate === defaultExpectedDate)) {
        setEventDate(newExpected);
      }
    }
  };

  const isRoleAuthorized = isMilestoneOwnedByRole(currentMilestone.key, activeRole);
  const isPreviousDone = !previousMs || previousMs.status === 'Completed' || Boolean(previousMs.actualEndDate) || previousMs.completionPct === 100;

  const baselineStart = currentMilestone.committedBaselineStartDate || currentPo.poDate;
  const baselineEnd = currentMilestone.committedBaselineEndDate || currentPo.committedDeliveryDate;
  const baselineDuration = (baselineStart && baselineEnd) ? Math.max(1, getDaysDifference(baselineStart, baselineEnd) + 1) : dur;

  // Single canonical date calculation across all roles - stable target benchmark
  const canonicalDates = getMilestoneRevisedDates(currentMilestone, previousMs, currentPo.poDate, currentPo.committedDeliveryDate);

  const targetRevisedStart = canonicalDates.revisedStart;
  const targetRevisedEnd = canonicalDates.revisedEnd;

  const activeStartShift = (baselineStart && targetRevisedStart && targetRevisedStart > baselineStart)
    ? getDaysDifference(baselineStart, targetRevisedStart)
    : 0;
  const activeEndShift = (baselineEnd && targetRevisedEnd && targetRevisedEnd > baselineEnd)
    ? getDaysDifference(baselineEnd, targetRevisedEnd)
    : 0;
  const precedingStartDelay = Math.max(activeStartShift, activeEndShift);

  const minAllowedDate = eventType === 'start'
    ? (previousMsActualEnd || prevEffectiveEnd || baselineStart)
    : (currentMilestone.actualStartDate || previousMsActualEnd || prevEffectiveEnd || baselineStart);

  let totalDelay = 0;
  let inheritedDelayDays = 0;
  let newDelayFormed = 0;
  let resolvedDelayDays = 0;
  let revisedTarget = '';

  const simulationChainedStart = prevEffectiveEnd ? addDays(prevEffectiveEnd, 1) : undefined;
  const targetStart = (simulationChainedStart && baselineStart && simulationChainedStart > baselineStart)
    ? simulationChainedStart
    : (currentMilestone.forecastStartDate || baselineStart || simulationChainedStart || '');

  inheritedDelayDays = (baselineStart && targetStart && targetStart > baselineStart)
    ? getDaysDifference(baselineStart, targetStart)
    : 0;

  if (isMaterialStage) {
    const targetDelivery = targetStart ? addDays(targetStart, Math.max(0, matLeadTime - 1)) : (currentMilestone.forecastEndDate || baselineEnd);
    const crossingLine = expectedDate || targetDelivery || baselineEnd;

    if (eventType === 'start') {
      if (orderedDate && targetStart && orderedDate > targetStart) {
        newDelayFormed = getDaysDifference(targetStart, orderedDate);
        totalDelay = inheritedDelayDays + newDelayFormed;
      } else if (orderedDate && targetStart && orderedDate <= targetStart) {
        newDelayFormed = 0;
        if (baselineStart && orderedDate > baselineStart) {
          totalDelay = getDaysDifference(baselineStart, orderedDate);
          resolvedDelayDays = Math.max(0, inheritedDelayDays - totalDelay);
        } else {
          totalDelay = 0;
          resolvedDelayDays = inheritedDelayDays;
        }
      } else {
        totalDelay = inheritedDelayDays;
      }
      revisedTarget = targetStart || baselineStart || '';
    } else {
      // Expected Delivery Date is the crossing line for Stage 7 delay calculation
      if (eventDate && crossingLine && eventDate > crossingLine) {
        newDelayFormed = getDaysDifference(crossingLine, eventDate);
        totalDelay = inheritedDelayDays + newDelayFormed;
      } else if (eventDate && crossingLine && eventDate <= crossingLine) {
        newDelayFormed = 0;
        if (baselineEnd && eventDate > baselineEnd) {
          totalDelay = getDaysDifference(baselineEnd, eventDate);
          resolvedDelayDays = Math.max(0, inheritedDelayDays - totalDelay);
        } else {
          totalDelay = 0;
          resolvedDelayDays = inheritedDelayDays;
        }
      } else {
        totalDelay = inheritedDelayDays;
      }
      revisedTarget = crossingLine || baselineEnd || '';
    }
  } else if (eventType === 'start') {
    const normalEnd = addDays(eventDate, Math.max(1, dur) - 1);
    const endLateDays = (targetEndDate && normalEnd && targetEndDate > normalEnd)
      ? getDaysDifference(normalEnd, targetEndDate)
      : 0;

    if (targetStart && eventDate && eventDate > targetStart) {
      const startLateDays = getDaysDifference(targetStart, eventDate);
      newDelayFormed = startLateDays + endLateDays;
      totalDelay = inheritedDelayDays + newDelayFormed;
    } else if (targetStart && eventDate && eventDate <= targetStart) {
      newDelayFormed = endLateDays;
      if (endLateDays > 0) {
        totalDelay = inheritedDelayDays + endLateDays;
      } else if (baselineStart && eventDate > baselineStart) {
        totalDelay = getDaysDifference(baselineStart, eventDate);
        resolvedDelayDays = Math.max(0, inheritedDelayDays - totalDelay);
      } else {
        totalDelay = 0;
        resolvedDelayDays = inheritedDelayDays;
      }
    } else {
      totalDelay = inheritedDelayDays;
    }
    revisedTarget = endLateDays > 0 ? targetEndDate : (targetStart || baselineStart || '');
  } else {
    const effectiveStart = currentMilestone.actualStartDate || targetStart;
    const targetEnd = currentMilestone.forecastEndDate || (effectiveStart ? addDays(effectiveStart, Math.max(1, dur) - 1) : baselineEnd);
    if (targetEnd && eventDate && eventDate > targetEnd) {
      newDelayFormed = getDaysDifference(targetEnd, eventDate);
      totalDelay = inheritedDelayDays + newDelayFormed;
    } else if (targetEnd && eventDate && eventDate <= targetEnd) {
      newDelayFormed = 0;
      if (baselineEnd && eventDate > baselineEnd) {
        totalDelay = getDaysDifference(baselineEnd, eventDate);
        resolvedDelayDays = Math.max(0, inheritedDelayDays - totalDelay);
      } else {
        totalDelay = 0;
        resolvedDelayDays = inheritedDelayDays;
      }
    } else {
      totalDelay = inheritedDelayDays;
    }
    revisedTarget = targetEnd || baselineEnd || '';
  }

  const isBackdated = eventDate < todayStr;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isRoleAuthorized) {
      setErrorMessage(`Unauthorized: Your active role (${activeRole}) is not permitted to complete milestone '${milestone.name}'. Exclusive access is restricted to its respective role.`);
      return;
    }    if (!isPreviousDone) {
      setErrorMessage(`Milestone Locked: Milestone '${previousMs?.name}' must be marked completed first before '${currentMilestone.name}' can be updated.`);
      return;
    }

    const effectiveDocRef = `WO-AUTO-${eventDate.replace(/-/g, '')}`;

    if (eventType === 'start' && minAllowedDate && eventDate < minAllowedDate) {
      setErrorMessage(`Start date cannot be earlier than previous milestone completion (${minAllowedDate}).`);
      return;
    }

    if (eventType === 'complete' && currentMsStart && eventDate < currentMsStart) {
      setErrorMessage(`Completion date cannot be earlier than milestone start date (${currentMsStart}).`);
      return;
    }

    if (isBackdated && !backdateReason.trim()) {
      setErrorMessage('A written justification is mandatory for backdated event entries.');
      return;
    }

    if (currentMilestone.key === 'design_approval' && eventType === 'complete' && !approvalRef.trim()) {
      setErrorMessage('Customer Drawing Approval Reference is mandatory for completing Design Stage.');
      return;
    }

    if (newDelayFormed > 0 && !customDelayReason.trim()) {
      setErrorMessage(`A delay reason is required because the date entered (${eventDate}) adds +${newDelayFormed}d delay beyond the revised plan (${revisedTarget}).`);
      return;
    }

    const effectiveDelayReason = customDelayReason.trim()
      ? customDelayReason.trim()
      : undefined;

    const res = updateMilestoneEvent({
      poId: currentPo.id,
      productLineId: currentProductLine.id,
      milestoneKey: currentMilestone.key,
      eventType,
      eventDate,
      targetEndDate: eventType === 'start' ? targetEndDate : undefined,
      user: `${activeRole} User`,
      docRef: effectiveDocRef,
      backdateReason: isBackdated ? backdateReason : undefined,
      approvalRef: approvalRef || undefined,
      drawingNo: drawingNo || undefined,
      ecnNo: ecnNo || undefined,
      delayReason: effectiveDelayReason,
      orderedDate: isMaterialStage ? orderedDate : undefined,
      expectedDate: isMaterialStage ? expectedDate : undefined,
      receivedDate: isMaterialStage && eventType === 'complete' ? eventDate : undefined,
      inspectionResult: isMaterialStage ? inspectionResult : undefined
    });

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to update milestone event');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-800">
        
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-base">
                {eventType === 'start' && currentMilestone.actualStartDate 
                  ? 'Edit / Re-enter Stage Start Date' 
                  : eventType === 'start' 
                  ? 'Record Stage Start Date' 
                  : 'Record Stage Completion'}
              </span>
              <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                eventType === 'start' && currentMilestone.actualStartDate 
                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
              }`}>
                {eventType === 'start' && currentMilestone.actualStartDate ? 'EDIT START' : eventType.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">PO: {currentPo.poNumber} | Line: {currentProductLine.lineNumber}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0 flex flex-col justify-between">
          <div className="p-6 space-y-4 text-xs flex-1">
          
          {!isRoleAuthorized && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Role Access Restricted:</span>
                <p className="mt-0.5">
                  Milestone <strong className="text-slate-900">'{currentMilestone.name}'</strong> belongs to its dedicated department role. Your active role (<span className="font-bold text-amber-950">{activeRole}</span>) cannot modify or complete this stage.
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Validation Error:</span>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900">{currentMilestone.name}</div>
              <span className="font-mono text-[10px] font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                {baselineDuration} days planned
              </span>
            </div>
            <div className="space-y-1.5 pt-1.5 border-t border-slate-200/60 font-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-600">
                <span>Planned Baseline: <strong className="text-slate-800">{baselineStart || 'N/A'} &rarr; {baselineEnd || 'N/A'}</strong></span>
                <span className="text-[10px] text-slate-500 font-semibold">{baselineDuration} days planned</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-200/40">
                <span className={precedingStartDelay > 0 ? "text-amber-800" : "text-emerald-700"}>
                  Revised Target: <strong className={precedingStartDelay > 0 ? "text-amber-950" : "text-emerald-900"}>{targetRevisedStart || baselineStart || 'N/A'} &rarr; {targetRevisedEnd || baselineEnd || 'N/A'}</strong>
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  precedingStartDelay > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}>
                  {precedingStartDelay > 0 ? `+${precedingStartDelay}d shift` : 'On original baseline'}
                </span>
              </div>
            </div>
          </div>

          {/* Raw Material Procurement Schedule (Stage 7 Specific) */}
          {isMaterialStage && (
            <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-bold text-emerald-950 text-xs">
                  Raw Material Procurement Schedule
                </div>
                <span className="text-[10px] font-mono text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300 font-bold">
                  Lead Time: {matLeadTime}d ({criticalMat?.itemCode || 'Critical Material'})
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-700">
                      Material Order Placement Date
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500">
                        Plan: {baselineStart} | Rev: {targetRevisedStart}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOrderDateChange(todayStr)}
                        className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer"
                      >
                        Today
                      </button>
                    </div>
                  </div>
                  <input
                    type="date"
                    min={previousMsActualEnd || baselineStart}
                    value={orderedDate}
                    onChange={(e) => handleOrderDateChange(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-medium focus:outline-none focus:border-emerald-600"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">PO issued to sub-supplier / casting mill</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-700">
                      Expected Delivery Date (Crossing Line)
                    </label>
                    <span className="text-[10px] font-mono text-slate-500">
                      Plan: {baselineEnd} | Rev: {targetRevisedEnd}
                    </span>
                  </div>
                  <input
                    type="date"
                    min={orderedDate || previousMsActualEnd || baselineStart}
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-emerald-400 rounded-lg text-xs font-mono font-bold text-emerald-950 focus:outline-none focus:border-emerald-600"
                  />
                  <p className="text-[10px] text-emerald-800 font-medium mt-0.5">Crossing line for receipt delay (+{matLeadTime}d Lead)</p>
                </div>
              </div>
            </div>
          )}

          {/* Event Date (Primary Input) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-slate-700 font-semibold">
                {isMaterialStage 
                  ? (eventType === 'start' ? 'Stage 7 Start Date (Order Placed)' : 'Actual Material Received Date (GRN Date)')
                  : eventType === 'start' 
                  ? (milestone.actualStartDate ? 'Re-enter Start Date' : 'Actual Start Date') 
                  : 'Actual Completion Date'} <span className="text-rose-600">*</span>
              </label>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  Planned: <strong>{eventType === 'start' ? baselineStart : baselineEnd}</strong>
                </span>
                <span className={precedingStartDelay > 0 ? "text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold" : "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold"}>
                  Revised: <strong>{eventType === 'start' ? targetRevisedStart : targetRevisedEnd}</strong>
                </span>
              </div>
            </div>
            <input
              type="date"
              min={minAllowedDate}
              value={eventDate}
              onChange={(e) => {
                const nextVal = e.target.value;
                const enforcedVal = (eventType === 'start' && minAllowedDate && nextVal && nextVal < minAllowedDate)
                  ? minAllowedDate
                  : nextVal;
                setEventDate(enforcedVal);
                if (eventType === 'start' && enforcedVal) {
                  setTargetEndDate(addDays(enforcedVal, Math.max(1, baselineDuration) - 1));
                }
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600 font-medium font-mono"
            />
            {Boolean(minAllowedDate && eventDate && eventDate < minAllowedDate) && (
              <p className="text-[11px] text-rose-600 font-bold mt-1 flex items-center gap-1 font-mono">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {eventType === 'start'
                  ? `Start date cannot be earlier than previous milestone completion (${minAllowedDate}).`
                  : `Completion date cannot be earlier than start date (${minAllowedDate}).`}
              </p>
            )}
            {eventType === 'start' && !isMaterialStage && (
              <div className="mt-3 pt-3 border-t border-slate-200/80">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-700 text-xs">Target / Projected Completion Date</span>
                  <span className="text-[10px] text-slate-500 font-mono">Duration: {dur}d planned</span>
                </div>
                <input
                  type="date"
                  min={eventDate || minAllowedDate}
                  value={targetEndDate}
                  onChange={(e) => setTargetEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600 font-medium font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Baseline duration target is {addDays(eventDate, Math.max(1, baselineDuration) - 1)}. Extend this date if additional execution delay is expected for this stage.
                </p>
              </div>
            )}
            {isMaterialStage && eventType === 'complete' && (
              <p className="text-[11px] text-slate-500 mt-1">
                Pre-filled with the calculated expected delivery date. Change this date if the material arrived earlier or later (late receival will calculate delay automatically).
              </p>
            )}
          </div>

          {/* Material Receipt Incoming Inspection (Stage 7 Specific) */}
          {isMaterialStage && eventType === 'complete' && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-700">
                Incoming Inspection Result <span className="text-rose-600">*</span>
              </label>
              <select
                value={inspectionResult}
                onChange={(e) => setInspectionResult(e.target.value as any)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:outline-none focus:border-emerald-600"
              >
                <option value="Passed">Passed (Approved for Machining)</option>
                <option value="Pending">Pending (Inspection in progress)</option>
                <option value="Rejected">Rejected (Non-conformance raised)</option>
              </select>
            </div>
          )}

          {/* Status feedback & Delay Calculation */}
          {totalDelay <= 0 ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] font-semibold flex items-center justify-between">
              <span>Within Planned Time — No delay detected.</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            </div>
          ) : newDelayFormed > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>New Delay Formed at <strong>Stage {milestone.stageOrder}: {milestone.name.replace(/^\d+\.\s*/, '')}</strong>: <strong className="text-rose-700">+{newDelayFormed}d Added</strong></span>
                </div>
                {inheritedDelayDays > 0 && (
                  <span className="text-[10px] font-mono text-slate-500">(+{inheritedDelayDays}d prior inherited)</span>
                )}
              </div>
              <div className="space-y-2">
                {(() => {
                  const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                  const prevDelaysList = prevMilestones
                    .map((m, mIdx) => {
                      const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                      const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                      const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                      const stageDelta = currVar - prevVar;
                      return { ...m, calculatedDelayDays: stageDelta };
                    })
                    .filter(m => m.calculatedDelayDays > 0);

                  return (
                    <>
                      {inheritedDelayDays > 0 && prevDelaysList.length > 0 && (
                        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-0.5 text-[10px] font-mono text-amber-900">
                          <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                          {prevDelaysList.map((m, i) => (
                            <div key={i} className="truncate">
                              • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                              {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                            </div>
                          ))}
                          <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                            <span>Total Cumulative Delay:</span>
                            <span className="text-rose-700 font-bold">+{totalDelay}d</span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <label className="block text-rose-950 font-bold text-xs">
                  Reason for +{newDelayFormed}d Delay Formed at this Stage <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Explain reason for this stage's delay (e.g. Sub-tier casting delay / NDT re-inspection)..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-slate-900 font-bold text-xs focus:outline-none focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                  required
                />
              </div>
            </div>
          ) : totalDelay <= 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {inheritedDelayDays > 0 
                      ? `Schedule Fully Recovered: All prior delay resolved! (+${inheritedDelayDays}d recovered at Stage ${milestone.stageOrder})`
                      : 'Schedule Status: On Track — Selected date is within planned baseline.'}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300">
                  0d Delay
                </span>
              </div>

              {inheritedDelayDays > 0 && (() => {
                const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                const prevDelaysList = prevMilestones
                  .map((m, mIdx) => {
                    const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return { ...m, calculatedDelayDays: stageDelta };
                  })
                  .filter(m => m.calculatedDelayDays > 0);

                if (prevDelaysList.length === 0) return null;

                return (
                  <div className="p-2 bg-emerald-100/60 border border-emerald-200 rounded-lg space-y-0.5 text-[10px] font-mono text-emerald-900">
                    <div className="font-bold text-emerald-950">Prior Delay Resolution:</div>
                    {prevDelaysList.map((m, i) => (
                      <div key={i} className="truncate">
                        • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <span className="line-through text-slate-500">+{m.calculatedDelayDays}d</span> <strong className="text-emerald-700">Resolved</strong>
                      </div>
                    ))}
                    <div className="pt-0.5 font-bold text-emerald-950 border-t border-emerald-300/60 flex justify-between">
                      <span>Net Cumulative Delay:</span>
                      <span className="text-emerald-700 font-bold">0d (On Time)</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : resolvedDelayDays > 0 ? (
            <div className="space-y-3">
              <div className="p-3 bg-teal-50 border border-teal-300 rounded-xl text-teal-950 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>
                    Schedule Accelerated: <strong className="text-teal-700 font-mono">+{resolvedDelayDays}d Delay Resolved</strong> (Net delay reduced from +{inheritedDelayDays}d to +{totalDelay}d)
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-teal-900 bg-white px-2 py-0.5 rounded border border-teal-300">
                  Net Delay: +{totalDelay}d
                </span>
              </div>

              {(() => {
                const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                const prevDelaysList = prevMilestones
                  .map((m, mIdx) => {
                    const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return { ...m, calculatedDelayDays: stageDelta };
                  })
                  .filter(m => m.calculatedDelayDays > 0);

                if (prevDelaysList.length === 0) return null;

                return (
                  <div className="p-2 bg-teal-100/50 border border-teal-200 rounded-lg space-y-0.5 text-[10px] font-mono text-teal-900">
                    <div className="font-bold text-teal-950">Preceding Delay Sources & Resolution:</div>
                    {prevDelaysList.map((m, i) => (
                      <div key={i} className="truncate">
                        • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                        {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                      </div>
                    ))}
                    <div className="truncate text-teal-800 font-semibold">
                      • Stage {milestone.stageOrder}: {milestone.name.replace(/^\d+\.\s*/, '')}: <strong className="text-emerald-700">-{resolvedDelayDays}d Delay Resolved</strong> (Ahead of revised target)
                    </div>
                    <div className="pt-0.5 font-bold text-teal-950 border-t border-teal-200 flex justify-between">
                      <span>Net Cumulative Delay:</span>
                      <span className="text-amber-800 font-bold">+{totalDelay}d</span>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <label className="block text-slate-700 font-medium text-xs">
                  Optional Notes
                </label>
                <input
                  type="text"
                  placeholder="Optional notes or remarks (e.g. Schedule accelerated due to overtime)..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-teal-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-teal-600 font-medium"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px] font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{inheritedDelayDays}d Inherited</strong> (No new delay formed at Stage {milestone.stageOrder})</span>
                </div>
                <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                  Total Delay: +{totalDelay}d
                </span>
              </div>

              {(() => {
                const prevMilestones = (productLine.milestones || []).slice(0, msIndex);
                const prevDelaysList = prevMilestones
                  .map((m, mIdx) => {
                    const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return { ...m, calculatedDelayDays: stageDelta };
                  })
                  .filter(m => m.calculatedDelayDays > 0);

                if (inheritedDelayDays <= 0 || prevDelaysList.length === 0) return null;

                return (
                  <div className="p-2 bg-blue-100/60 border border-blue-200 rounded-lg space-y-0.5 text-[10px] font-mono text-blue-900">
                    <div className="font-bold text-blue-950">Preceding Delay Sources:</div>
                    {prevDelaysList.map((m, i) => (
                      <div key={i} className="truncate">
                        • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                        {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                      </div>
                    ))}
                    <div className="pt-0.5 font-bold text-blue-950 border-t border-blue-200/60 flex justify-between">
                      <span>Total Cumulative Delay:</span>
                      <span className="text-rose-700 font-bold">+{totalDelay}d</span>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <label className="block text-slate-700 font-medium text-xs">
                  Optional Notes (defaults to 'Inherited delay (+{inheritedDelayDays}d)')
                </label>
                <input
                  type="text"
                  placeholder="Optional notes or remarks..."
                  value={customDelayReason}
                  onChange={(e) => setCustomDelayReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-blue-600 font-medium"
                />
              </div>
            </div>
          )}

          {isBackdated && (
            <div>
              <label className="block text-amber-800 font-semibold mb-1">
                Backdate Justification <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={2}
                placeholder="Explain reason for backdated entry..."
                value={backdateReason}
                onChange={(e) => setBackdateReason(e.target.value)}
                className="w-full px-3 py-2 bg-amber-50/50 border border-amber-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-amber-600"
              />
            </div>
          )}

          {/* Design Milestone Fields */}
          {milestone.key === 'design_approval' && eventType === 'complete' && (
            <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-lg space-y-3">
              <div className="font-bold text-emerald-900">Design Approval Sign-off Reference</div>
              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Customer Approval Ref <span className="text-rose-600">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. PETRO-CAD-9921-APPROVED"
                  value={approvalRef}
                  onChange={(e) => setApprovalRef(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 mb-1">Drawing #</label>
                  <input
                    type="text"
                    placeholder="CFT-DWG-400-REV-C"
                    value={drawingNo}
                    onChange={(e) => setDrawingNo(e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">ECN #</label>
                  <input
                    type="text"
                    placeholder="ECN-2026-089"
                    value={ecnNo}
                    onChange={(e) => setEcnNo(e.target.value)}
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          </div>

          {/* Footer Actions */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <div className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Logged by: {activeRole} User</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isRoleAuthorized || Boolean(minAllowedDate && eventDate && eventDate < minAllowedDate)}
                className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs ${
                  isRoleAuthorized && (!minAllowedDate || !eventDate || eventDate >= minAllowedDate)
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                {eventType === 'start' && milestone.actualStartDate 
                  ? 'Update Start Date' 
                  : eventType === 'start' 
                  ? 'Confirm & Record Start' 
                  : 'Complete Stage'}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
