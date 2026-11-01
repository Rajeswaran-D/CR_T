import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { 
  X, 
  AlertTriangle, 
  Lock, 
  Package, 
  Wrench, 
  Play, 
  CheckSquare,
  CheckCircle2,
  Edit3,
  XCircle,
  ShieldAlert,
  LayoutGrid
} from 'lucide-react';
import { getPOManufacturingStatus, getStageFriendlyName } from '../../utils/statusUtils';
import { getMilestoneRevisedDates } from '../../services/calculationEngine';
import { BaselineRevisionModal } from './BaselineRevisionModal';
import { OrderProgressOverview } from '../common/OrderProgressOverview';
import { DelayAnalysisFlow } from '../common/DelayAnalysisFlow';

const ALL_14_STAGES = [
  { key: 'po_from_customer', label: '1. Customer PO' },
  { key: 'pm_baseline', label: '2. PM Baseline' },
  { key: 'corb_release', label: '3. CORB' },
  { key: 'bom_release', label: '4. BOM' },
  { key: 'wo_release', label: '5. WO' },
  { key: 'sub_supplier_po', label: '6. Sub-PO' },
  { key: 'material_receipt', label: '7. GRN' },
  { key: 'machining', label: '8. Machining' },
  { key: 'assembly', label: '9. Assembly' },
  { key: 'fg', label: '10. FG' },
  { key: 'customer_inspection', label: '11. Cust Insp' },
  { key: 'painting', label: '12. Painting' },
  { key: 'trn', label: '13. TRN' },
  { key: 'shipment', label: '14. Shipment' }
];

interface PODetailDrawerProps {
  po: PurchaseOrder | null;
  onClose: () => void;
  onOpenManualInput: (po: PurchaseOrder, line: any, ms: any, type: 'start' | 'complete') => void;
  onOpenCancelModal?: (po: PurchaseOrder) => void;
}

export const PODetailDrawer: React.FC<PODetailDrawerProps> = ({
  po,
  onClose,
  onOpenManualInput,
  onOpenCancelModal
}) => {
  const { activeRole, closePurchaseOrder } = useApp();
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [closureNotes, setClosureNotes] = useState('');
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [closeNoteError, setCloseNoteError] = useState(false);
  const [drawerView, setDrawerView] = useState<'timeline' | 'matrix'>('timeline');
  const [closureError, setClosureError] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string>('');

  if (!po) return null;

  const statusSummary = getPOManufacturingStatus(po);
  const selectedLine = po.productLines.find(l => l.id === selectedLineId) || po.productLines[0];

  const delayedLines = (po.productLines || []).filter(l => l.status === 'Delayed' || (l.overallVarianceDays && l.overallVarianceDays > 0));

  const allMilestonesComplete = po.productLines.length > 0 && po.productLines.every(line =>
    (line.milestones || []).length > 0 && line.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
  );

  const canClosePO = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';
  const canReviseBaseline = activeRole === 'Project Manager (PM Baseline)' || activeRole === 'Project Management';
  const isAdmin = activeRole === 'Project Management';
  const hasPendingCancel = po.cancellationRequest?.status === 'Pending';

  const handleClosePO = () => {
    if (!closureNotes.trim()) {
      setCloseNoteError(true);
      return;
    }
    setCloseNoteError(false);
    const result = closePurchaseOrder(po.id, closureNotes, `${activeRole} User`);
    if (!result.success) {
      setClosureError(result.error || 'Failed to close order');
      return;
    }
    setClosureError(null);
    setShowClosePrompt(false);
    // Close the drawer so updated status is visible across tabs
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex justify-end">
        <div className={`w-full ${drawerView === 'matrix' ? 'max-w-5xl' : 'max-w-2xl'} bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl text-slate-800 transition-all duration-200`}>
          
          {/* Header */}
          <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-extrabold text-slate-900 text-lg">{po.poNumber}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  po.status === 'Cancelled' || po.isCancelled ? 'bg-rose-100 border-rose-300 text-rose-800' :
                  po.isClosed ? (statusSummary.delayDays > 0 ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800') :
                  statusSummary.isDelayed ? 'bg-rose-50 border-rose-200 text-rose-800' :
                  'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {po.status === 'Cancelled' || po.isCancelled 
                    ? 'CANCELLED' 
                    : po.isClosed 
                    ? (statusSummary.delayDays > 0 ? `COMPLETED BY DELAY OF ${statusSummary.delayDays} DAYS` : 'COMPLETED ON TIME') 
                    : statusSummary.isDelayed 
                    ? `DELAYED (+${statusSummary.delayDays}d)` 
                    : 'ON TIME'}
                </span>
                {po.productLines && po.productLines.length > 1 && (
                  <div className="flex bg-slate-200 p-0.5 rounded-lg text-xs ml-1">
                    <button
                      onClick={() => setDrawerView('timeline')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        drawerView === 'timeline' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Single Flow
                    </button>
                    <button
                      onClick={() => setDrawerView('matrix')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        drawerView === 'matrix' ? 'bg-emerald-700 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      14-Stage Matrix
                    </button>
                  </div>
                )}
                {hasPendingCancel && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 font-mono text-[10px] font-bold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-amber-600" /> CANCEL PENDING
                  </span>
                )}
                {po.isClosed && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px] flex items-center gap-1">
                    <Lock className="w-3 h-3" /> CLOSED
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Customer: <span className="font-semibold text-slate-800">{po.customerName}</span> | Ref: {po.customerPoRef}
                {po.bookedAmount !== undefined && (
                  <> | Booked: <span className="font-mono font-bold text-emerald-800">${Number(po.bookedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {canReviseBaseline && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => setShowRevisionModal(true)}
                  className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Wrench className="w-3.5 h-3.5" /> Baseline Edit
                </button>
              )}

              {canClosePO && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => setShowClosePrompt(true)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                    allMilestonesComplete
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-md ring-2 ring-emerald-400/40 animate-pulse'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {allMilestonesComplete ? 'Close Order (Ready)' : 'Close Order'}
                </button>
              )}

              {onOpenCancelModal && !po.isClosed && po.status !== 'Cancelled' && (
                <button
                  onClick={() => onOpenCancelModal(po)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 border ${
                    hasPendingCancel
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                      : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                  }`}
                  title={isAdmin ? 'Decide on cancellation or cancel/delete order' : 'Request order cancellation with reason'}
                >
                  {hasPendingCancel ? (
                    <>
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      <span>{isAdmin ? 'Review Cancel' : 'Cancel Pending'}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>{isAdmin ? 'Cancel / Delete' : 'Request Cancel'}</span>
                    </>
                  )}
                </button>
              )}

              <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 text-xs">

            {/* PENDING CANCELLATION REQUEST BANNER */}
            {hasPendingCancel && po.cancellationRequest && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-amber-900 text-xs flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Cancellation Request Awaiting Administrator Decision
                  </span>
                  {onOpenCancelModal && (
                    <button
                      onClick={() => onOpenCancelModal(po)}
                      className="px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer"
                    >
                      {isAdmin ? 'Decide & Review' : 'View Request'}
                    </button>
                  )}
                </div>
                <div className="bg-white/80 p-3 rounded-lg border border-amber-200 text-slate-800 text-xs space-y-1">
                  <div className="font-semibold text-slate-900">
                    Reason: <span className="font-normal italic text-slate-700">"{po.cancellationRequest.reason}"</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Requested by: <span className="font-bold text-slate-700">{po.cancellationRequest.requestedBy}</span> ({po.cancellationRequest.requestedRole}) at {new Date(po.cancellationRequest.requestedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            )}

            {/* CANCELLED ORDER BANNER */}
            {(po.status === 'Cancelled' || po.isCancelled) && (
              <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl space-y-1.5 shadow-xs">
                <div className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-rose-600" />
                  Order Cancelled & Archived
                </div>
                <p className="text-slate-700 text-xs">
                  Reason: <span className="font-semibold italic text-slate-900">{po.cancellationReason || po.cancellationRequest?.reason || 'Cancelled by Administrator'}</span>
                </p>
                {po.cancelledBy && (
                  <p className="text-[10px] text-slate-500 font-mono">
                    Cancelled by {po.cancelledBy} on {po.cancelledAt ? new Date(po.cancelledAt).toLocaleString() : 'N/A'}
                  </p>
                )}
              </div>
            )}

            {showClosePrompt && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3 text-xs shadow-xs">
                <div className="font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" /> Confirm Order Closure
                </div>
                {!allMilestonesComplete ? (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Cannot close order: Not all milestones have been completed across the product lines. Please complete all preceding milestones (such as dispatch and site delivery) first.</span>
                  </div>
                ) : (
                  <p className="text-slate-700">
                    Closing this order locks all stages. Add closure notes below.
                  </p>
                )}
                <input
                  type="text"
                  disabled={!allMilestonesComplete}
                  placeholder="e.g. Delivered & signed off by customer on site — ref: DO-2026-09"
                  value={closureNotes}
                  onChange={(e) => { setClosureNotes(e.target.value); setCloseNoteError(false); }}
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-xs text-slate-800 focus:outline-none ${!allMilestonesComplete ? 'opacity-50 cursor-not-allowed bg-slate-100' : closeNoteError ? 'border-rose-400 ring-1 ring-rose-300' : 'border-slate-200 focus:border-emerald-600'}`}
                />
                {closeNoteError && (
                  <p className="text-rose-700 text-[11px] font-semibold">Closure notes are required before closing.</p>
                )}
                {closureError && (
                  <p className="text-rose-700 text-[11px] font-semibold">{closureError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowClosePrompt(false); setCloseNoteError(false); setClosureError(null); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-medium cursor-pointer">
                    Cancel
                  </button>
                  <button
                    disabled={!allMilestonesComplete}
                    onClick={handleClosePO}
                    className={`px-3.5 py-1.5 rounded-lg font-bold shadow-xs ${allMilestonesComplete ? 'bg-amber-700 hover:bg-amber-800 text-white cursor-pointer' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                  >
                    Confirm & Close Order
                  </button>
                </div>
              </div>
            )}

            {/* TIMELINE VALIDATION & SCHEDULE HEALTH CHECK STEP */}
            <div className={`p-4 rounded-xl border text-xs flex items-center justify-between gap-3 shadow-2xs ${
              statusSummary.timelineValidationStatus === 'CLOSED' ? 'bg-slate-100 border-slate-300 text-slate-700' :
              statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED' ? 'bg-rose-50 border-rose-200 text-rose-900' :
              'bg-emerald-50/90 border-emerald-200 text-emerald-950'
            }`}>
              <div className="flex items-center gap-2.5">
                {statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                )}
                <div>
                  <div className="font-bold text-slate-900">
                    {statusSummary.timelineValidationStatus === 'CLOSED'
                      ? 'Order Status: Closed & Delivered'
                      : statusSummary.timelineValidationStatus === 'REQUIRES_REVISION_DELAYED'
                      ? (po.status === 'Baseline Pending' ? 'Baseline Status: Approval Pending' : 'Schedule Status: Delay Recorded')
                      : allMilestonesComplete
                      ? 'Schedule Status: All Stages Completed'
                      : 'Schedule Status: Validated & On Track'
                    }
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">{statusSummary.timelineMessage}</p>
                </div>
              </div>

              {!po.isClosed && canReviseBaseline && (
                <button
                  onClick={() => setShowRevisionModal(true)}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-[11px] rounded-lg shrink-0 cursor-pointer shadow-2xs"
                >
                  {po.status === 'Baseline Pending' ? 'Approve Baseline' : statusSummary.isDelayed ? 'Review Baseline' : `Rev ${statusSummary.lastRevNum} Validated`}
                </button>
              )}
            </div>

            {/* MULTI-PRODUCT SYNC SUMMARY */}
            {po.productLines && po.productLines.length > 1 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-emerald-700" />
                    Synchronized Products in Order ({po.productLines.length} Lines)
                  </span>
                  <span className="text-[10px] text-cyan-800 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded font-mono font-bold">
                    Single Master Baseline Linked
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {po.productLines.map((line, idx) => {
                    const lineCompletedCount = (line.milestones || []).filter(m => m.status === 'Completed' || Boolean(m.actualEndDate)).length;

                    const finalMs = (line.milestones || []).slice(-1)[0];
                    const lineBaseline = finalMs?.committedBaselineEndDate || po.committedDeliveryDate;
                    const lineRevised = line.status === 'Completed'
                      ? (finalMs?.actualEndDate || lineBaseline)
                      : (finalMs?.forecastEndDate || po.revisedDeliveryDate || lineBaseline);
                    const isLineDelayed = (line.overallVarianceDays && line.overallVarianceDays > 0) || (lineRevised > lineBaseline);

                    return (
                      <div
                        key={line.id || idx}
                        className="p-3 rounded-xl border bg-slate-50 border-slate-200 flex flex-col justify-between gap-2"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="font-bold text-slate-900 text-xs line-clamp-1" title={line.productName}>
                            #{idx + 1} {line.productName}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 border ${
                            isLineDelayed
                              ? 'bg-rose-100 border-rose-300 text-rose-800'
                              : line.status === 'Completed'
                              ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                              : 'bg-slate-200 border-slate-300 text-slate-700'
                          }`}>
                            {isLineDelayed ? `+${line.overallVarianceDays || 3}d Delay` : line.status || 'On Track'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200">
                          <span className="text-slate-500">Plan: {lineBaseline}</span>
                          <span className={isLineDelayed ? 'text-rose-700 font-bold' : 'text-emerald-700'}>
                            Rev: {lineRevised}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-200/60">
                          <span>Qty: {line.qty || 1} ({line.designType})</span>
                          <span className="font-bold text-emerald-700">{lineCompletedCount}/14 Stages</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Delay Isolation Notice when only some products are delayed */}
                {delayedLines.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-950 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" /> Variance Tracking:
                    </div>
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      Delay recorded on <strong className="text-rose-800">{delayedLines.map(l => l.productName).join(', ')}</strong> (+{Math.max(...delayedLines.map(l => l.overallVarianceDays || 0))}d variance).
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* BODY VIEW 1: 14-STAGE MULTI-PRODUCT MATRIX */}
            {drawerView === 'matrix' ? (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden space-y-3">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <LayoutGrid className="w-4 h-4 text-emerald-700" />
                      Multi-Product 14-Stage Manufacturing Matrix ({po.productLines.length} Product Lines)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Live shop-floor progress across all product lines under the PO Master Baseline.</p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Passed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> In Execution</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Delayed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span> Pending</span>
                  </div>
                </div>

                <div className="overflow-x-auto p-3">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] font-mono">
                        <th className="py-2.5 px-3 min-w-40 sticky left-0 bg-slate-100/95 z-10">Product Line</th>
                        <th className="py-2.5 px-2 text-center">Qty</th>
                        <th className="py-2.5 px-2 text-center">Variance</th>
                        {ALL_14_STAGES.map((st) => (
                          <th key={st.key} className="py-2.5 px-1.5 text-center text-[10px] whitespace-nowrap">
                            {st.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {po.productLines.map((line, lIdx) => {
                        const isLineDelayed = line.status === 'Delayed' || (line.overallVarianceDays && line.overallVarianceDays > 0);

                        return (
                          <tr
                            key={line.id}
                            className="hover:bg-slate-50 transition-colors"
                          >
                            <td className="py-2.5 px-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                              <div className="font-bold text-slate-900 text-xs truncate max-w-44" title={line.productName}>
                                #{lIdx + 1} {line.productName}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">{line.designType}</div>
                            </td>

                            <td className="py-2.5 px-2 text-center font-mono text-slate-700 font-bold">
                              {line.qty}
                            </td>

                            <td className="py-2.5 px-2 text-center font-mono font-bold">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                isLineDelayed ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {isLineDelayed ? `+${line.overallVarianceDays || 0}d` : '0d'}
                              </span>
                            </td>

                            {ALL_14_STAGES.map((st, sIdx) => {
                              const ms = (line.milestones || []).find(m => m.key === st.key);
                              const prevM = sIdx > 0 ? (line.milestones || []).find(m => m.key === ALL_14_STAGES[sIdx - 1].key) : null;
                              const currV = Math.max(0, typeof ms?.varianceDays === 'number' ? ms.varianceDays : 0);
                              const prevV = prevM ? Math.max(0, typeof prevM?.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                              const isStageDone = ms?.status === 'Completed' || Boolean(ms?.actualEndDate);
                              const isStageStarted = Boolean(ms?.actualStartDate) && !isStageDone;
                              const isNewDelay = currV - prevV > 0;
                              const hasShift = currV > 0 && !isNewDelay;

                              return (
                                <td key={st.key} className="py-2 px-1 text-center">
                                  <span
                                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold transition-transform hover:scale-110 ${
                                      isStageDone
                                        ? 'bg-emerald-600 text-white shadow-2xs'
                                        : isStageStarted
                                        ? isNewDelay
                                          ? 'bg-blue-600 text-white ring-2 ring-rose-400'
                                          : 'bg-blue-600 text-white ring-2 ring-blue-300'
                                        : isNewDelay
                                        ? 'bg-rose-500 text-white ring-1 ring-rose-300'
                                        : hasShift
                                        ? 'bg-slate-200 text-slate-700'
                                        : 'bg-slate-100 text-slate-400'
                                    }`}
                                    title={`${st.label}: ${ms?.status || 'Pending'} (${ms?.actualEndDate || ms?.forecastEndDate || 'Planned'})`}
                                  >
                                    {isStageDone ? 'Done' : isStageStarted ? 'In Prog' : isNewDelay ? 'Delay' : sIdx + 1}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <>
                {/* ANIMATED MASTER & PRODUCT PROGRESS OVERVIEW */}
                <OrderProgressOverview
                  po={po}
                  onOpenCloseModal={() => setShowClosePrompt(true)}
                  defaultExpanded={true}
                />

                {/* BOLD ROOT CAUSE DELAY & WATERFALL FLOW */}
                <DelayAnalysisFlow po={po} />

                {/* MANUFACTURING PIPELINE (ORDER MASTER 14-STAGE FLOW) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-emerald-700" />
                        Order Master 14-Stage Manufacturing Timeline
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Single master schedule governing all {po.productLines.length} product lines in PO {po.poNumber}.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg border ${
                        Math.max(0, ...po.productLines.map(l => l.overallVarianceDays || 0)) > 0 
                          ? 'bg-rose-50 text-rose-800 border-rose-300' 
                          : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      }`}>
                        Total Delay: {Math.max(0, ...po.productLines.map(l => l.overallVarianceDays || 0)) > 0 ? `+${Math.max(0, ...po.productLines.map(l => l.overallVarianceDays || 0))}d` : '0d (On Time)'}
                      </span>
                      <span className="text-[10px] font-mono font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 px-2.5 py-1 rounded-lg">
                        Master Baseline Synced
                      </span>
                    </div>
                  </div>

                  {/* Product Line Focus Selector */}
                  {po.productLines.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 border-b border-slate-100">
                      <span className="text-[11px] font-bold text-slate-400 shrink-0 uppercase tracking-wider">Line Focus:</span>
                      {po.productLines.map((line, pIdx) => {
                        const isSelected = line.id === selectedLine?.id;
                        const isLineDelayed = line.status === 'Delayed' || (line.overallVarianceDays && line.overallVarianceDays > 0);
                        return (
                          <button
                            key={line.id}
                            onClick={() => setSelectedLineId(line.id)}
                            className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer border ${
                              isSelected
                                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                : isLineDelayed
                                ? 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                                : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            <span>#{pIdx + 1} {line.productName}</span>
                            {isLineDelayed && (
                              <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded text-[9px] font-bold">
                                +{line.overallVarianceDays || 0}d
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                    {selectedLine?.milestones.map((ms, index) => {
                      // Collect milestone data across all product lines for this stage
                      const productLineMilestones = po.productLines.map((line, pIdx) => {
                        const lineMs = line.milestones.find(m => m.key === ms.key);
                        const isLineDone = lineMs?.status === 'Completed' || Boolean(lineMs?.actualEndDate);
                        const isLineStarted = Boolean(lineMs?.actualStartDate) && !isLineDone;
                        const lineVariance = lineMs?.varianceDays || 0;
                        const isLineDelayed = !isLineDone && (lineMs?.status === 'Delayed' || lineVariance > 0);
                        return {
                          line,
                          pIdx,
                          ms: lineMs,
                          isLineDone,
                          isLineStarted,
                          isLineDelayed,
                          varianceDays: lineVariance,
                          delayReason: lineMs?.delayReason
                        };
                      });

                      const allLinesDone = productLineMilestones.length > 0 && productLineMilestones.every(p => p.isLineDone);

                      const prevMs = index > 0 ? selectedLine.milestones[index - 1] : null;
                      const currVariance = Math.max(0, typeof ms.varianceDays === 'number' ? ms.varianceDays : 0);
                      const prevVariance = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;
                      const addedDelayHere = Math.max(0, currVariance - prevVariance);
                      const isCompleted = ms.status === 'Completed' || Boolean(ms.actualEndDate) || allLinesDone;
                      const recoveredDelay = isCompleted ? Math.max(0, prevVariance - currVariance) : 0;
                      const isStarted = (Boolean(ms.actualStartDate) || productLineMilestones.some(p => p.isLineStarted)) && !isCompleted;
                      const isInProgress = (isStarted || ms.status === 'In Progress') && !isCompleted;
                      const isPendingBaseline = po.status === 'Baseline Pending';
                      const activeStageIdx = selectedLine.milestones.findIndex(m => m.status !== 'Completed' && !m.actualEndDate);
                      const isCurrent = !isPendingBaseline && index === activeStageIdx;
                      const isUnstarted = !isCompleted && !isInProgress && !isStarted;
                      const isNewDelayFormedAtThisStage = !isUnstarted && addedDelayHere > 0;
                      const hasInheritedShift = currVariance > 0 && !isNewDelayFormedAtThisStage;
                      const friendlyName = getStageFriendlyName(ms.key, selectedLine);

                      const {
                        revisedStart,
                        revisedEnd,
                        shiftDays,
                        baselineStart: bStart,
                        baselineEnd: bEnd,
                        baselineDuration
                      } = getMilestoneRevisedDates(ms, prevMs, po.poDate, po.committedDeliveryDate);

                      const prevRevDates = prevMs ? getMilestoneRevisedDates(prevMs, index > 1 ? selectedLine.milestones[index - 2] : null, po.poDate, po.committedDeliveryDate) : null;
                      const prevEffectiveEnd = prevMs?.actualEndDate || prevRevDates?.revisedEnd || prevMs?.forecastEndDate;

                      const delayedLineWithReason = productLineMilestones.find(p => p.delayReason && !p.delayReason.startsWith('Cascaded delay') && !p.delayReason.startsWith('Inherited delay'));
                      const stageDelayReason = delayedLineWithReason?.delayReason || (ms.delayReason && !ms.delayReason.startsWith('Cascaded delay') && !ms.delayReason.startsWith('Inherited delay') ? ms.delayReason : undefined);

                      return (
                        <React.Fragment key={ms.id}>
                        <div className="relative flex items-start justify-between gap-4 group">
                          
                          {/* Node Bullet Icon */}
                          <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                            isCompleted 
                              ? 'bg-emerald-600 border-emerald-600 text-white' 
                              : isNewDelayFormedAtThisStage 
                              ? 'bg-rose-500 border-rose-500 text-white' 
                              : isInProgress 
                              ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-400/40' 
                              : isCurrent 
                              ? 'bg-emerald-100 border-emerald-600 text-emerald-800 ring-2 ring-emerald-400/30' 
                              : 'bg-slate-100 border-slate-300 text-slate-400'
                          }`}>
                            {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : ms.stageOrder}
                          </div>

                          {/* Stage Information */}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold ${isCurrent ? 'text-emerald-950 text-sm' : isCompleted ? 'text-slate-800' : 'text-slate-600'}`}>
                                {friendlyName}
                              </span>

                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                                isCompleted 
                                  ? (isNewDelayFormedAtThisStage 
                                      ? 'bg-amber-50 border-amber-300 text-amber-900' 
                                      : currVariance > 0 
                                      ? 'bg-slate-100 border-slate-200 text-slate-700' 
                                      : recoveredDelay > 0
                                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                      : 'bg-emerald-50 border-emerald-200 text-emerald-800')
                                  : isNewDelayFormedAtThisStage 
                                  ? 'bg-rose-50 border-rose-200 text-rose-800 shadow-2xs font-bold'
                                  : hasInheritedShift
                                  ? 'bg-slate-100 border-slate-200 text-slate-600'
                                  : isInProgress 
                                  ? 'bg-blue-50 border-blue-200 text-blue-800 shadow-2xs'
                                  : isPendingBaseline 
                                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                                  : 'bg-slate-100 border-slate-200 text-slate-500'
                              }`}>
                                {isCompleted 
                                  ? (isNewDelayFormedAtThisStage 
                                      ? `Completed (+${addedDelayHere}d delay added)` 
                                      : currVariance > 0 
                                      ? (recoveredDelay > 0 
                                          ? `Completed (${recoveredDelay === 1 ? '1 day' : `${recoveredDelay} days`} delay resolved, Previous: +${currVariance}d)` 
                                          : `Completed (Previous: +${currVariance}d)`)
                                      : recoveredDelay > 0 
                                      ? `Completed (${recoveredDelay === 1 ? '1 day' : `${recoveredDelay} days`} delay resolved)` 
                                      : 'Completed')
                                  : isNewDelayFormedAtThisStage 
                                  ? `Delay (+${addedDelayHere}d)`
                                  : hasInheritedShift
                                  ? (isInProgress ? `In Execution (Previous: +${currVariance}d)` : isCurrent ? `Ready to Start (Previous: +${currVariance}d)` : `Previous (+${currVariance}d)`)
                                  : isInProgress 
                                  ? 'IN EXECUTION'
                                  : isPendingBaseline 
                                  ? 'Baseline Pending'
                                  : isCurrent
                                  ? 'Ready to Start'
                                  : 'Not Started'}
                              </span>
                            </div>

                            <div className="mt-1.5 space-y-1.5 text-[10px] font-mono bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                              {/* Planned Baseline row */}
                              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-slate-400 font-semibold uppercase">Planned Baseline:</span>{' '}
                                  <strong className="text-slate-800">{bStart || 'N/A'} &rarr; {bEnd || 'N/A'}</strong>
                                  <span className="text-slate-500 font-medium">({baselineDuration}d planned)</span>
                                </div>
                                {shiftDays > 0 ? (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                    {isNewDelayFormedAtThisStage && prevVariance > 0
                                      ? `+${prevVariance}d shift from Stage ${prevMs?.stageOrder || 'previous'} delay (+${addedDelayHere}d added here)`
                                      : isNewDelayFormedAtThisStage
                                      ? `+${addedDelayHere}d delay added at this stage`
                                      : `+${shiftDays}d shift from Stage ${prevMs?.stageOrder || 'previous'} delay`}
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    On original baseline
                                  </span>
                                )}
                              </div>

                              {/* Revised Target (due to delay) */}
                              {shiftDays > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-amber-900">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-amber-700 font-semibold uppercase">Revised (due to delay):</span>{' '}
                                    <strong className="text-amber-950">{revisedStart} &rarr; {revisedEnd}</strong>
                                  </div>
                                  <span className="text-[9px] text-amber-700 font-medium">
                                    Target start: {revisedStart} {prevEffectiveEnd ? `(Following Stage ${prevMs?.stageOrder || 'previous'} completion: ${prevEffectiveEnd})` : ''}
                                  </span>
                                </div>
                              )}

                              {/* Actual Execution row (if started or completed) */}
                              {(Boolean(ms.actualStartDate) || Boolean(ms.actualEndDate) || isCompleted || isStarted) && (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-slate-200/60 text-slate-700">
                                  <div>
                                    <span className="text-slate-400 font-semibold uppercase">Actual Start:</span>{' '}
                                    <strong className={ms.actualStartDate ? "text-blue-700 font-bold" : "text-slate-400"}>
                                      {ms.actualStartDate || 'Pending'}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-slate-400 font-semibold uppercase">Actual End Date:</span>{' '}
                                    <strong className={ms.actualEndDate ? "text-emerald-700 font-bold" : "text-slate-400"}>
                                      {ms.actualEndDate || 'Pending'}
                                    </strong>
                                  </div>
                                  {isCompleted && ms.actualEndDate && (
                                    <div className="text-emerald-700 font-semibold flex items-center gap-1">
                                      ✓ Passed on {ms.actualEndDate}
                                      {recoveredDelay > 0 && (
                                        <span className="text-emerald-800 font-bold">
                                          • {recoveredDelay === 1 ? '1 day' : `${recoveredDelay} days`} delay resolved
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Multi-Product Progress Indicator */}
                            {po.productLines.length > 1 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {productLineMilestones.map(({ line, pIdx, isLineDone, isLineStarted, varianceDays }) => {
                                  const pPrevMs = index > 0 ? line.milestones[index - 1] : null;
                                  const pCurrVar = Math.max(0, typeof varianceDays === 'number' ? varianceDays : 0);
                                  const pPrevVar = pPrevMs ? Math.max(0, typeof pPrevMs.varianceDays === 'number' ? pPrevMs.varianceDays : 0) : 0;
                                  const pAddedDelay = Math.max(0, pCurrVar - pPrevVar);
                                  const pHasInherited = pCurrVar > 0 && pAddedDelay === 0;

                                  return (
                                    <span
                                      key={line.id}
                                      className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 border ${
                                        isLineDone ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                        pAddedDelay > 0 ? 'bg-rose-50 text-rose-800 border-rose-300 font-semibold' :
                                        pHasInherited ? 'bg-slate-100 text-slate-700 border-slate-200' :
                                        isLineStarted ? 'bg-blue-50 text-blue-800 border-blue-200' :
                                        'bg-slate-100 text-slate-600 border-slate-200'
                                      }`}
                                    >
                                      <span>#{pIdx + 1} {line.productName}:</span>
                                      <strong>
                                        {isLineDone ? 'Done' :
                                         pAddedDelay > 0 ? `Delay (+${pAddedDelay}d)` :
                                         pHasInherited ? `Previous (+${pCurrVar}d)` :
                                         isLineStarted ? 'In Execution' :
                                         'Pending'}
                                      </strong>
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* Display explicit delay reason on the milestone where delay was entered/occurred */}
                            {isNewDelayFormedAtThisStage && stageDelayReason && (
                              <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg mt-1.5 border border-rose-100 flex items-center gap-1.5 font-medium">
                                <span className="font-bold">Reason {delayedLineWithReason && po.productLines.length > 1 ? `(#${delayedLineWithReason.pIdx + 1}):` : ':'}</span> {stageDelayReason}
                              </div>
                            )}
                          </div>

                          {/* Quick Record Action Buttons - STRICTLY FOR ACTIVE MILESTONE ONLY */}
                          {!po.isClosed && po.status !== 'Completed' && !isPendingBaseline && isCurrent && (() => {
                            const isAuthorizedForMilestone = isMilestoneOwnedByRole(ms.key, activeRole);
                            if (!isAuthorizedForMilestone) return null;

                            return (
                              <div className="shrink-0 flex items-center gap-1.5">
                                {!ms.actualStartDate ? (
                                  <button
                                    onClick={() => onOpenManualInput(po, selectedLine, ms, 'start')}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-md text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                                  >
                                    <Play className="w-3 h-3 text-slate-600" /> Record Start
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => onOpenManualInput(po, selectedLine, ms, 'start')}
                                    className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                                    title="Edit / Re-enter Start Date"
                                  >
                                    <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                                  </button>
                                )}
                                <button
                                  onClick={() => onOpenManualInput(po, selectedLine, ms, 'complete')}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-[10px] font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                                >
                                  <CheckSquare className="w-3 h-3" /> Mark Complete
                                </button>
                              </div>
                            );
                          })()}
                          
                        </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* RAW MATERIALS CRITICAL PATH SUMMARY FOR SELECTED PRODUCT */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-emerald-700" /> Raw Materials Bill of Materials: {selectedLine?.productName}
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400">{selectedLine?.materials?.length || 0} Item(s)</span>
                  </div>

                  <div className="space-y-2">
                    {(!selectedLine?.materials || selectedLine.materials.length === 0) ? (
                      <div className="p-3 bg-slate-50 rounded-xl text-center text-slate-400 text-xs">
                        Standard materials assigned.
                      </div>
                    ) : (
                      selectedLine.materials.map((mat) => (
                        <div key={mat.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{mat.itemCode}</span>
                              {mat.isCriticalPath && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 font-mono text-[9px] font-bold border border-rose-200">
                                  CRITICAL
                                </span>
                              )}
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                                mat.inspectionResult === 'Passed' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                              }`}>
                                GRN: {mat.inspectionResult || 'Pending'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5">{mat.description}</p>
                          </div>
                          <div className="text-right text-[10px] font-mono text-slate-500">
                            <div>Supplier: {mat.supplierName}</div>
                            <div>Lead Time: {mat.leadTimeDays}d | Expected: {mat.expectedDate || 'Pending'}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

          </div>

          {/* Footer */}
          <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500 font-mono">
            <span>Last Updated: {po.lastUpdatedAt.split('T')[0]} by {po.lastUpdatedBy}</span>
            <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold rounded-lg cursor-pointer">
              Close Panel
            </button>
          </div>

        </div>
      </div>

      {showRevisionModal && (
        <BaselineRevisionModal
          isOpen={showRevisionModal}
          onClose={() => setShowRevisionModal(false)}
          po={po}
        />
      )}
    </>
  );
};
