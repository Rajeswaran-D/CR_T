import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { Truck, CheckCircle2, ChevronDown, ChevronUp, Package, AlertTriangle, Edit3, Calendar } from "lucide-react";
import type { PurchaseOrder, ProductLine, Milestone } from "../../types";
import { isMilestoneOwnedByRole } from "../../types";
import { getPOManufacturingStatus } from "../../utils/statusUtils";

interface DeliveryModuleProps {
  onOpenManualInput: (po: PurchaseOrder, line: ProductLine, ms: Milestone, type: "start" | "complete") => void;
}

export const DeliveryDispatchModule: React.FC<DeliveryModuleProps> = ({ onOpenManualInput }) => {
  const { purchaseOrders, closePurchaseOrder, activeRole } = useApp();
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [closingPO, setClosingPO] = useState<string | null>(null);
  const [closureNotes, setClosureNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "completed">("active");
  const [successMsg, setSuccessMsg] = useState("");

  const deliveryKeys = ["shipment", "dispatch", "delivery"];

  const handleClose = (poId: string) => {
    const notesToUse = closureNotes.trim() || "Order completed and delivered — closed by operator.";
    closePurchaseOrder(poId, notesToUse, "Plant Operator");
    setClosingPO(null);
    setClosureNotes("");
    setSuccessMsg("Order closed successfully!");
    setTimeout(() => setSuccessMsg(""), 5000);
  };

  const canManageStage = isMilestoneOwnedByRole('shipment', activeRole);

  const isPOReadyForDispatch = (po: PurchaseOrder) => {
    return (po.productLines || []).some(line => {
      const shipMs = (line.milestones || []).find(m => deliveryKeys.includes(m.key));
      if (!shipMs) return false;
      const msIdx = (line.milestones || []).findIndex(m => m.id === shipMs.id || m.key === shipMs.key);
      const prevMs = msIdx > 0 ? line.milestones[msIdx - 1] : null;
      const isPrereqDone = !prevMs || prevMs.status === 'Completed' || Boolean(prevMs.actualEndDate) || prevMs.completionPct === 100;
      const isDone = shipMs.status === 'Completed' || Boolean(shipMs.actualEndDate) || shipMs.completionPct === 100;
      return isPrereqDone && !isDone;
    });
  };

  const filteredOrders = purchaseOrders
    .filter(po => po.status !== "Baseline Pending" && po.status !== "Cancelled" && !po.isCancelled)
    .filter(po => {
      if (statusFilter === "active") {
        return !po.isClosed && po.status !== "Completed" && isPOReadyForDispatch(po);
      }
      if (statusFilter === "completed") {
        return po.isClosed || po.status === "Completed";
      }
      return true;
    });

  const activeCount = purchaseOrders.filter(po => po.status !== "Baseline Pending" && po.status !== "Cancelled" && !po.isCancelled && !po.isClosed && po.status !== "Completed" && isPOReadyForDispatch(po)).length;
  const completedCount = purchaseOrders.filter(po => po.status !== "Baseline Pending" && po.status !== "Cancelled" && !po.isCancelled && (po.isClosed || po.status === "Completed")).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Unified Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STAGE 14 OF 14
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              Stores (Shipment)
            </span>
            {!canManageStage && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                VIEW ONLY
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight">14. Final Shipment & Dispatch</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Track packing clearance, customs dispatch, site delivery confirmation, and close completed orders.
          </p>
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-1.5 bg-black/30 p-1.5 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              statusFilter === "active"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-300 hover:text-white"
            }`}
          >
            Active Queue ({activeCount})
          </button>
          <button
            onClick={() => setStatusFilter("completed")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              statusFilter === "completed"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-300 hover:text-white"
            }`}
          >
            Completed ({completedCount})
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
              statusFilter === "all"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-300 hover:text-white"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 font-semibold">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> {successMsg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Dispatch and Delivery Tracker</h2>
            <p className="text-xs text-slate-500 mt-0.5">Update dispatch dates, confirm site delivery, and close completed orders.</p>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-medium">
              No orders found in this view.
            </div>
          ) : filteredOrders.map(po => {
            const isExpanded = expandedPO === po.id;
            const isClosed = po.isClosed;
            const statusSummary = getPOManufacturingStatus(po);

            return (
              <div key={po.id} className={isClosed ? "opacity-60" : ""}>
                <div className="w-full px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                  <button 
                    onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                    className="flex-1 text-left flex items-center gap-4 cursor-pointer"
                  >
                    <span className="font-mono font-bold text-emerald-800 text-sm">{po.poNumber}</span>
                    <span className="font-semibold text-slate-900">{po.customerName}</span>
                    <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono">
                      <Calendar className="w-3 h-3 text-slate-500" /> {po.poDate} &rarr; <strong className="text-emerald-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
                    </span>
                    {isClosed ? (
                      statusSummary.delayDays > 0 ? (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          <AlertTriangle className="w-3 h-3 text-amber-700" /> Completed by delay of {statusSummary.delayDays} days
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Completed On Time
                        </span>
                      )
                    ) : statusSummary.isDelayed ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        <AlertTriangle className="w-3 h-3" /> Delayed (+{statusSummary.delayDays}d)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        On Time
                      </span>
                    )}
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      Stage: <strong className="text-slate-700">{statusSummary.currentStageName}</strong>
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
                  <div className="px-6 pb-6 space-y-5 bg-slate-50/30">
                    {po.productLines.map(line => {
                      const dispatchDeliveryMs = line.milestones.filter(m => deliveryKeys.includes(m.key));
                      return (
                        <div key={line.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                            {line.lineNumber}: {line.productName}
                          </div>
                          <div className="p-4 space-y-3">
                            {dispatchDeliveryMs.length === 0 ? (
                              <div className="text-xs text-slate-400 py-3 text-center">No dispatch or delivery milestones found.</div>
                            ) : (
                              dispatchDeliveryMs.map(ms => {
                                const isCompleted = ms.status === "Completed" || Boolean(ms.actualEndDate);
                                const isInProgress = (ms.status === "In Progress" || Boolean(ms.actualStartDate)) && !isCompleted;
                                const msIdx = line.milestones.findIndex(m => m.id === ms.id || m.key === ms.key);
                                const prevMs = msIdx > 0 ? line.milestones[msIdx - 1] : null;
                                const currVar = Math.max(0, typeof ms.varianceDays === 'number' ? ms.varianceDays : 0);
                                const prevVar = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;
                                const recoveredDays = isCompleted ? Math.max(0, prevVar - currVar) : 0;
                                return (
                                  <div key={ms.id} className={`p-4 border rounded-xl flex items-center justify-between text-xs ${
                                    isCompleted ? "bg-emerald-50/40 border-emerald-200" :
                                    isInProgress ? "bg-blue-50/40 border-blue-200" :
                                    "bg-slate-50 border-slate-200"
                                  }`}>
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                                        {isCompleted ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                                          ms.key === "dispatch" ? <Package className="w-4 h-4 text-slate-500" /> : <Truck className="w-4 h-4 text-slate-500" />}
                                        {ms.name}
                                      </div>
                                      <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
                                        <span>Baseline: <strong className="text-slate-700">{ms.committedBaselineEndDate}</strong></span>
                                        {ms.actualStartDate && <span>Started: <strong className="text-blue-700">{ms.actualStartDate}</strong></span>}
                                        {ms.actualEndDate && <span>Done: <strong className="text-emerald-700">{ms.actualEndDate}</strong></span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                                        isCompleted ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                                        isInProgress ? "bg-blue-100 text-blue-800 border-blue-300" :
                                        ms.status === "Delayed" ? "bg-rose-100 text-rose-800 border-rose-300" :
                                        "bg-slate-100 text-slate-700 border-slate-300"
                                      }`}>{isCompleted ? (recoveredDays > 0 ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved)` : "Completed") : isInProgress ? (ms.status === "Delayed" || (ms.varianceDays && ms.varianceDays > 0) ? `In Execution (+${ms.varianceDays}d)` : "In Execution") : ms.status}</span>
                                      
                                      {!isClosed && po.status !== 'Completed' && isMilestoneOwnedByRole(ms.key, activeRole) && (
                                        <div className="flex items-center gap-1.5 ml-2">
                                          {!ms.actualStartDate && ms.status !== 'Completed' ? (
                                            <button
                                              onClick={() => onOpenManualInput(po, line, ms, 'start')}
                                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                                            >
                                              Record Start
                                            </button>
                                          ) : ms.status !== 'Completed' ? (
                                            <button
                                              onClick={() => onOpenManualInput(po, line, ms, 'start')}
                                              className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-medium cursor-pointer transition-colors flex items-center gap-1"
                                              title="Edit / Re-enter Start Date"
                                            >
                                              <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                                            </button>
                                          ) : null}
                                          {ms.status !== 'Completed' ? (
                                            <button
                                              onClick={() => onOpenManualInput(po, line, ms, 'complete')}
                                              className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors"
                                            >
                                              Mark Complete
                                            </button>
                                          ) : (
                                            <span className="text-[11px] font-semibold text-emerald-700">Completed</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {!isClosed && (() => {
                      const allMilestonesComplete = po.productLines.length > 0 && po.productLines.every(line =>
                        line.milestones.every(m => m.status === "Completed" || Boolean(m.actualEndDate) || m.completionPct === 100)
                      );
                      const canCloseRole = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';

                      if (!canCloseRole) {
                        return allMilestonesComplete ? (
                          <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2.5">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                              <div>
                                <div className="font-bold text-xs text-emerald-950">All 14 Stages & Shipment Complete</div>
                                <div className="text-[11px] text-emerald-700">Awaiting Project Manager (PM Baseline) to formally verify and close this order.</div>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold font-mono rounded-lg border border-emerald-300 shrink-0">
                              PM Baseline Sign-Off Required
                            </span>
                          </div>
                        ) : null;
                      }

                      return (
                        <div className={`border rounded-xl p-5 space-y-3 ${allMilestonesComplete ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-100 border-slate-200"}`}>
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <div className={`flex items-center gap-2 font-bold text-sm ${allMilestonesComplete ? "text-emerald-900" : "text-slate-700"}`}>
                                <CheckCircle2 className={`w-5 h-5 ${allMilestonesComplete ? "text-emerald-600" : "text-slate-400"}`} />
                                Order Action: Close Purchase Order
                              </div>
                              {!allMilestonesComplete && (
                                <p className="text-[11px] text-amber-700 font-medium">
                                  All milestones across all product lines must be completed before closing this order.
                                </p>
                              )}
                            </div>
                            {closingPO !== po.id && (
                              <button
                                disabled={!allMilestonesComplete}
                                onClick={() => setClosingPO(po.id)}
                                className={`px-4 py-2 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 shadow-xs ${
                                  allMilestonesComplete
                                    ? "bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer"
                                    : "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
                                }`}
                              >
                                Close Order
                              </button>
                            )}
                          </div>

                          {closingPO === po.id && (
                            <div className="space-y-3 pt-2">
                              <textarea
                                value={closureNotes}
                                onChange={e => setClosureNotes(e.target.value)}
                                rows={2}
                                placeholder="Enter closure notes (e.g. Site sign-off complete, dispatch reference DO-2026-09)..."
                                className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600 bg-white resize-none"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleClose(po.id)}
                                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
                                >
                                  Confirm Closure
                                </button>
                                <button
                                  onClick={() => { setClosingPO(null); setClosureNotes(""); }}
                                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {isClosed && po.closureNotes && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
                        <span className="font-bold text-slate-800">Closure Notes: </span>{po.closureNotes}
                      </div>
                    )}
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
