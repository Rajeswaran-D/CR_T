import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder, ProductLine, Milestone } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { ShieldCheck, ShieldAlert, CheckCircle2, Play, Lock, Edit3 } from 'lucide-react';
import { canProductionStart } from '../../services/calculationEngine';

interface ProductionModuleProps {
  onOpenManualInput: (po: PurchaseOrder, line: ProductLine, ms: Milestone, type: 'start' | 'complete') => void;
}

export const ProductionModule: React.FC<ProductionModuleProps> = ({ onOpenManualInput }) => {
  const { purchaseOrders, activeRole } = useApp();

  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const isProductionRole = activeRole === 'Project Management' || activeRole === 'Planner (Assembly)' || activeRole === 'Planner (WO Release)' || activeRole === 'SCM / Planner (Machining)';

  const handleStartAttempt = (po: PurchaseOrder, line: ProductLine, prodMs: Milestone) => {
    setErrorBanner(null);
    const check = canProductionStart(line);

    if (!check.allowed) {
      setErrorBanner(`Dependency Guardrail Violation: ${check.reason}`);
    } else {
      onOpenManualInput(po, line, prodMs, 'start');
    }
  };

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Production Execution & Work Orders</h1>
          <p className="text-xs text-slate-500 mt-1">Shop floor CNC machining, assembly, hydrostatic pressure testing & shift allocation</p>
        </div>
        <div className="px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-emerald-800 font-mono text-xs font-semibold">
          Role: {activeRole} {isProductionRole ? '(Authorized)' : '(Read-Only)'}
        </div>
      </div>

      {/* Error / Guardrail Banner */}
      {errorBanner && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-3 text-xs shadow-xs">
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-rose-900">DEPENDENCY RULE ENFORCEMENT FAILURE:</span>
            <p className="mt-1 leading-normal text-slate-700">{errorBanner}</p>
          </div>
        </div>
      )}

      {/* Production Guardrail Rule Ribbon */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-xs text-slate-800 shadow-xs">
        <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
        <div>
          <span className="font-bold text-emerald-900">Flow #5 Guardrail Rule:</span>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Production execution unlocks <strong>ONLY</strong> when Design Stage is approved <strong>AND</strong> all critical path raw materials have passed GRN inspection.
          </p>
        </div>
      </div>

      {/* Work Orders List */}
      <div className="space-y-6">
        {purchaseOrders.filter(po => !po.isClosed && po.status !== "Completed" && po.status !== "Baseline Pending").map(po => (
          <div key={po.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2">
                <span className="font-bold text-emerald-800 font-mono">{po.poNumber}</span>
                <span className="text-slate-600">| Customer: {po.customerName}</span>
                {po.isClosed && <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-600 text-[10px] font-bold">CLOSED</span>}
              </div>
              <span className="text-slate-500 font-mono text-[10px]">Delivery: {po.committedDeliveryDate}</span>
            </div>

            <div className="p-5 space-y-4">
              {po.productLines.map(line => {
                const prodMs = line.milestones.find(m => m.key === 'production');
                if (!prodMs) return null;

                const check = canProductionStart(line);
                const isCompleted = prodMs.status === 'Completed' || Boolean(prodMs.actualEndDate);
                const isStarted = !!prodMs.actualStartDate && !isCompleted;

                const pIdx = line.milestones.findIndex(m => m.id === prodMs.id || m.key === prodMs.key);
                const prevMs = pIdx > 0 ? line.milestones[pIdx - 1] : null;
                const currVar = Math.max(0, typeof prodMs.varianceDays === 'number' ? prodMs.varianceDays : 0);
                const prevVar = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;
                const stageDelta = Math.max(0, currVar - prevVar);
                const isNewDelay = stageDelta > 0;
                const hasShift = currVar > 0 && !isNewDelay;
                const recoveredDays = isCompleted ? Math.max(0, prevVar - currVar) : 0;

                return (
                  <div key={line.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-3 font-bold text-slate-900">
                          <span className="text-emerald-800 font-mono text-sm">{line.lineNumber}:</span>
                          <span className="text-sm">{line.productName}</span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-mono border border-slate-200">
                            Qty: {line.qty} Pcs
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Design: {line.designType}
                        </div>
                      </div>

                      {/* Dependency Badge */}
                      <div className="flex items-center gap-2">
                        {check.allowed ? (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 font-mono font-bold text-[10px] flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" /> DEPENDENCIES CLEARED
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-800 font-mono font-bold text-[10px] flex items-center gap-1">
                            <Lock className="w-3.5 h-3.5 text-amber-700" /> DEPENDENCY LOCKED
                          </span>
                        )}

                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                          isCompleted ? (recoveredDays > 0 ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800') :
                          isStarted ? (isNewDelay ? 'bg-rose-100 border-rose-300 text-rose-800' : 'bg-blue-100 border-blue-300 text-blue-900') :
                          isNewDelay ? 'bg-rose-100 border-rose-300 text-rose-800' :
                          hasShift ? 'bg-slate-100 border-slate-200 text-slate-700' :
                          'bg-slate-100 border-slate-200 text-slate-600'
                        }`}>
                          {isCompleted ? (recoveredDays > 0 ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved)` : 'Completed') :
                           isStarted ? (isNewDelay ? `In Execution (+${stageDelta}d delay added)` : hasShift ? `In Execution (Previous: +${currVar}d)` : 'In Execution') :
                           isNewDelay ? `Delay (+${stageDelta}d)` :
                           hasShift ? `Previous (+${currVar}d)` :
                           prodMs.status}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar & Details */}
                    <div className="bg-white p-3.5 rounded-lg border border-slate-200 grid grid-cols-4 gap-4 text-xs font-mono shadow-xs">
                      <div>
                        <span className="text-slate-400 text-[10px]">BASELINE PRODUCTION:</span>
                        <div className="text-slate-700 font-medium">{prodMs.committedBaselineStartDate} to {prodMs.committedBaselineEndDate}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">FORECAST COMPLETION:</span>
                        <div className="text-emerald-800 font-bold">{prodMs.forecastEndDate}</div>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">SCHEDULE VARIANCE:</span>
                        <div className={prodMs.varianceDays > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                          {prodMs.varianceDays > 0 ? `+${prodMs.varianceDays}d` : `${prodMs.varianceDays}d`}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        {isMilestoneOwnedByRole(prodMs.key, activeRole) && !isStarted && !isCompleted && (
                          <button
                            onClick={() => handleStartAttempt(po, line, prodMs)}
                            className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Start Production
                          </button>
                        )}

                        {isMilestoneOwnedByRole(prodMs.key, activeRole) && isStarted && !isCompleted && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onOpenManualInput(po, line, prodMs, 'start')}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                              title="Edit / Re-enter Start Date"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-slate-500" /> Edit Start
                            </button>
                            <button
                              onClick={() => onOpenManualInput(po, line, prodMs, 'complete')}
                              className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Complete Production
                            </button>
                          </div>
                        )}

                        {!isMilestoneOwnedByRole(prodMs.key, activeRole) && !isCompleted && (
                          <span className="text-[10px] text-slate-400 font-mono italic">
                            Read-Only • Managed by production role
                          </span>
                        )}
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
