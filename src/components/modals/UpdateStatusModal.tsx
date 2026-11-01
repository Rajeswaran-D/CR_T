import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { ROLE_PERMISSIONS } from '../../types';
import { X, Wrench, CheckCircle2, Play, Save, AlertTriangle } from 'lucide-react';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import { clampDateMax, todayLocal, getDaysDifference, getMilestoneRevisedDates, addDays } from '../../services/calculationEngine';

interface UpdateStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
}

export const UpdateStatusModal: React.FC<UpdateStatusModalProps> = ({
  isOpen,
  onClose,
  po: poProp
}) => {
  const { updateOrderStatus, activeRole, purchaseOrders } = useApp();
  // Always read fresh PO from context to avoid stale-prop sync issues
  const po = poProp ? (purchaseOrders.find(p => p.id === poProp.id) ?? poProp) : null;

  const [selectedStageKey, setSelectedStageKey] = useState<string>('production');
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [statusAction, setStatusAction] = useState<'In Progress' | 'Completed'>('In Progress');
  const [completionDate, setCompletionDate] = useState<string>('');
  const [workNotes, setWorkNotes] = useState<string>('');
  const [delayReasonInput, setDelayReasonInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const today = todayLocal();

  useEffect(() => {
    if (po) {
      const lines = po.productLines;
      // Default to the line that is furthest behind (earliest active stage) so
      // the form always opens on the true bottleneck of the order.
      const defaultLine = lines.length > 0
        ? lines.slice().sort((a, b) => {
            const aActive = a.milestones.find(m => m.status !== 'Completed');
            const bActive = b.milestones.find(m => m.status !== 'Completed');
            return (aActive?.stageOrder ?? 99) - (bActive?.stageOrder ?? 99);
          })[0]
        : undefined;
      setSelectedLineId(defaultLine?.id || '');

      const milestones = defaultLine?.milestones || [];
      const activeMs = milestones.find(m => m.status !== 'Completed') || milestones[milestones.length - 1];
      const targetStageKey = activeMs?.key || 'production';

      const msIdx = milestones.findIndex(m => m.key === targetStageKey);
      const prev = msIdx > 0 ? milestones[msIdx - 1] : undefined;
      // Chain anchor: previous milestone's actual end when it exists, then its
      // planned end. Clamped to today so a future planned end can never make
      // the default value fall outside the selectable range.
      const prevEnd = prev?.actualEndDate
        || (prev ? (prev.forecastEndDate || prev.committedBaselineEndDate) : undefined);
      const rawInitial = prevEnd || activeMs?.committedBaselineStartDate || today;
      const initialDate = clampDateMax(rawInitial, today);

      setSelectedStageKey(targetStageKey);
      setStatusAction('In Progress');
      setWorkNotes('');
      setDelayReasonInput('');
      setCompletionDate(initialDate);
      setErrorMsg('');
    }
  }, [po?.id]);

  if (!isOpen || !po || po.isClosed || po.status === 'Completed') return null;

  const summary = getPOManufacturingStatus(po);
  const lines = po.productLines;
  // Everything in the form is derived from the SELECTED line — never blindly
  // from line 1. On multi-line POs each line has its own milestone chain.
  const selectedLine = lines.find(l => l.id === selectedLineId) || lines[0];
  const milestones = selectedLine?.milestones || [];
  
  // Find current active uncompleted milestone
  const activeMs = milestones.find(m => m.status !== 'Completed') || milestones[milestones.length - 1];
  const activeIndex = milestones.findIndex(m => m.key === activeMs?.key);

  const rawStages = [
    { key: 'po_from_customer',      name: '1. Customer Purchase Order (PO)' },
    { key: 'pm_baseline',           name: '2. Baseline Review & Planning' },
    { key: 'corb_release',          name: '3. CORB Release' },
    { key: 'bom_release',           name: '4. BOM Release' },
    { key: 'wo_release',            name: '5. Work Order (WO) Release' },
    { key: 'sub_supplier_po',       name: '6. Sub-Supplier PO' },
    { key: 'material_receipt',      name: '7. Material Receipt (GRN)' },
    { key: 'machining',             name: '8. Machining & Fabrication' },
    { key: 'assembly',              name: '9. Assembly' },
    { key: 'fg',                    name: '10. Finished Goods (FG)' },
    { key: 'customer_inspection',   name: '11. Customer Inspection' },
    { key: 'painting',              name: '12. Painting' },
    { key: 'trn',                   name: '13. TRN' },
    { key: 'shipment',              name: '14. Final Shipment & Dispatch' },
  ];

  const rolePerms = ROLE_PERMISSIONS[activeRole];
  const allowedKeys: string[] | 'ALL' = rolePerms?.allowedMilestones ?? [];

  // Build the selector from the PO's actual milestone list so custom stages remain available.
  const stageNames = new Map(rawStages.map(stage => [stage.key, stage.name]));
  const allStages = milestones.map(ms => ({
    key: ms.key,
    name: stageNames.get(ms.key) || `${ms.stageOrder}. ${ms.name.replace(/^\d+\.\s*/, '')}`
  }));

  // Slot users can only see/act on their own milestone; PM can see all.
  const selectableStages = allStages.filter((st, idx) => {
    const msObj = milestones.find(m => m.key === st.key);
    if (!msObj || msObj.status === 'Completed') return false;
    const isOwnedByRole = allowedKeys === 'ALL' || allowedKeys.includes(st.key);
    if (!isOwnedByRole) return false;
    return idx === activeIndex;
  });

  const finalStages = selectableStages.length > 0 
    ? selectableStages 
    : [allStages.find(st => st.key === activeMs?.key) || allStages[allStages.length - 1] || rawStages[0]];

  const selectedMsIndex = milestones.findIndex(m => m.key === selectedStageKey);
  const previousMs = selectedMsIndex > 0 ? milestones[selectedMsIndex - 1] : undefined;
  // Authoritative previous end: prefer actual end date
  const previousMsActualEnd = previousMs?.actualEndDate;
  const previousMsEnd = previousMsActualEnd
    || (previousMs ? (previousMs.forecastEndDate || previousMs.committedBaselineEndDate) : undefined);
  const currentMs = milestones[selectedMsIndex];
  const currentMsStart = currentMs
    ? (currentMs.actualStartDate || currentMs.committedBaselineStartDate || currentMs.forecastStartDate)
    : undefined;

  const handleLineSelect = (lineId: string) => {
    setSelectedLineId(lineId);
    setErrorMsg('');
    const line = po?.productLines.find(l => l.id === lineId);
    const ms = line?.milestones || [];
    const lineActiveMs = ms.find(m => m.status !== 'Completed') || ms[ms.length - 1];
    setSelectedStageKey(lineActiveMs?.key || 'production');
    setStatusAction('In Progress');
    const plannedStart = lineActiveMs?.actualStartDate || lineActiveMs?.committedBaselineStartDate || lineActiveMs?.forecastStartDate || today;
    setCompletionDate(plannedStart);
  };

  const handleStageSelect = (stageKey: string) => {
    setSelectedStageKey(stageKey);
    const msIdx = milestones.findIndex(m => m.key === stageKey);
    const targetMs = milestones[msIdx];
    if (statusAction === 'In Progress') {
      const plannedStart = targetMs?.actualStartDate || targetMs?.committedBaselineStartDate || targetMs?.forecastStartDate || today;
      setCompletionDate(plannedStart);
    } else {
      // Actual completion dates can never be in the future.
      setCompletionDate(clampDateMax(targetMs?.forecastEndDate || targetMs?.committedBaselineEndDate || today, today));
    }
  };

  const handleActionSelect = (action: 'In Progress' | 'Completed') => {
    setStatusAction(action);
    if (action === 'In Progress') {
      const plannedStart = currentMs?.actualStartDate || currentMs?.committedBaselineStartDate || currentMs?.forecastStartDate || today;
      setCompletionDate(plannedStart);
    } else {
      setCompletionDate(clampDateMax(currentMs?.forecastEndDate || currentMs?.committedBaselineEndDate || today, today));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const prevMsFloor = previousMs?.actualEndDate || previousMs?.forecastEndDate || previousMsEnd;
    if (statusAction === 'In Progress' && prevMsFloor && completionDate < prevMsFloor) {
      setErrorMsg(`Start date cannot be earlier than previous milestone's end date (${prevMsFloor}).`);
      return;
    }

    if (statusAction === 'Completed' && currentMsStart && completionDate < currentMsStart) {
      setErrorMsg(`Completion date cannot be earlier than milestone's start date (${currentMsStart}).`);
      return;
    }

    const effectiveNotes = delayReasonInput.trim()
      ? `${workNotes ? workNotes + ' | ' : ''}Actual Delay Reason: ${delayReasonInput.trim()}`
      : workNotes;

    const res = updateOrderStatus({
      poId: po.id,
      productLineId: selectedLine?.id,
      stageKey: selectedStageKey,
      statusAction,
      workNotes: effectiveNotes,
      completionDate,
      user: `${activeRole} Operator`
    });

    if (res.success) {
      onClose();
    } else {
      setErrorMsg(res.error || 'Failed to update status');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Update Order Status</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {po.poNumber} — <span className="font-bold text-slate-800">{po.customerName}</span>
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0 flex flex-col justify-between">
          <div className="p-6 space-y-5 text-xs flex-1">
          
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Current Status</span>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                summary.isDelayed ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                {summary.isDelayed ? 'Delayed' : 'On Track'}
              </span>
            </div>
            <div className="text-slate-700">{summary.currentStageName}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <span>Started: <strong className="text-slate-700">{activeMs?.actualStartDate || 'Not started'}</strong></span>
              <span>Completed: <strong className="text-slate-700">{activeMs?.actualEndDate || 'Not completed'}</strong></span>
            </div>
            {summary.isDelayed && (
              <div className="text-[11px] text-rose-700 font-semibold">
                Delay: {summary.delayedStageName || summary.currentStageName} ({summary.delayDays > 0 ? `+${summary.delayDays} days` : 'calculated'})
              </div>
            )}
          </div>

          {/* Select Product Line (multi-line POs have independent chains) */}
          {lines.length > 1 && (
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 flex items-center justify-between">
                <span>Select Product Line</span>
                <span className="text-[10px] font-mono text-slate-400">Each line has its own flow</span>
              </label>
              <select
                value={selectedLine?.id}
                onChange={(e) => handleLineSelect(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer text-xs"
              >
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.lineNumber}: {line.productName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Select Manufacturing Stage */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 flex items-center justify-between">
              <span>Select Work Stage</span>
              <span className="text-[10px] font-mono text-slate-400">Active Uncompleted Stage</span>
            </label>
            <select
              value={selectedStageKey}
              onChange={(e) => handleStageSelect(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer text-xs"
            >
              {finalStages.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>

          {statusAction === 'In Progress' && previousMs && (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] space-y-1">
              <div className="font-bold text-slate-800">Previous milestone: {previousMs.name}</div>
              <div className="text-slate-500">
                Planned end: <strong className="text-slate-700">{previousMs.committedBaselineEndDate || 'Not scheduled'}</strong>
              </div>
              {(previousMs.actualEndDate || previousMs.forecastEndDate) && (previousMs.actualEndDate || previousMs.forecastEndDate || '') > previousMs.committedBaselineEndDate && (
                <div className="text-rose-700 font-semibold">
                  Delayed end: {previousMs.actualEndDate || previousMs.forecastEndDate}
                </div>
              )}
            </div>
          )}

          {/* Milestone Schedule Info (Planned days & Revised Target dates) */}
          {currentMs && (() => {
            const bStart = currentMs.committedBaselineStartDate || po.poDate;
            const bEnd = currentMs.committedBaselineEndDate || po.committedDeliveryDate;
            const dur = Math.max(1, currentMs.committedDurationDays || 1);
            const planDuration = (bStart && bEnd) ? Math.max(1, getDaysDifference(bStart, bEnd) + 1) : dur;

            // Stable target benchmark from canonical calculation
            const canonicalDates = getMilestoneRevisedDates(currentMs, previousMs, po.poDate, po.committedDeliveryDate);
            const revStart = canonicalDates.revisedStart;
            const revEnd = canonicalDates.revisedEnd;
            const shiftDays = canonicalDates.shiftDays;

            return (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-slate-700">
                  <span>Planned Baseline: <strong className="text-slate-900">{bStart} &rarr; {bEnd}</strong></span>
                  <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 text-[10px]">
                    {planDuration} days planned
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                  <span className={shiftDays > 0 ? "text-amber-800" : "text-emerald-700"}>
                    Revised Target: <strong className={shiftDays > 0 ? "text-amber-950" : "text-emerald-900"}>{revStart} &rarr; {revEnd}</strong>
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    shiftDays > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                  }`}>
                    {shiftDays > 0 ? `+${shiftDays}d shift` : 'On original baseline'}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Event Date */}
          {(() => {
            const prevMsFloor = previousMs?.actualEndDate || previousMs?.forecastEndDate;
            const minAllowedDate = statusAction === 'In Progress'
              ? (prevMsFloor || currentMs?.committedBaselineStartDate || po.poDate)
              : (currentMs?.actualStartDate || prevMsFloor || currentMs?.committedBaselineStartDate || po.poDate);
            const isDateInvalid = Boolean(minAllowedDate && completionDate && completionDate < minAllowedDate);

            return (
              <div className="space-y-1.5">
                <label className="font-bold text-slate-900 flex items-center justify-between">
                  <span>{statusAction === 'Completed' ? 'Completion Date' : 'Start Date'}</span>
                  <span className="text-[10px] font-mono text-slate-500">Delay is calculated automatically</span>
                </label>
                <input
                  type="date"
                  min={minAllowedDate}
                  value={completionDate || today}
                  onChange={(e) => {
                    const val = e.target.value;
                    const enforcedVal = (statusAction === 'In Progress' && minAllowedDate && val && val < minAllowedDate)
                      ? minAllowedDate
                      : val;
                    setCompletionDate(enforcedVal);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:border-emerald-600 text-xs font-mono"
                />
                {isDateInvalid && (
                  <p className="text-[11px] text-rose-600 font-bold mt-1 flex items-center gap-1 font-mono">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {statusAction === 'In Progress'
                      ? `Start date cannot be earlier than previous milestone completion (${minAllowedDate}).`
                      : `Completion date cannot be earlier than start date (${minAllowedDate}).`}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Select Status Action */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900">Work Condition / Action</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleActionSelect('In Progress')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  statusAction === 'In Progress'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Play className="w-3.5 h-3.5" /> In Progress
              </button>

              <button
                type="button"
                onClick={() => handleActionSelect('Completed')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  statusAction === 'Completed'
                    ? 'bg-emerald-700 border-emerald-800 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Stage Complete
              </button>

            </div>
          </div>

          {/* Delay Reason Field - Clearly distinguishing new stage delays vs inherited delays */}
          {currentMs && Boolean(
            (statusAction === 'In Progress' && currentMs.committedBaselineStartDate && completionDate > currentMs.committedBaselineStartDate) ||
            (statusAction !== 'In Progress' && currentMs.committedBaselineEndDate && completionDate > currentMs.committedBaselineEndDate)
          ) && (
            (() => {
              const prevEffectiveEnd = previousMs ? (previousMs.actualEndDate || previousMs.forecastEndDate) : undefined;
              const baselineStart = currentMs.committedBaselineStartDate;
              const baselineEnd = currentMs.committedBaselineEndDate;

              let totalDelay = 0;
              let netInheritedDelay = 0;
              let newDelayFormed = 0;
              let resolvedDelayDays = 0;

              if (statusAction === 'In Progress') {
                const targetStart = (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart)
                  ? prevEffectiveEnd
                  : baselineStart;
                const inheritedShift = (baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart)
                  ? getDaysDifference(baselineStart, prevEffectiveEnd)
                  : 0;
                netInheritedDelay = inheritedShift;
                if (targetStart && completionDate > targetStart) {
                  newDelayFormed = getDaysDifference(targetStart, completionDate);
                  totalDelay = netInheritedDelay + newDelayFormed;
                } else if (targetStart && completionDate <= targetStart) {
                  newDelayFormed = 0;
                  if (baselineStart && completionDate > baselineStart) {
                    totalDelay = getDaysDifference(baselineStart, completionDate);
                    resolvedDelayDays = Math.max(0, netInheritedDelay - totalDelay);
                  } else {
                    totalDelay = 0;
                    resolvedDelayDays = netInheritedDelay;
                  }
                } else {
                  totalDelay = netInheritedDelay;
                }
              } else {
                const effectiveStart = currentMs.actualStartDate || ((baselineStart && prevEffectiveEnd && prevEffectiveEnd > baselineStart) ? prevEffectiveEnd : baselineStart);
                const startDelay = (baselineStart && effectiveStart && effectiveStart > baselineStart)
                  ? getDaysDifference(baselineStart, effectiveStart)
                  : 0;
                netInheritedDelay = startDelay;
                const targetEnd = currentMs.forecastEndDate || (baselineEnd && netInheritedDelay > 0 ? addDays(baselineEnd, netInheritedDelay) : baselineEnd);

                if (targetEnd && completionDate > targetEnd) {
                  newDelayFormed = getDaysDifference(targetEnd, completionDate);
                  totalDelay = netInheritedDelay + newDelayFormed;
                } else if (targetEnd && completionDate <= targetEnd) {
                  newDelayFormed = 0;
                  if (baselineEnd && completionDate > baselineEnd) {
                    totalDelay = getDaysDifference(baselineEnd, completionDate);
                    resolvedDelayDays = Math.max(0, netInheritedDelay - totalDelay);
                  } else {
                    totalDelay = 0;
                    resolvedDelayDays = netInheritedDelay;
                  }
                } else {
                  totalDelay = netInheritedDelay;
                }
              }

              const prevMilestones = milestones.slice(0, selectedMsIndex);
              const prevDelaysList = prevMilestones
                .map((m, mIdx) => {
                  const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                  const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                  const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                  const stageDelta = currVar - prevVar;
                  return { ...m, calculatedDelayDays: stageDelta };
                })
                .filter(m => m.calculatedDelayDays > 0);

              if (newDelayFormed > 0) {
                return (
                  <div className="space-y-2 p-3.5 bg-rose-50/90 border border-rose-300 rounded-xl">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-rose-950 text-xs flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>New Delay Formed on Stage {currentMs.stageOrder}: <strong className="text-rose-700 font-mono">+{newDelayFormed}d Added</strong></span>
                      </label>
                      {netInheritedDelay > 0 && (
                        <span className="text-[10px] font-mono text-slate-500">
                          (+{netInheritedDelay}d prior inherited)
                        </span>
                      )}
                    </div>

                    {netInheritedDelay > 0 && prevDelaysList.length > 0 && (
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

                    <input
                      type="text"
                      placeholder={`Reason for +${newDelayFormed}d delay formed on Stage ${currentMs.stageOrder} *`}
                      value={delayReasonInput}
                      onChange={(e) => setDelayReasonInput(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-xs text-slate-900 font-bold focus:outline-none focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                      required
                    />
                  </div>
                );
              }

              if (totalDelay <= 0) {
                return (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs font-semibold flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          {netInheritedDelay > 0
                            ? `Schedule Fully Recovered: All prior delay resolved! (+${netInheritedDelay}d recovered at Stage ${currentMs.stageOrder})`
                            : 'Schedule Status: On Track — Selected date is within planned baseline.'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300">
                        0d Delay
                      </span>
                    </div>

                    {netInheritedDelay > 0 && prevDelaysList.length > 0 && (
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
                    )}
                  </div>
                );
              }

              if (resolvedDelayDays > 0) {
                return (
                  <div className="space-y-2 p-3.5 bg-teal-50 border border-teal-300 rounded-xl">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                        <span>Schedule Accelerated: <strong className="text-teal-700 font-mono">+{resolvedDelayDays}d Delay Resolved</strong> (Net delay reduced from +{netInheritedDelay}d to +{totalDelay}d)</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-teal-900 bg-white px-2 py-0.5 rounded border border-teal-300">
                        Net Delay: +{totalDelay}d
                      </span>
                    </div>

                    {prevDelaysList.length > 0 && (
                      <div className="p-2 bg-teal-100/50 border border-teal-200 rounded-lg space-y-0.5 text-[10px] font-mono text-teal-900">
                        <div className="font-bold text-teal-950">Preceding Delay Sources & Resolution:</div>
                        {prevDelaysList.map((m, i) => (
                          <div key={i} className="truncate">
                            • Stage {m.stageOrder}: {m.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{m.calculatedDelayDays}d Delay Added</strong>
                            {m.delayReason && <span className="text-slate-600 font-normal"> — {m.delayReason}</span>}
                          </div>
                        ))}
                        <div className="truncate text-teal-800 font-semibold">
                          • Stage {currentMs.stageOrder}: {currentMs.name.replace(/^\d+\.\s*/, '')}: <strong className="text-emerald-700">-{resolvedDelayDays}d Delay Resolved</strong> (Ahead of revised target)
                        </div>
                        <div className="pt-0.5 font-bold text-teal-950 border-t border-teal-200 flex justify-between">
                          <span>Net Cumulative Delay:</span>
                          <span className="text-amber-800 font-bold">+{totalDelay}d</span>
                        </div>
                      </div>
                    )}

                    <input
                      type="text"
                      placeholder="Optional remarks or notes..."
                      value={delayReasonInput}
                      onChange={(e) => setDelayReasonInput(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-teal-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-teal-600 font-medium placeholder:text-slate-400"
                    />
                  </div>
                );
              }

              return (
                <div className="space-y-2 p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-blue-600" />
                      <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{netInheritedDelay}d Inherited</strong> (No new delay caused by Stage {currentMs.stageOrder})</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                      Total Delay: +{totalDelay}d
                    </span>
                  </div>

                  {prevDelaysList.length > 0 && (
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
                  )}

                  <input
                    type="text"
                    placeholder="Optional remarks or notes..."
                    value={delayReasonInput}
                    onChange={(e) => setDelayReasonInput(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-blue-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600 font-medium placeholder:text-slate-400"
                  />
                </div>
              );
            })()
          )}

          {/* Work Description / Notes */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900">
              Work Notes / Status Description
            </label>
            <textarea
              rows={3}
              placeholder="Describe current shop-floor work or delay reasons..."
              value={workNotes}
              onChange={(e) => setWorkNotes(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-medium placeholder:text-slate-400"
            />
          </div>

          </div>

          {/* Actions */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {(() => {
              const prevMsFloor = previousMs?.actualEndDate || previousMs?.forecastEndDate;
              const minAllowed = statusAction === 'In Progress'
                ? (prevMsFloor || currentMs?.committedBaselineStartDate || po.poDate)
                : (currentMs?.actualStartDate || prevMsFloor || currentMs?.committedBaselineStartDate || po.poDate);
              const isInvalid = Boolean(minAllowed && completionDate && completionDate < minAllowed);

              return (
                <button
                  type="submit"
                  disabled={isInvalid}
                  className={`px-5 py-2 rounded-xl font-bold transition-all shadow-md flex items-center gap-1.5 ${
                    !isInvalid
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Save className="w-4 h-4 text-emerald-200" />
                  <span>Save Status Update</span>
                </button>
              );
            })()}
          </div>

        </form>

      </div>
    </div>
  );
};
