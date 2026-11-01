import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { CheckCircle2, ChevronDown, ChevronUp, Lock, AlertTriangle, Calendar } from "lucide-react";
import { getPOManufacturingStatus } from "../../utils/statusUtils";
import { todayLocal, addDays, getDaysDifference } from "../../services/calculationEngine";

import { isMilestoneOwnedByRole } from "../../types";

export const RawMaterialsModule: React.FC = () => {
  const { purchaseOrders, updateMaterialItem, activeRole } = useApp();
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [editingMat, setEditingMat] = useState<{ poId: string; lineId: string; matId: string } | null>(null);
  const [orderedDate, setOrderedDate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [inspectionResult, setInspectionResult] = useState<"Passed" | "Rejected" | "Pending">("Pending");
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "completed">("active");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const today = todayLocal();

  const handleSave = (poId: string, lineId: string, matId: string, docRef: string) => {
    const result = updateMaterialItem({
      poId,
      productLineId: lineId,
      materialId: matId,
      orderedDate: orderedDate.trim(),
      expectedDate: expectedDate.trim(),
      receivedDate: receivedDate.trim(),
      inspectionResult,
      user: `${activeRole} Operator`,
      docRef
    });

    if (!result.success) {
      setErrorMsg(result.error || "Failed to update material status.");
      setSuccessMsg("");
      setTimeout(() => setErrorMsg(""), 6000);
      return;
    }
    setEditingMat(null);
    setErrorMsg("");
    setSuccessMsg("Material status updated successfully.");
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const canManageStage = isMilestoneOwnedByRole('material_receipt', activeRole);

  const filteredOrders = purchaseOrders
    .filter(po => po.status !== "Baseline Pending")
    .filter(po => {
      if (statusFilter === "active") {
        return !po.isClosed && po.status !== "Completed";
      }
      if (statusFilter === "completed") {
        return po.isClosed || po.status === "Completed";
      }
      return true;
    });

  const activeCount = purchaseOrders.filter(po => po.status !== "Baseline Pending" && !po.isClosed && po.status !== "Completed").length;
  const completedCount = purchaseOrders.filter(po => po.status !== "Baseline Pending" && (po.isClosed || po.status === "Completed")).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Unified Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STAGE 7 OF 14
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              Stores (Material Receipt)
            </span>
            {!canManageStage && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                VIEW ONLY
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight">7. Material Incoming Receipt</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Track raw material purchase orders, record actual receipt dates (GRN), and log incoming material quality inspections.
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

      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 font-semibold">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" /> {errorMsg}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Purchase Orders - Materials Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">Update order dates, receipt status, and incoming inspection results for each material item.</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-medium">
              No orders found in this view.
            </div>
          ) : filteredOrders.map(po => {
            const isExpanded = expandedPO === po.id;
            const statusSummary = getPOManufacturingStatus(po);
            const allMats = po.productLines.flatMap(l => l.materials.map(m => ({ ...m, lineId: l.id, lineName: l.lineNumber })));
            const received = allMats.filter(m => m.receivedDate).length;
            const inspPassed = allMats.filter(m => m.inspectionResult === "Passed").length;
            const hasNewDesign = po.productLines.some(l => l.designType === "New Design");
            const designApproved = !hasNewDesign || po.productLines.every(l => {
              const designMs = l.milestones.find(m => m.key === "design_approval");
              return !designMs || designMs.status === "Completed";
            });

            return (
              <div key={po.id}>
                <button onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                  className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="font-mono font-bold text-emerald-800 text-sm">{po.poNumber}</span>
                    <span className="font-semibold text-slate-900">{po.customerName}</span>
                    <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono">
                      <Calendar className="w-3 h-3 text-slate-500" /> {po.poDate} &rarr; <strong className="text-emerald-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
                    </span>
                    {po.isClosed && <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-600 text-[10px] font-bold">CLOSED</span>}
                    {!designApproved && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 border border-purple-200 text-purple-800">
                        <Lock className="w-3 h-3" /> Locked - Design Pending
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-xs">
                      <div className="text-slate-700 font-semibold">{received}/{allMats.length} Received</div>
                      <div className="text-emerald-700 font-semibold">{inspPassed} Inspection Passed</div>
                    </div>
                    <div className="hidden lg:block text-right text-[10px]">
                      <div className="font-semibold text-slate-700">{statusSummary.currentStageName}</div>
                      <div className={statusSummary.isDelayed ? "text-rose-700 font-semibold" : "text-slate-500"}>
                        {statusSummary.isDelayed ? `${statusSummary.delayedStageName || 'Flow'} +${statusSummary.delayDays}d` : `${statusSummary.progressPercent}% complete`}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 space-y-5 bg-slate-50/30">
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-slate-900">Manufacturing flow</span>
                          <span className="text-slate-500 ml-2">Current stage: {statusSummary.currentStageName}</span>
                        </div>
                        <span className="font-mono font-bold text-emerald-700">{statusSummary.progressPercent}%</span>
                      </div>
                      <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${statusSummary.isDelayed ? 'bg-rose-500' : 'bg-emerald-600'}`} style={{ width: `${statusSummary.progressPercent}%` }} />
                      </div>
                      {statusSummary.isDelayed && (
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-700 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Delay recorded at {statusSummary.delayedStageName || statusSummary.currentStageName}: +{statusSummary.delayDays} days
                        </div>
                      )}
                    </div>
                    {!designApproved && (
                      <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-800">
                        <Lock className="w-4 h-4 shrink-0" />
                        <span>Raw material procurement is locked until the Design Stage is completed and BOM is finalized for this New Design order.</span>
                      </div>
                    )}
                    {po.productLines.map(line => (
                      <div key={line.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                          {line.lineNumber}: {line.productName}
                        </div>
                        <div className="px-4 py-3 grid grid-cols-2 gap-3 border-b border-slate-100 text-[11px]">
                          {line.milestones.filter(m => m.key === "material_receipt" || m.key === "raw_material").map(ms => {
                            const mIdx = line.milestones.findIndex(m => m.id === ms.id || m.key === ms.key);
                            const prevMs = mIdx > 0 ? line.milestones[mIdx - 1] : null;
                            const currVar = Math.max(0, typeof ms.varianceDays === 'number' ? ms.varianceDays : 0);
                            const prevVar = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;
                            const stageDelta = Math.max(0, currVar - prevVar);

                            return (
                              <div key={ms.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                                <span className="text-slate-600">{ms.name}</span>
                                <span className={`font-semibold ${
                                  ms.status === "Completed" ? "text-emerald-700" :
                                  stageDelta > 0 ? "text-rose-700" :
                                  currVar > 0 ? "text-slate-700" :
                                  "text-slate-700"
                                }`}>
                                  {ms.status === "Completed" ? "Completed" : stageDelta > 0 ? `Delay (+${stageDelta}d)` : currVar > 0 ? `Previous (+${currVar}d)` : ms.status}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {line.materials.length === 0 ? (
                          <div className="py-6 text-center text-slate-400 text-xs">No materials defined for this line.</div>
                        ) : (
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-100/60 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                                <th className="py-3 px-4">Item Code</th>
                                <th className="py-3 px-4">Description</th>
                                <th className="py-3 px-4">Lead Time</th>
                                <th className="py-3 px-4">Order Date (Planned / Revised)</th>
                                <th className="py-3 px-4">Expected Delivery (Planned / Revised)</th>
                                <th className="py-3 px-4">Received / GRN</th>
                                <th className="py-3 px-4 text-center">Inspection</th>
                                <th className="py-3 px-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {line.materials.map(mat => {
                                const isEditing = editingMat?.matId === mat.id;
                                const receiptMs = line.milestones.find(m => m.key === 'material_receipt' || m.key === 'raw_material');
                                const baselineOrderDate = receiptMs?.committedBaselineStartDate || po.poDate;
                                const baselineExpectedDate = addDays(baselineOrderDate, Math.max(0, (mat.leadTimeDays || 14) - 1));

                                const displayOrderDate = mat.orderedDate || baselineOrderDate;
                                const displayExpectedDate = mat.expectedDate || baselineExpectedDate;
                                const orderShiftDays = mat.orderedDate ? getDaysDifference(baselineOrderDate, mat.orderedDate) : 0;
                                const delivShiftDays = mat.expectedDate ? getDaysDifference(baselineExpectedDate, mat.expectedDate) : 0;

                                return (
                                  <tr key={mat.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                                      {mat.itemCode}
                                      {mat.isCriticalPath && <span className="ml-1.5 px-1.5 py-0.5 bg-rose-100 text-rose-800 text-[9px] font-bold rounded border border-rose-200">CRITICAL</span>}
                                    </td>
                                    <td className="py-3 px-4 text-slate-700">{mat.description}</td>
                                    <td className="py-3 px-4 font-mono text-slate-600">{mat.leadTimeDays}d</td>
                                    <td className="py-3 px-4">
                                      <div>
                                        <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                          <span>Plan:</span>
                                          <span className="font-semibold text-slate-700">{baselineOrderDate}</span>
                                        </div>
                                        <div className="font-mono text-xs font-bold text-slate-900 flex items-center gap-1 mt-0.5">
                                          <span className={mat.orderedDate ? 'text-blue-700' : 'text-slate-800'}>
                                            {displayOrderDate}
                                          </span>
                                          {orderShiftDays > 0 && (
                                            <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-bold">
                                              +{orderShiftDays}d
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">
                                      <div>
                                        <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                          <span>Plan:</span>
                                          <span className="font-semibold text-slate-700">{baselineExpectedDate}</span>
                                        </div>
                                        <div className="font-mono text-xs font-bold flex items-center gap-1 mt-0.5">
                                          <span className={delivShiftDays > 0 ? 'text-rose-700' : 'text-emerald-800'}>
                                            {displayExpectedDate}
                                          </span>
                                          {delivShiftDays > 0 && (
                                            <span className="text-[9px] px-1 py-0.2 bg-rose-100 text-rose-800 rounded font-bold">
                                              +{delivShiftDays}d late
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">
                                      {mat.receivedDate ? (
                                        <div>
                                          <div className="font-mono text-emerald-700 font-bold">{mat.receivedDate}</div>
                                          <div className="text-[10px] text-emerald-600 font-medium">GRN Logged</div>
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 font-mono text-[11px]">Pending Receipt</span>
                                      )}
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                        mat.inspectionResult === "Passed" ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                                        mat.inspectionResult === "Rejected" ? "bg-rose-100 text-rose-800 border-rose-300" :
                                        "bg-slate-100 text-slate-600 border-slate-300"
                                      }`}>
                                        {mat.inspectionResult || "Pending"}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      {po.isClosed || po.status === 'Completed' ? (
                                        <span className="text-[11px] font-semibold text-emerald-800 flex items-center justify-end gap-1">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Completed
                                        </span>
                                      ) : !designApproved ? (
                                        <Lock className="w-4 h-4 text-slate-300 ml-auto" />
                                      ) : !isMilestoneOwnedByRole('material_receipt', activeRole) ? (
                                        <span className="text-[10px] text-slate-400 font-medium">Read Only</span>
                                      ) : isEditing ? (
                                        <button onClick={() => setEditingMat(null)} className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Cancel</button>
                                      ) : (
                                        <button onClick={() => {
                                          setEditingMat({ poId: po.id, lineId: line.id, matId: mat.id });
                                          const initialOrder = mat.orderedDate || baselineOrderDate;
                                          const initialExpected = mat.expectedDate || baselineExpectedDate;
                                          const initialReceived = mat.receivedDate || "";
                                          setOrderedDate(initialOrder);
                                          setExpectedDate(initialExpected);
                                          setReceivedDate(initialReceived);
                                          setInspectionResult(mat.inspectionResult || "Pending");
                                        }} className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer">
                                          Update
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}

                        {editingMat && line.materials.some(m => m.id === editingMat.matId) && (() => {
                          const currentMat = line.materials.find(m => m.id === editingMat.matId)!;
                          const receiptMs = line.milestones.find(m => m.key === 'material_receipt' || m.key === 'raw_material');
                          const baselineOrderDate = receiptMs?.committedBaselineStartDate || po.poDate;
                          const baselineExpectedDate = addDays(baselineOrderDate, Math.max(0, (currentMat.leadTimeDays || 14) - 1));
                          const activeOrderShift = orderedDate ? getDaysDifference(baselineOrderDate, orderedDate) : 0;
                          const activeDelivShift = expectedDate ? getDaysDifference(baselineExpectedDate, expectedDate) : 0;

                          return (
                            <div className="border-t border-slate-200 p-4 bg-emerald-50/50 space-y-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-bold text-slate-800">Update Material Status &amp; Delivery Schedule</p>
                                  <p className="text-[11px] text-slate-500">Item: <strong className="text-slate-800">{currentMat.itemCode}</strong> — {currentMat.description} (Lead time: {currentMat.leadTimeDays} days)</p>
                                </div>
                                <span className="text-[10px] text-emerald-800 font-mono font-bold bg-emerald-100 px-2.5 py-0.5 rounded border border-emerald-200">
                                  Stage 7 Planned Window: {receiptMs?.committedBaselineStartDate || po.poDate} &rarr; {receiptMs?.committedBaselineEndDate || po.committedDeliveryDate}
                                </span>
                              </div>

                              {/* Planned vs Revised Comparison Card */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3.5 rounded-xl border border-emerald-200 text-xs shadow-2xs">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Order Placement Timeline</span>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Planned (Baseline):</span>
                                    <strong className="text-slate-800">{baselineOrderDate}</strong>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Revised / Selected:</span>
                                    <strong className={activeOrderShift > 0 ? "text-amber-800 font-bold" : "text-blue-800"}>
                                      {orderedDate || baselineOrderDate} {activeOrderShift > 0 ? `(+${activeOrderShift}d shift)` : ''}
                                    </strong>
                                  </div>
                                </div>

                                <div className="space-y-1 sm:border-l sm:border-slate-200 sm:pl-3">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Material Delivery Timeline</span>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Planned (Baseline):</span>
                                    <strong className="text-slate-800">{baselineExpectedDate}</strong>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Revised / Expected:</span>
                                    <strong className={activeDelivShift > 0 ? "text-rose-700 font-bold" : "text-emerald-800 font-bold"}>
                                      {expectedDate || baselineExpectedDate} {activeDelivShift > 0 ? `(+${activeDelivShift}d delay)` : ''}
                                    </strong>
                                  </div>
                                </div>

                                <div className="space-y-1 sm:border-l sm:border-slate-200 sm:pl-3">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Overall PO Delivery Schedule</span>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Planned PO Delivery:</span>
                                    <strong className="text-slate-800">{po.committedDeliveryDate}</strong>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <span className="text-slate-500">Revised PO Delivery:</span>
                                    <strong className={po.revisedDeliveryDate ? "text-rose-700 font-bold" : "text-emerald-800"}>
                                      {po.revisedDeliveryDate || po.committedDeliveryDate}
                                    </strong>
                                  </div>
                                </div>
                              </div>

                              {errorMsg && (
                                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2 font-medium">
                                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                  <span>{errorMsg}</span>
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold text-slate-700">Order Placement Date</label>
                                    <button type="button" onClick={() => setOrderedDate(today)} className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer">Today</button>
                                  </div>
                                  <input type="date" value={orderedDate} onChange={e => setOrderedDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600 bg-white shadow-2xs" />
                                  <div className="text-[10px] text-slate-500 font-mono mt-1 flex justify-between">
                                    <span>Plan: <strong>{baselineOrderDate}</strong></span>
                                    <span>Revised: <strong className="text-blue-700">{orderedDate || baselineOrderDate}</strong></span>
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold text-slate-700">Expected Delivery Date</label>
                                    <button type="button" onClick={() => setExpectedDate(today)} className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer">Today</button>
                                  </div>
                                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600 bg-white shadow-2xs" />
                                  <div className="text-[10px] text-slate-500 font-mono mt-1 flex justify-between">
                                    <span>Plan: <strong>{baselineExpectedDate}</strong></span>
                                    <span>Revised: <strong className={activeDelivShift > 0 ? "text-rose-700" : "text-emerald-800"}>{expectedDate || baselineExpectedDate}</strong></span>
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold text-slate-700">Actual Received Date (GRN)</label>
                                    <div className="flex gap-2">
                                      <button type="button" onClick={() => setReceivedDate(today)} className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer">Today</button>
                                      <button type="button" onClick={() => setReceivedDate("")} className="text-[10px] text-slate-400 font-bold hover:underline cursor-pointer">Clear</button>
                                    </div>
                                  </div>
                                  <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-600 bg-white shadow-2xs" />
                                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                                    <span>Target Planned: <strong>{baselineExpectedDate}</strong></span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] font-bold text-slate-700">Inspection Result:</label>
                                  <select value={inspectionResult} onChange={e => setInspectionResult(e.target.value as any)}
                                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold focus:outline-none focus:border-emerald-600 bg-white cursor-pointer shadow-2xs">
                                    <option value="Pending">Pending</option>
                                    <option value="Passed">Passed (Accept GRN)</option>
                                    <option value="Rejected">Rejected (NC Triggered)</option>
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => setEditingMat(null)} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-medium cursor-pointer">Cancel</button>
                                  <button onClick={() => handleSave(editingMat.poId, editingMat.lineId, editingMat.matId, "MATERIAL-UPDATE")}
                                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs">
                                    Save Material Update
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
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



