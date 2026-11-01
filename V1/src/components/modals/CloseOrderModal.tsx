import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { CheckCircle2, X, AlertTriangle, Package, Sparkles, ShieldCheck } from 'lucide-react';

interface CloseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
  onSuccess?: () => void;
}

export const CloseOrderModal: React.FC<CloseOrderModalProps> = ({
  isOpen,
  onClose,
  po,
  onSuccess
}) => {
  const { purchaseOrders, closePurchaseOrder, activeRole } = useApp();
  const [closureNotes, setClosureNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const currentPO = (po ? purchaseOrders.find(p => p.id === po.id) : null) || po;

  if (!isOpen || !currentPO) return null;

  const isAuthorized = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';
  const totalQty = currentPO.productLines.reduce((acc, l) => acc + (l.qty || 1), 0);
  const allMilestonesComplete = currentPO.productLines.length > 0 && currentPO.productLines.every(line =>
    line.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)
  );

  const presetNotes = [
    'All products delivered & site sign-off received from customer.',
    'Final shipment dispatched with tracking documents. FAT passed.',
    'Full order delivered on schedule — formally closed by Project Manager.',
    'Customer inspection cleared, delivery receipt signed DO-2026.'
  ];

  const handleConfirmClose = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isAuthorized) {
      setError(`Permission Denied: Only Project Manager (PM Baseline) or Project Management (Admin) can close purchase orders. Current role: ${activeRole}`);
      return;
    }

    const notesToUse = closureNotes.trim() || 'Order delivered and verified across all product lines. Formally closed.';
    const result = closePurchaseOrder(currentPO.id, notesToUse, `${activeRole} User`);

    if (result.success) {
      if (onSuccess) onSuccess();
      onClose();
    } else {
      setError(result.error || 'Failed to close purchase order.');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-5 text-white flex items-center justify-between border-b border-slate-700">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                FINAL ORDER ACTION
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-slate-200">
                {currentPO.productLines.length} Product Line{currentPO.productLines.length !== 1 ? 's' : ''} ({totalQty} Pcs)
              </span>
            </div>
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Close Purchase Order: {currentPO.poNumber}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Customer: <strong className="text-white">{currentPO.customerName}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConfirmClose} className="p-6 space-y-5 overflow-y-auto text-xs">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Validation Warning if incomplete */}
          {!allMilestonesComplete ? (
            <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Unfinished Stages Detected
              </div>
              <p className="text-[11px] text-amber-800">
                Some milestones across the {currentPO.productLines.length} product lines are not yet marked as Completed. All stages must be completed before archiving.
              </p>
            </div>
          ) : (
            <div className="p-4 bg-emerald-50/80 border border-emerald-200 text-emerald-900 rounded-xl flex items-center gap-3 shadow-2xs">
              <Sparkles className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <div className="font-bold text-xs text-emerald-950">All 14 Stages Complete Across All Products</div>
                <div className="text-[11px] text-emerald-800">
                  Every product line has successfully passed all manufacturing, quality inspections, and final delivery dispatch.
                </div>
              </div>
            </div>
          )}

          {/* Product Lines Completion Checklist */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between font-bold text-slate-900 text-xs border-b border-slate-200 pb-2">
              <span className="flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-700" />
                Product Lines Status ({currentPO.productLines.length})
              </span>
              <span className="text-[10px] font-mono text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded">
                100% Stages Finished
              </span>
            </div>

            <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
              {currentPO.productLines.map(line => {
                const compStages = line.milestones.filter(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100).length;
                const totalStages = line.milestones.length || 14;
                const isLineDone = compStages >= totalStages;

                return (
                  <div key={line.id} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`w-4 h-4 ${isLineDone ? 'text-emerald-600' : 'text-slate-300'}`} />
                      <div>
                        <span className="font-bold text-slate-900">{line.lineNumber}: {line.productName}</span>
                        <div className="text-[10px] text-slate-500 font-mono">Qty: {line.qty} Pcs • {line.designType}</div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                      isLineDone ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800'
                    }`}>
                      {compStages}/{totalStages} Stages
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Closure Notes Input */}
          <div className="space-y-2">
            <label className="block font-bold text-slate-700 text-xs">
              Closure Notes & Delivery Remarks
            </label>
            <textarea
              rows={3}
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              placeholder="e.g. Delivered & signed off by customer on site (Ref: DO-2026-09)..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-600 shadow-2xs resize-none"
            />

            {/* Quick Presets */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick Suggestions:</span>
              <div className="flex flex-wrap gap-1.5">
                {presetNotes.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setClosureNotes(preset)}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer text-left"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Info Banner & Authorization Banner */}
          {!isAuthorized ? (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-[11px] text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Role Restriction:</strong> Only <strong>Project Manager (PM Baseline)</strong> or <strong>Project Management (Admin)</strong> can formally sign off and close completed purchase orders.
              </span>
            </div>
          ) : (
            <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                Closing this order locks all milestones and archives the PO in Completed Orders. An immutable audit entry will be recorded.
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!allMilestonesComplete || !isAuthorized}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all ${
                allMilestonesComplete && isAuthorized
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer shadow-emerald-700/20'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm & Close Purchase Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
