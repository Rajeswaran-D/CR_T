import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { CheckCircle2, Lock, ChevronDown, ChevronUp, Layers, ShieldAlert, Calendar, CheckSquare } from "lucide-react";
import type { PurchaseOrder, ProductLine, Milestone } from "../../types";
import { isMilestoneOwnedByRole } from "../../types";
import { getPOManufacturingStatus } from "../../utils/statusUtils";
import { todayLocal } from "../../services/calculationEngine";

interface ProductionModuleSimpleProps {
  onOpenManualInput: (po: PurchaseOrder, line: ProductLine, ms: Milestone, type: "start" | "complete") => void;
}

interface AssemblySubStep {
  id: string;
  name: string;
  description: string;
  startDate?: string;
  endDate?: string;
  isCompleted: boolean;
}

export const ProductionAssemblyModule: React.FC<ProductionModuleSimpleProps> = ({ onOpenManualInput }) => {
  const { purchaseOrders, activeRole } = useApp();
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [activeAssemblyTab, setActiveAssemblyTab] = useState<Record<string, string>>({});

  // Sub-tabs local state per line ID
  const [subTabStates, setSubTabStates] = useState<Record<string, AssemblySubStep[]>>({});

  const todayStr = todayLocal();

  const getLineSubSteps = (lineId: string): AssemblySubStep[] => {
    if (subTabStates[lineId]) return subTabStates[lineId];
    return [
      { id: "sub-1", name: "1. Component Prep & Sub-Assembly", description: "Mechanical fitment of valve stems, seats & body flanges.", isCompleted: false },
      { id: "sub-2", name: "2. Main Assembly & Piping", description: "Torquing body studs, seal gland positioning & actuator fitment.", isCompleted: false },
      { id: "sub-3", name: "3. Hydrostatic & Pressure Test", description: "High-pressure shell test, seat leakage check & cryo loop test.", isCompleted: false },
      { id: "sub-4", name: "4. Touchup & QA Final Sign-off", description: "Coating touchup, tag plate riveted & final QA inspector sign-off.", isCompleted: false }
    ];
  };

  const handleToggleSubStep = (lineId: string, stepId: string) => {
    const currentSteps = getLineSubSteps(lineId);
    const updated = currentSteps.map(step => {
      if (step.id === stepId) {
        const isComp = !step.isCompleted;
        return {
          ...step,
          isCompleted: isComp,
          startDate: step.startDate || todayStr,
          endDate: isComp ? todayStr : undefined
        };
      }
      return step;
    });
    setSubTabStates(prev => ({ ...prev, [lineId]: updated }));
  };

  return (
    <div className="p-8 space-y-8 bg-slate-50 min-h-full text-slate-800 select-none">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Assembly & Production Operations</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-100 border border-purple-300 text-purple-800 text-xs font-bold font-mono">
              Role: Planner (Assembly)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dedicated separate sub-tabs for Assembly sub-processes. Only the assigned Assembly Lead can record completion. Next milestones unlock strictly after completion!
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Active Production & Assembly Orders</h2>
            <p className="text-xs text-slate-500 mt-0.5">Sequential milestone tracking with explicit Start & End dates.</p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-400">
            {purchaseOrders.filter(p => !p.isClosed).length} Active Orders
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {purchaseOrders.filter(po => !po.isClosed && po.status !== 'Completed').map(po => {
            const isExpanded = expandedPO === po.id || purchaseOrders.length === 1;
            const statusSummary = getPOManufacturingStatus(po);

            return (
              <div key={po.id}>
                <div className="w-full px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                  <button 
                    onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                    className="flex-1 text-left flex items-center gap-4 cursor-pointer"
                  >
                    <span className="font-mono font-bold text-emerald-800 text-sm">{po.poNumber}</span>
                    <span className="font-semibold text-slate-900">{po.customerName}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      statusSummary.isDelayed ? "bg-rose-100 text-rose-800 border-rose-300" :
                      po.isClosed ? "bg-slate-100 text-slate-700 border-slate-300" :
                      "bg-emerald-100 text-emerald-800 border-emerald-300"
                    }`}>
                      {statusSummary.isDelayed ? `Delayed (+${statusSummary.delayDays}d)` : po.isClosed ? "Closed" : "On Time"}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      Current Stage: <strong className="text-slate-800">{statusSummary.currentStageName}</strong>
                    </span>
                  </button>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                      className="p-1 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-6 pb-6 space-y-6 bg-slate-50/40">
                    {po.productLines.map(line => {
                      const subSteps = getLineSubSteps(line.id);
                      const activeTabId = activeAssemblyTab[line.id] || subSteps[0].id;

                      const assemblyMsIndex = line.milestones.findIndex(m => m.key === "assembly" || m.key === "production");
                      const previousMs = assemblyMsIndex > 0 ? line.milestones[assemblyMsIndex - 1] : undefined;
                      const isPreviousCompleted = !previousMs || previousMs.status === "Completed" || Boolean(previousMs.actualEndDate) || previousMs.completionPct === 100;
                      
                      const assemblyMs = line.milestones.find(m => m.key === "assembly" || m.key === "production") || line.milestones[0];
                      const isRoleAuthorized = isMilestoneOwnedByRole("assembly", activeRole);

                      return (
                        <div key={line.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                          {/* Header */}
                          <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div>
                              <span className="text-xs font-bold text-slate-900">{line.lineNumber}: {line.productName}</span>
                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3 font-mono">
                                <span>Design: <strong className="text-slate-700">{line.designType}</strong></span>
                                <span>Qty: <strong className="text-slate-700">{line.qty} Pcs</strong></span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {!isPreviousCompleted && (
                                <span className="flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-300 px-3 py-1 rounded-full font-bold">
                                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                                  Locked — Waiting for {previousMs?.name} Completion
                                </span>
                              )}
                              {!isRoleAuthorized && isPreviousCompleted && (
                                <span className="flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 border border-slate-300 px-3 py-1 rounded-full font-bold">
                                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                                  Read-Only (Assigned to Assembly Lead)
                                </span>
                              )}
                              {isPreviousCompleted && isRoleAuthorized && (
                                <span className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1 rounded-full font-bold">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  Unlocked — Authorized for {activeRole}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* SEPARATE SUB-TABS FOR ASSEMBLY */}
                          <div className="p-5 space-y-5">
                            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                                <Layers className="w-4 h-4 text-purple-700" />
                                Assembly Sub-Process Tabs ({subSteps.filter(s => s.isCompleted).length}/{subSteps.length} Completed)
                              </div>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Start & End Dates Tracked Per Sub-Tab
                              </span>
                            </div>

                            {/* Tab Buttons */}
                            <div className="grid grid-cols-4 gap-2">
                              {subSteps.map(step => {
                                const isActive = activeTabId === step.id;
                                return (
                                  <button
                                    key={step.id}
                                    onClick={() => setActiveAssemblyTab(prev => ({ ...prev, [line.id]: step.id }))}
                                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                      isActive 
                                        ? "bg-purple-50/90 border-purple-400 text-purple-950 font-bold shadow-xs ring-2 ring-purple-300/40"
                                        : step.isCompleted
                                        ? "bg-emerald-50/50 border-emerald-200 text-emerald-900"
                                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="truncate font-semibold">{step.name.split('.')[1] || step.name}</span>
                                      {step.isCompleted ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                      ) : (
                                        <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono mt-1">
                                      {step.isCompleted ? `Done: ${step.endDate || todayStr}` : 'Pending'}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Active Tab Content Panel */}
                            {(() => {
                              const activeStep = subSteps.find(s => s.id === activeTabId) || subSteps[0];

                              return (
                                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <h3 className="font-bold text-slate-900 text-xs">{activeStep.name}</h3>
                                      <p className="text-xs text-slate-500 mt-0.5">{activeStep.description}</p>
                                    </div>

                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                      activeStep.isCompleted
                                        ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                                        : "bg-amber-100 border-amber-300 text-amber-800"
                                    }`}>
                                      {activeStep.isCompleted ? "Sub-Tab Completed" : "In Progress / Pending"}
                                    </span>
                                  </div>

                                  {/* Dates Display */}
                                  <div className="grid grid-cols-2 gap-4 bg-white p-3 rounded-lg border border-slate-200 text-xs font-mono">
                                    <div className="flex items-center gap-2">
                                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                      <span>Start Date: <strong className="text-slate-800">{activeStep.startDate || assemblyMs.actualStartDate || assemblyMs.committedBaselineStartDate}</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                      <span>End Date: <strong className="text-slate-800">{activeStep.endDate || (activeStep.isCompleted ? todayStr : 'Pending completion')}</strong></span>
                                    </div>
                                  </div>

                                  {/* Completion Action */}
                                  <div className="flex items-center justify-between pt-2">
                                    <div className="text-[11px] text-slate-500 font-mono">
                                      {!isPreviousCompleted ? "Unlocks when previous milestone is done." : !isRoleAuthorized ? "Read-only mode for current role." : "Authorized to mark sub-assembly complete."}
                                    </div>

                                    {isPreviousCompleted && isRoleAuthorized && !po.isClosed && (
                                      <button
                                        onClick={() => handleToggleSubStep(line.id, activeStep.id)}
                                        className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                                          activeStep.isCompleted
                                            ? "bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300"
                                            : "bg-emerald-700 hover:bg-emerald-800 text-white"
                                        }`}
                                      >
                                        <CheckSquare className="w-3.5 h-3.5" />
                                        {activeStep.isCompleted ? "Re-open Sub-Assembly Stage" : "Mark Sub-Assembly Stage Complete"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Master Assembly Completion Section */}
                            <div className="pt-3 border-t border-slate-200 flex items-center justify-between bg-purple-50/40 p-4 rounded-xl border border-purple-200">
                              <div>
                                <div className="font-bold text-purple-950 text-xs flex items-center gap-1.5">
                                  <CheckCircle2 className="w-4 h-4 text-purple-700" />
                                  Master Assembly Stage Status
                                </div>
                                <div className="text-[11px] text-slate-600 font-mono mt-0.5">
                                  Overall Status: <strong className="text-slate-900">{assemblyMs.status}</strong> | Start: {assemblyMs.actualStartDate || assemblyMs.committedBaselineStartDate} | End: {assemblyMs.actualEndDate || 'Pending'}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isPreviousCompleted && isRoleAuthorized && !po.isClosed && assemblyMs.status !== "Completed" && (
                                  <button
                                    onClick={() => onOpenManualInput(po, line, assemblyMs, "complete")}
                                    className="px-4 py-2 bg-purple-800 hover:bg-purple-900 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5"
                                  >
                                    <CheckSquare className="w-4 h-4" />
                                    Mark Master Assembly Stage Complete
                                  </button>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


