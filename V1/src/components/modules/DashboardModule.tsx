import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FilePlus2, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight,
  Clock,
  Layers,
  Wrench,
  ShieldAlert,
  XCircle,
  FileSpreadsheet
} from 'lucide-react';
import type { PurchaseOrder } from '../../types';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import { BaselineRevisionModal } from '../modals/BaselineRevisionModal';
import { BulkImportModal } from '../modals/BulkImportModal';

interface DashboardModuleProps {
  onSelectPO: (po: PurchaseOrder) => void;
  onNavigateModule: (module: any) => void;
  onOpenCancelModal?: (po: PurchaseOrder) => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({ 
  onSelectPO, 
  onNavigateModule,
  onOpenCancelModal
}) => {
  const { purchaseOrders, activeRole } = useApp();
  const [baselinePOState, setBaselinePOState] = useState<PurchaseOrder | null>(null);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);

  const isPMRole = activeRole === 'Project Manager (PM Baseline)';
  const isAdmin = activeRole === 'Project Management';

  // Filter current active orders (exclude fully closed & cancelled)
  const activeOrders = purchaseOrders.filter(p => !p.isClosed && p.status !== 'Cancelled' && !p.isCancelled);
  const onTimeOrders = activeOrders.filter(p => !getPOManufacturingStatus(p).isDelayed);
  const delayedOrders = activeOrders.filter(p => getPOManufacturingStatus(p).isDelayed);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Unified Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              OPERATIONS OVERVIEW
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              {activeRole}
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">Active Orders Dashboard</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Live shop-floor manufacturing status, stage progression, and active work updates across all lines.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {(isAdmin || activeRole === 'Sales / AE (Customer PO)') && (
            <button
              onClick={() => setShowBulkImportModal(true)}
              className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer border border-white/20"
              title="Bulk import orders and milestone dates from Excel/CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
              <span>Bulk Import (CSV / Excel)</span>
            </button>
          )}

          {activeRole === 'Sales / AE (Customer PO)' && (
            <button
              onClick={() => onNavigateModule('1. Customer Purchase Order (PO)')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer group shrink-0"
            >
              <FilePlus2 className="w-4 h-4 text-emerald-200 group-hover:scale-110 transition-transform" />
              <span>+ Add New Order</span>
            </button>
          )}
        </div>
      </div>

      {/* Simplified Status Summary Cards */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-3 font-semibold">
            <span>Total Active Orders</span>
            <Layers className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-4xl font-extrabold text-slate-900 font-mono">{activeOrders.length}</div>
          <p className="text-xs text-slate-500 mt-2">Currently in shop-floor pipeline</p>
        </div>

        <div className="bg-white border border-emerald-200/80 p-6 rounded-2xl shadow-xs bg-emerald-50/20">
          <div className="flex items-center justify-between text-emerald-800 text-xs mb-3 font-semibold">
            <span>On Time Orders</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-4xl font-extrabold text-emerald-700 font-mono">{onTimeOrders.length}</div>
          <p className="text-xs text-emerald-600 font-medium mt-2">Meeting target deadlines</p>
        </div>

        <div className="bg-white border border-rose-200/80 p-6 rounded-2xl shadow-xs bg-rose-50/20">
          <div className="flex items-center justify-between text-rose-800 text-xs mb-3 font-semibold">
            <span>Delayed Orders</span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-4xl font-extrabold text-rose-700 font-mono">{delayedOrders.length}</div>
          <p className="text-xs text-rose-600 font-medium mt-2">Requires schedule attention</p>
        </div>
      </div>

      {/* Current Active Orders Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-bold text-base text-slate-900">Current Active Orders & Work Progress</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPMRole ? 'Use "Baseline Edit" to revise master timelines, or click "Details" to inspect stage progression.' : 'Click "Details" on any order to inspect shop-floor work or stage changes.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold font-mono border border-emerald-200">
              {activeOrders.length} Active
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-4 px-6">PO Number</th>
                <th className="py-4 px-6">Customer</th>
                <th className="py-4 px-6">Product Details</th>
                <th className="py-4 px-6">Current Live Status</th>
                <th className="py-4 px-6">Progress</th>
                <th className="py-4 px-6">Deadline</th>
                <th className="py-4 px-6 text-center">Timeline Validation & Schedule</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {activeOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No active orders found. Click "+ Add New Order" above to create one.
                  </td>
                </tr>
              ) : (
                activeOrders.map((po) => {
                  const firstLine = po.productLines[0];
                  const statusSummary = getPOManufacturingStatus(po);
                  const deadline = po.revisedDeliveryDate || po.committedDeliveryDate;
                  const hasPendingCancel = po.cancellationRequest?.status === 'Pending';

                  return (
                    <tr 
                      key={po.id}
                      onClick={() => onSelectPO(po)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      <td className="py-4 px-6">
                        <div className="font-mono font-bold text-emerald-800 text-sm">
                          {po.poNumber}
                        </div>
                        {hasPendingCancel && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300">
                              <ShieldAlert className="w-3 h-3 text-amber-600" /> CANCEL PENDING
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 font-semibold text-slate-900">
                        {po.customerName}
                      </td>
                      <td className="py-4 px-6 text-slate-700">
                        {firstLine?.productName || 'Standard Manufacturing Line'}
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {firstLine?.designType} • Qty: {firstLine?.qty || 1}
                        </div>
                        <div className="mt-2 text-[10px] font-mono font-bold text-slate-700">
                          Start: {firstLine?.milestones[0]?.committedBaselineStartDate || po.poDate} · End: {firstLine?.milestones[firstLine.milestones.length - 1]?.committedBaselineEndDate || po.committedDeliveryDate}
                        </div>
                      </td>
                      
                      {/* Live Current Stage */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900 text-xs">
                          <Wrench className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span>{statusSummary.currentStageName}</span>
                        </div>
                        {statusSummary.isDelayed && (
                          <div className="text-[10px] text-rose-700 font-semibold mt-0.5">
                            Delayed
                          </div>
                        )}
                      </td>

                      {/* Progress bar */}
                      <td className="py-4 px-6">
                        <div className="w-24">
                          <div className="flex justify-between text-[10px] font-mono font-bold text-slate-600 mb-1">
                            <span>{statusSummary.progressPercent}%</span>
                            <span>{statusSummary.completedStagesCount}/{statusSummary.totalStagesCount}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div 
                              className={`h-1.5 rounded-full ${statusSummary.isDelayed ? 'bg-rose-500' : 'bg-emerald-600'}`} 
                              style={{ width: `${statusSummary.progressPercent}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-6 font-mono font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{deadline}</span>
                        </div>
                      </td>

                      {/* Timeline Validation & Schedule Status */}
                      <td className="py-4 px-6 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {po.isClosed ? (
                            statusSummary.delayDays > 0 ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-xs">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                                COMPLETED (+{statusSummary.delayDays}d DELAY)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                COMPLETED (ON TIME)
                              </span>
                            )
                          ) : statusSummary.isDelayed ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-xs">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                              DELAYED ({statusSummary.delayDays > 0 ? `+${statusSummary.delayDays}d` : ''})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              ON TIME
                            </span>
                          )}
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            po.isClosed 
                              ? (statusSummary.delayDays > 0 ? 'bg-amber-50 border-amber-200 text-amber-900 font-bold' : 'bg-slate-100 border-slate-200 text-slate-600 font-medium')
                              : statusSummary.isDelayed ? 'bg-amber-50 border-amber-200 text-amber-800 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            {po.isClosed 
                              ? (statusSummary.delayDays > 0 ? `Completed by delay of ${statusSummary.delayDays} days` : 'Order Closed & Delivered On Time')
                              : statusSummary.isDelayed ? 'See Baseline for Delay Reason' : `Rev ${statusSummary.lastRevNum} Validated`}
                          </span>
                        </div>
                      </td>

                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isPMRole && !po.isClosed && po.status !== 'Completed' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setBaselinePOState(po);
                              }}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer shadow-xs"
                            >
                              <Wrench className="w-3.5 h-3.5" /> Baseline Edit
                            </button>
                          )}

                          {onOpenCancelModal && !po.isClosed && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenCancelModal(po);
                              }}
                              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer border ${
                                hasPendingCancel
                                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300'
                                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                              }`}
                              title={isAdmin ? 'Decide on cancellation or cancel/delete order' : 'Request cancellation with reason'}
                            >
                              {hasPendingCancel ? (
                                <>
                                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                                  <span>{isAdmin ? 'Decide' : 'Pending'}</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  <span>{isAdmin ? 'Cancel' : 'Cancel'}</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectPO(po);
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
                          >
                            Details <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {baselinePOState && (
        <BaselineRevisionModal
          isOpen={!!baselinePOState}
          onClose={() => setBaselinePOState(null)}
          po={baselinePOState}
        />
      )}

      {showBulkImportModal && (
        <BulkImportModal
          isOpen={showBulkImportModal}
          onClose={() => setShowBulkImportModal(false)}
        />
      )}

    </div>
  );
};
