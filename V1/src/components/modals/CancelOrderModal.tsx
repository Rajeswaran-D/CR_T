import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder } from '../../types';
import { 
  X, 
  AlertTriangle, 
  Trash2, 
  XCircle, 
  ShieldAlert, 
  CheckCircle2, 
  Clock, 
  Info,
  Archive
} from 'lucide-react';
import { getPOManufacturingStatus } from '../../utils/statusUtils';

interface CancelOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
}

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({ isOpen, onClose, po }) => {
  const { 
    activeRole, 
    requestPOCancellation, 
    approvePOCancellation, 
    rejectPOCancellation, 
    deletePurchaseOrder 
  } = useApp();

  const [reason, setReason] = useState<string>('');
  const [adminAction, setAdminAction] = useState<'cancel' | 'delete'>('cancel');
  const [decisionNotes, setDecisionNotes] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen || !po) return null;

  const isAdmin = activeRole === 'Project Management';
  const hasPendingRequest = po.cancellationRequest?.status === 'Pending';
  const statusSummary = getPOManufacturingStatus(po);

  const presetReasons = [
    'Customer cancelled Purchase Order',
    'Customer requested redesign with new PO',
    'Commercial / Credit term dispute',
    'Duplicate order entry in system',
    'Engineering / specification obsolescence'
  ];

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!reason.trim()) {
      setErrorMessage('Please provide a mandatory cancellation reason.');
      return;
    }

    const res = requestPOCancellation({ poId: po.id, reason: reason.trim() });
    if (!res.success) {
      setErrorMessage(res.error || 'Failed to submit cancellation request.');
    } else {
      setSuccessMessage('Cancellation request submitted successfully. The Administrator will review and decide.');
      setTimeout(() => {
        setSuccessMessage(null);
        setReason('');
        onClose();
      }, 1500);
    }
  };

  const handleAdminDirectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (adminAction === 'delete') {
      const confirmDelete = window.confirm(`WARNING: Are you sure you want to permanently delete PO "${po.poNumber}"? This action cannot be undone.`);
      if (!confirmDelete) return;

      const res = deletePurchaseOrder(po.id, decisionNotes.trim() || 'Direct Admin Deletion');
      if (!res.success) {
        setErrorMessage(res.error || 'Failed to delete purchase order.');
      } else {
        onClose();
      }
    } else {
      const res = approvePOCancellation({
        poId: po.id,
        actionType: 'cancel',
        decisionNotes: decisionNotes.trim() || 'Cancelled directly by Administrator'
      });
      if (!res.success) {
        setErrorMessage(res.error || 'Failed to cancel purchase order.');
      } else {
        onClose();
      }
    }
  };

  const handleAdminApprovePending = (actionType: 'cancel' | 'delete') => {
    setErrorMessage(null);
    if (actionType === 'delete') {
      const confirmDelete = window.confirm(`WARNING: Are you sure you want to permanently delete PO "${po.poNumber}"? This action cannot be undone.`);
      if (!confirmDelete) return;
    }

    const res = approvePOCancellation({
      poId: po.id,
      actionType,
      decisionNotes: decisionNotes.trim() || undefined
    });

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to approve cancellation.');
    } else {
      onClose();
    }
  };

  const handleAdminRejectPending = () => {
    setErrorMessage(null);
    if (!decisionNotes.trim()) {
      setErrorMessage('Please provide decision notes / justification when rejecting a cancellation request.');
      return;
    }

    const res = rejectPOCancellation({
      poId: po.id,
      decisionNotes: decisionNotes.trim()
    });

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to reject cancellation request.');
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isAdmin ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
              {isAdmin ? <Trash2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-bold text-base">
                {isAdmin ? (hasPendingRequest ? 'Review Cancellation Request' : 'Admin Cancel / Delete Order') : 'Request Order Cancellation'}
              </h2>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                PO: {po.poNumber} — <span className="font-bold text-white">{po.customerName}</span>
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-xs flex-1 overflow-y-auto min-h-0">
          
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Error:</span>
                <p className="mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* PO Quick Snapshot */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-slate-600 font-mono">
            <div>
              <span className="text-slate-400 text-[10px] block">CURRENT STAGE:</span>
              <span className="font-bold text-slate-900">{statusSummary.currentStageName}</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">PROGRESS:</span>
              <span className="font-bold text-emerald-700">{statusSummary.completedStagesCount}/{statusSummary.totalStagesCount} Stages ({statusSummary.progressPercent}%)</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">DELIVERY TARGET:</span>
              <span className="font-bold text-slate-900">{po.revisedDeliveryDate || po.committedDeliveryDate}</span>
            </div>
          </div>

          {/* If there is already a pending cancellation request */}
          {hasPendingRequest && po.cancellationRequest && (
            <div className="p-4 bg-amber-50 border border-amber-300/80 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-900 flex items-center gap-1.5 text-xs">
                  <Clock className="w-4 h-4 text-amber-600" />
                  Pending Cancellation Request
                </span>
                <span className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full font-mono text-[10px] font-bold">
                  {po.cancellationRequest.requestedRole}
                </span>
              </div>
              <p className="text-slate-800 bg-white p-2.5 rounded-lg border border-amber-200 text-xs">
                <strong>Reason:</strong> "{po.cancellationRequest.reason}"
              </p>
              <div className="text-[10px] text-amber-800 font-mono flex justify-between">
                <span>Requested by: {po.cancellationRequest.requestedBy}</span>
                <span>Date: {new Date(po.cancellationRequest.requestedAt).toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Admin Decision View for Pending Request */}
          {isAdmin && hasPendingRequest && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Administrator Decision Notes / Reason (Optional for approve, required for reject):
                </label>
                <textarea
                  rows={2}
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Enter administrator decision comments or justification..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleAdminRejectPending}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4 text-slate-500" /> Reject Request
                </button>
                <button
                  type="button"
                  onClick={() => handleAdminApprovePending('cancel')}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Archive className="w-4 h-4" /> Approve & Archive as Cancelled
                </button>
                <button
                  type="button"
                  onClick={() => handleAdminApprovePending('delete')}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" /> Approve & Permanently Delete
                </button>
              </div>
            </div>
          )}

          {/* Admin Direct Cancellation/Deletion (when not pending) */}
          {isAdmin && !hasPendingRequest && (
            <form onSubmit={handleAdminDirectSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-700 font-bold mb-2">Select Admin Action:</label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`p-3.5 border rounded-xl flex items-start gap-3 cursor-pointer transition-all ${
                    adminAction === 'cancel' ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/20' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}>
                    <input
                      type="radio"
                      name="adminAction"
                      value="cancel"
                      checked={adminAction === 'cancel'}
                      onChange={() => setAdminAction('cancel')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-bold text-slate-900 block flex items-center gap-1.5">
                        <Archive className="w-3.5 h-3.5 text-amber-600" /> Cancel Order
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Retains PO record in History & Archive, marks status as 'Cancelled', and closes pipeline.
                      </p>
                    </div>
                  </label>

                  <label className={`p-3.5 border rounded-xl flex items-start gap-3 cursor-pointer transition-all ${
                    adminAction === 'delete' ? 'bg-rose-50/70 border-rose-400 ring-2 ring-rose-400/20' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}>
                    <input
                      type="radio"
                      name="adminAction"
                      value="delete"
                      checked={adminAction === 'delete'}
                      onChange={() => setAdminAction('delete')}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-bold text-rose-900 block flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Permanently Delete
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Irrevocably deletes all lines, milestone dates, and attachments from the system.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Cancellation / Deletion Reason & Notes: <span className="text-rose-600">*</span>
                </label>
                <textarea
                  rows={2}
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  placeholder="Explain why this order is being cancelled or deleted..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-white rounded-xl font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1.5 ${
                    adminAction === 'delete' ? 'bg-rose-700 hover:bg-rose-800' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {adminAction === 'delete' ? <Trash2 className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                  {adminAction === 'delete' ? 'Permanently Delete PO' : 'Confirm & Cancel PO'}
                </button>
              </div>
            </form>
          )}

          {/* Non-Admin Role Request Form */}
          {!isAdmin && (
            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5 text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  As <strong>{activeRole}</strong>, you can raise an order cancellation request with a mandatory reason. Your request will be routed directly to the <strong>Administrator (Project Management)</strong> who will review and make the final decision.
                </p>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Reason for Cancellation Request <span className="text-rose-600">*</span>
                </label>
                
                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {presetReasons.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-medium transition-colors cursor-pointer border border-slate-200"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe in detail why this order needs to be cancelled or removed..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
                  <span>Submitting as: {activeRole}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-xl font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-4 h-4" /> Submit Cancellation Request
                  </button>
                </div>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
