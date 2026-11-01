import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X, AlertTriangle, ShieldCheck, CheckCircle2, RefreshCw, Sparkles, Package } from 'lucide-react';
import type { PurchaseOrder } from '../../types';
import { addDays, todayLocal } from '../../services/calculationEngine';

type FlowMilestone = {
  key: string;
  name: string;
  durationDays: number;
};

interface BaselineRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder;
}

export const BaselineRevisionModal: React.FC<BaselineRevisionModalProps> = ({
  isOpen,
  onClose,
  po
}) => {
  const { addBaselineRevision, activeRole } = useApp();

  const today = todayLocal();

  const [reason, setReason] = useState<string>('');
  const [flowMode, setFlowMode] = useState<'recommended' | 'custom'>('recommended');
  const [baselineStartDate, setBaselineStartDate] = useState<string>(today);
  const [durationChanges, setDurationChanges] = useState<{ [key: string]: number }>({});
  const [masterDurations, setMasterDurations] = useState<{ [key: string]: number }>({});
  const [customFlows, setCustomFlows] = useState<Record<string, FlowMilestone[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const initialStart = po.productLines[0]?.milestones[0]?.committedBaselineStartDate || po.poDate || todayLocal();
    setReason('');
    setFlowMode('recommended');
    setBaselineStartDate(initialStart);
    setError(null);

    const initialMap: { [key: string]: number } = {};
    const masterMap: { [key: string]: number } = {};

    po.productLines.forEach(line => {
      line.milestones.forEach(ms => {
        initialMap[`${line.id}_${ms.key}`] = ms.committedDurationDays;
        if (masterMap[ms.key] === undefined) {
          masterMap[ms.key] = ms.committedDurationDays;
        }
      });
    });

    setDurationChanges(initialMap);
    setMasterDurations(masterMap);

    const initialFlows: Record<string, FlowMilestone[]> = {};
    po.productLines.forEach(line => {
      initialFlows[line.id] = line.milestones.map(ms => ({
        key: ms.key,
        name: ms.name,
        durationDays: ms.committedDurationDays
      }));
    });
    setCustomFlows(initialFlows);
  }, [isOpen, po.id]);

  if (!isOpen) return null;

  const isInitialApproval = po.status === 'Baseline Pending';
  const flowAlreadyStarted = !isInitialApproval && po.productLines.some(line =>
    line.milestones.some(ms => ms.stageOrder > 2 && Boolean(ms.actualStartDate || ms.actualEndDate))
  );

  const handleMasterDurationChange = (milestoneKey: string, val: number) => {
    const clampedVal = Math.max(1, val);
    setMasterDurations(prev => ({
      ...prev,
      [milestoneKey]: clampedVal
    }));

    // Cascade to all product lines in the PO
    setDurationChanges(prev => {
      const next = { ...prev };
      po.productLines.forEach(line => {
        next[`${line.id}_${milestoneKey}`] = clampedVal;
      });
      return next;
    });

    // Also update customFlows if in custom flow
    setCustomFlows(prev => {
      const next: Record<string, FlowMilestone[]> = {};
      Object.keys(prev).forEach(lineId => {
        next[lineId] = prev[lineId].map(ms => ms.key === milestoneKey ? { ...ms, durationDays: clampedVal } : ms);
      });
      return next;
    });
  };

  const nextRevNum = po.revisions.length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (flowAlreadyStarted) {
      setError('Cannot revise baseline after actual work has started. Update milestones through the production modules.');
      return;
    }

    if (flowMode === 'custom') {
      const emptyLine = po.productLines.find(line => (customFlows[line.id] || []).length === 0);
      if (emptyLine) {
        setError(`Custom flow for ${emptyLine.lineNumber} must contain at least one milestone.`);
        return;
      }
      const invalidDuration = po.productLines
        .flatMap(line => customFlows[line.id] || [])
        .find(ms => !Number.isFinite(ms.durationDays) || ms.durationDays < 1);
      if (invalidDuration) {
        setError(`Duration for milestone '${invalidDuration.name}' must be at least 1 day.`);
        return;
      }
    }

    const changesList: { lineId: string; milestoneKey: string; newDuration: number }[] = [];

    po.productLines.forEach(line => {
      line.milestones.forEach(ms => {
        const key = `${line.id}_${ms.key}`;
        const newDur = durationChanges[key];
        if (newDur !== undefined && newDur !== ms.committedDurationDays) {
          changesList.push({
            lineId: line.id,
            milestoneKey: ms.key,
            newDuration: newDur
          });
        }
      });
    });

    const res = addBaselineRevision({
      poId: po.id,
      reason: reason.trim() || (isInitialApproval ? 'Single Master Baseline reviewed and approved for all products.' : `Master Baseline re-revised (Rev ${nextRevNum}).`),
      docRef: `BL-REV-${nextRevNum}-${today.replace(/-/g, '')}`,
      user: `${activeRole} User`,
      baselineStartDate,
      changes: changesList,
      milestoneFlows: flowMode === 'custom'
        ? po.productLines.map(line => ({ lineId: line.id, milestones: customFlows[line.id] || [] }))
        : undefined
    });

    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to lock baseline revision');
    }
  };

  // Master representative milestone list (taken from line 1 or longest line)
  const masterMilestones = po.productLines[0]?.milestones || [];

  // Calculate master schedule
  let masterRunningDate = baselineStartDate || po.poDate || today;
  const masterSchedule = masterMilestones.map((ms, index) => {
    const duration = masterDurations[ms.key] || ms.committedDurationDays;
    const startDate = masterRunningDate;
    const endDate = addDays(startDate, Math.max(1, duration) - 1);
    masterRunningDate = addDays(endDate, 1);
    return { ...ms, index, durationDays: duration, startDate, endDate };
  });
  const masterCalculatedDeliveryDate = masterSchedule[masterSchedule.length - 1]?.endDate || po.committedDeliveryDate;

  // Extract all historical delay records across all products in the PO for reference
  const netPoDelay = Math.max(0, ...po.productLines.map(l => l.overallVarianceDays || 0));
  const allPoDelays: { stageOrder: number; stageName: string; varianceDays: number; delayReason?: string }[] = [];
  po.productLines.forEach(line => {
    line.milestones.forEach(m => {
      if ((typeof m.varianceDays === 'number' && m.varianceDays > 0) || (m.delayReason && !m.delayReason.startsWith('Cascaded'))) {
        if (!allPoDelays.some(existing => existing.stageOrder === m.stageOrder && existing.delayReason === m.delayReason)) {
          allPoDelays.push({
            stageOrder: m.stageOrder,
            stageName: m.name,
            varianceDays: m.varianceDays || 0,
            delayReason: m.delayReason
          });
        }
      }
    });
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] text-slate-800 overflow-hidden">
        
        {/* Modern Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 p-5 text-white flex items-center justify-between border-b border-slate-700">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {isInitialApproval ? 'INITIAL BASELINE COMMITMENT' : `RE-BASELINE REV ${nextRevNum}`}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-slate-200">
                Unified Order Schedule ({po.productLines.length} Products)
              </span>
            </div>
            <h2 className="font-extrabold text-white text-lg mt-1 tracking-tight">
              {isInitialApproval ? 'Single Master Baseline Planning' : `Issue Baseline Revision (Rev ${nextRevNum})`}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">PO: <strong className="font-mono text-cyan-300">{po.poNumber}</strong> | Customer: <strong className="text-white">{po.customerName}</strong></p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Unified Scope Info Banner */}
          <div className="bg-cyan-50/70 border border-cyan-200 p-3.5 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-cyan-700 shrink-0" />
              <div>
                <div className="font-bold text-cyan-950 text-xs">Single Order Master Baseline</div>
                <div className="text-[11px] text-cyan-800">One synchronized 14-stage schedule automatically controls all {po.productLines.length} product lines in this order.</div>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 bg-white text-cyan-900 border border-cyan-300 rounded-lg shadow-2xs">
              All {po.productLines.length} Products Linked
            </span>
          </div>

          {/* PO Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/60 p-4 rounded-xl border border-slate-200">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-bold text-slate-700 text-[11px]">
                  Baseline Planned Start Date
                </label>
                <span className="text-[9px] font-mono text-cyan-800 font-semibold bg-cyan-50 px-1.5 py-0.2 rounded border border-cyan-200">Past 1 Wk &amp; Future</span>
              </div>
              <input
                type="date"
                min={addDays(today, -7)}
                value={baselineStartDate}
                disabled={flowAlreadyStarted}
                onChange={(e) => setBaselineStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:border-cyan-600 font-bold"
              />
              <p className="text-[9px] text-slate-500 mt-1 font-mono">
                Enabled: Past 1 week ({addDays(today, -7)}), today, &amp; future dates
              </p>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1 text-[11px]">
                Calculated Final Delivery
              </label>
              <div className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono text-cyan-900 font-extrabold flex items-center justify-between">
                <span>{masterCalculatedDeliveryDate}</span>
                <span className="text-[10px] text-slate-500 font-normal">PO: {po.committedDeliveryDate}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-bold text-slate-700 text-[11px]">
                  {isInitialApproval ? 'Approval Notes' : 'Re-Baseline Reason'}
                  {!isInitialApproval && <span className="text-rose-600 ml-1">*</span>}
                </label>
                {!isInitialApproval && (allPoDelays.length > 0 || netPoDelay > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      const breakdown = allPoDelays.map(d => `${d.stageName} (${d.varianceDays > 0 ? `+${d.varianceDays}d` : `${d.varianceDays}d`}${d.delayReason ? `: ${d.delayReason}` : ''})`).join('; ');
                      const sum = `Net order delay: +${netPoDelay}d${breakdown ? ` [${breakdown}]` : ''}`;
                      setReason(prev => prev ? `${prev} | ${sum}` : sum);
                    }}
                    className="text-[10px] font-bold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    Append Delays (+{netPoDelay}d)
                  </button>
                )}
              </div>
              <input
                type="text"
                disabled={flowAlreadyStarted}
                placeholder={isInitialApproval ? 'e.g. Master baseline reviewed & agreed' : 'e.g. Approved scope extension'}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-cyan-600 disabled:opacity-50"
              />
              {!isInitialApproval && allPoDelays.length > 0 && (
                <div className="mt-1.5 p-2 bg-rose-50/60 border border-rose-100 rounded-lg text-[10px] text-rose-800 space-y-0.5">
                  <div className="font-semibold text-rose-950 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Recorded milestone delays across order:</span>
                  </div>
                  {allPoDelays.slice(0, 3).map((d, i) => (
                    <div key={i} className="truncate">• Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.varianceDays}d</strong> {d.delayReason ? `("${d.delayReason}")` : ''}</div>
                  ))}
                  {allPoDelays.length > 3 && (
                    <div className="text-[9px] text-rose-600 italic">+ {allPoDelays.length - 3} more stage event(s)</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* MASTER BASELINE VIEW (CLEAN & NON-CLUMSY) */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-xs flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-600" /> Master 14-Stage Duration Plan (Applies to All {po.productLines.length} Products)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Edit stage durations below. Dates will automatically chain and synchronize across all products.</p>
                </div>
                <span className="text-xs font-mono font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 px-2.5 py-1 rounded-lg">
                  Total: {masterSchedule.reduce((acc, m) => acc + m.durationDays, 0)} Days
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                      <th className="py-2.5 px-4 w-12 text-center">#</th>
                      <th className="py-2.5 px-4">Stage Name</th>
                      <th className="py-2.5 px-4 text-center w-36">Duration (Days)</th>
                      <th className="py-2.5 px-4">Planned Start</th>
                      <th className="py-2.5 px-4">Planned End</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {masterSchedule.map((ms, idx) => {
                      const originalMs = masterMilestones.find(item => item.key === ms.key);
                      const currentDur = masterDurations[ms.key] || ms.committedDurationDays;
                      const diff = originalMs ? currentDur - originalMs.committedDurationDays : 0;

                      return (
                        <tr key={ms.key} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-slate-800">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{ms.name}</span>
                              {originalMs && typeof originalMs.varianceDays === 'number' && originalMs.varianceDays > 0 && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  +{originalMs.varianceDays}d Delay
                                </span>
                              )}
                              {originalMs && typeof originalMs.varianceDays === 'number' && originalMs.varianceDays < 0 && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {originalMs.varianceDays}d Recovered
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="number"
                                min="1"
                                max="365"
                                disabled={flowAlreadyStarted}
                                value={currentDur}
                                onChange={(e) => handleMasterDurationChange(ms.key, parseInt(e.target.value) || 1)}
                                className="w-16 px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg text-center text-xs font-mono text-cyan-900 font-extrabold focus:bg-white focus:outline-none focus:border-cyan-600"
                              />
                              {diff !== 0 && (
                                <span className={`text-[10px] font-mono font-bold ${diff > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                  {diff > 0 ? `+${diff}d` : `${diff}d`}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600 text-[11px]">
                            {ms.startDate}
                          </td>
                          <td className="py-2.5 px-4 font-mono font-bold text-emerald-700 text-[11px]">
                            {ms.endDate}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SYNCHRONIZED PRODUCTS SUMMARY CARD */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="font-bold text-slate-900 text-xs flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-700" />
                  Synchronized Products Overview ({po.productLines.length} Product Lines)
                </div>
                <span className="text-[11px] font-mono text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  All Products Synced to Master Baseline
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {po.productLines.map(line => {
                  let lineRunningDate = baselineStartDate || po.poDate || today;
                  line.milestones.forEach(ms => {
                    const dur = masterDurations[ms.key] !== undefined ? masterDurations[ms.key] : ms.committedDurationDays;
                    lineRunningDate = addDays(lineRunningDate, Math.max(1, dur));
                  });
                  const lineDelivery = lineRunningDate || masterCalculatedDeliveryDate;

                  return (
                    <div key={line.id} className="bg-white p-3 rounded-lg border border-slate-200 space-y-1 shadow-2xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-900 truncate">{line.lineNumber}: {line.productName}</span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-50 text-purple-800 border border-purple-200">
                          {line.designType}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono flex items-center justify-between pt-1">
                        <span>Qty: <strong>{line.qty} Pcs</strong></span>
                        <span className="text-emerald-800 font-bold">Delivery: {lineDelivery}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {!flowAlreadyStarted && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                {isInitialApproval
                  ? `Approving this Master Baseline locks Rev ${nextRevNum} and releases all ${po.productLines.length} product lines to the stage execution modules.`
                  : `Saving will lock Re-Baseline Rev ${nextRevNum} and synchronize all committed milestone dates.`
                }
              </span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
            >
              {flowAlreadyStarted ? 'Close' : 'Cancel'}
            </button>
            {!flowAlreadyStarted && (
              <button
                type="submit"
                className="px-5 py-2 bg-cyan-800 hover:bg-cyan-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                {isInitialApproval ? (
                  <><CheckCircle2 className="w-4 h-4 text-cyan-200" /> Lock Master Baseline & Release Order</>
                ) : (
                  <><RefreshCw className="w-4 h-4 text-cyan-200" /> Save Master Re-Baseline Rev {nextRevNum}</>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

