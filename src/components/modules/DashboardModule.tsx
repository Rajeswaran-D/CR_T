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
  FileSpreadsheet,
  Search,
  X
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

  const [statusFilter, setStatusFilter] = useState<'all' | 'on_time' | 'delayed' | 'ld'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filter current active orders (exclude fully closed, cancelled, and orders awaiting baseline approval)
  const activeOrders = purchaseOrders.filter(p => !p.isClosed && p.status !== 'Cancelled' && !p.isCancelled && p.status !== 'Baseline Pending');
  const pendingBaselineOrders = purchaseOrders.filter(p => !p.isClosed && p.status === 'Baseline Pending' && !p.isCancelled);
  const onTimeOrders = activeOrders.filter(p => !getPOManufacturingStatus(p).isDelayed);
  const delayedOrders = activeOrders.filter(p => getPOManufacturingStatus(p).isDelayed);
  const ldOrders = activeOrders.filter(p => Boolean(p.isLd));

  const onTimeLdCount = onTimeOrders.filter(p => Boolean(p.isLd)).length;
  const delayedLdCount = delayedOrders.filter(p => Boolean(p.isLd)).length;

  const filteredByStatus = statusFilter === 'on_time'
    ? onTimeOrders
    : statusFilter === 'delayed'
      ? delayedOrders
      : statusFilter === 'ld'
        ? ldOrders
        : activeOrders;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const displayedOrders = normalizedSearch
    ? filteredByStatus.filter(po => {
        const poNum = (po.poNumber || '').toLowerCase();
        const custName = (po.customerName || '').toLowerCase();
        const custRef = (po.customerPoRef || '').toLowerCase();
        const crRef = (po.contractReviewRef || '').toLowerCase();
        const plNames = (po.productLines || []).map(l => `${l.productName || ''} ${l.lineNumber || ''} ${l.designType || ''}`).join(' ').toLowerCase();
        const statusSummary = getPOManufacturingStatus(po);
        const stageName = (statusSummary.currentStageName || '').toLowerCase();
        const delayedStage = (statusSummary.delayedStageName || '').toLowerCase();
        const isLd = po.isLd ? 'ld liquidated damages' : '';

        return poNum.includes(normalizedSearch) ||
          custName.includes(normalizedSearch) ||
          custRef.includes(normalizedSearch) ||
          crRef.includes(normalizedSearch) ||
          plNames.includes(normalizedSearch) ||
          stageName.includes(normalizedSearch) ||
          delayedStage.includes(normalizedSearch) ||
          isLd.includes(normalizedSearch);
      })
    : filteredByStatus;

  const matchingPendingBaseline = normalizedSearch
    ? pendingBaselineOrders.filter(po => {
        const poNum = (po.poNumber || '').toLowerCase();
        const custName = (po.customerName || '').toLowerCase();
        return poNum.includes(normalizedSearch) || custName.includes(normalizedSearch);
      })
    : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {pendingBaselineOrders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
          <div className="flex items-center gap-3 text-amber-900 font-semibold">
            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-300 text-amber-700 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-amber-950">{pendingBaselineOrders.length} Order(s) Awaiting PM Baseline Approval:</span>
              <span className="text-amber-800 ml-1">
                {pendingBaselineOrders.map(p => p.poNumber).join(', ')} (Created in Sales intake, pending schedule sign-off before shop-floor execution).
              </span>
            </div>
          </div>
          <button
            onClick={() => onNavigateModule('3. Baseline Review & Planning')}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold shrink-0 transition-colors cursor-pointer"
          >
            Review Baseline &rarr;
          </button>
        </div>
      )}
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

      {/* Simplified Status Summary Cards with Click-to-Filter (Accessible to All Roles) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div 
          onClick={() => setStatusFilter('all')}
          className={`bg-white border p-5 sm:p-6 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] hover:shadow-md ${
            statusFilter === 'all'
              ? 'border-slate-800 ring-2 ring-slate-800/80 bg-slate-50/50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
          title="Click to view all active orders"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs mb-3 font-semibold">
            <span>Total Active Orders</span>
            <Layers className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-extrabold text-slate-900 font-mono">{activeOrders.length}</div>
            {statusFilter === 'all' ? (
              <span className="text-[10px] font-bold text-slate-700 bg-slate-200/80 px-2 py-0.5 rounded-full font-mono">
                Showing All
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 font-mono">
                Show All
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">Currently in shop-floor pipeline</p>
        </div>

        <div 
          onClick={() => setStatusFilter(prev => prev === 'on_time' ? 'all' : 'on_time')}
          className={`bg-white border p-5 sm:p-6 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] hover:shadow-md ${
            statusFilter === 'on_time'
              ? 'border-emerald-600 ring-2 ring-emerald-600/80 bg-emerald-50/70 shadow-emerald-100'
              : 'border-emerald-200/80 bg-emerald-50/20 hover:border-emerald-400'
          }`}
          title={statusFilter === 'on_time' ? 'Click to show all orders' : 'Click to filter on-time orders only'}
        >
          <div className="flex items-center justify-between text-emerald-800 text-xs mb-3 font-semibold">
            <span className="flex items-center gap-1.5">
              <span>On Time Orders</span>
              {statusFilter === 'on_time' && (
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
              )}
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-extrabold text-emerald-700 font-mono">{onTimeOrders.length}</div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
              statusFilter === 'on_time' ? 'bg-emerald-600 text-white' : 'bg-emerald-100/80 text-emerald-800'
            }`}>
              {statusFilter === 'on_time' ? '✓ Filter Active' : 'Click to filter'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-2 flex-wrap">
            <p className="text-xs text-emerald-600 font-medium">Meeting target deadlines</p>
            {onTimeLdCount > 0 && (
              <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300" title={`${onTimeLdCount} on-time order(s) carry LD clause`}>
                {onTimeLdCount} with LD
              </span>
            )}
          </div>
        </div>

        <div 
          onClick={() => setStatusFilter(prev => prev === 'delayed' ? 'all' : 'delayed')}
          className={`bg-white border p-5 sm:p-6 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] hover:shadow-md ${
            statusFilter === 'delayed'
              ? 'border-rose-600 ring-2 ring-rose-600/80 bg-rose-50/70 shadow-rose-100'
              : 'border-rose-200/80 bg-rose-50/20 hover:border-rose-400'
          }`}
          title={statusFilter === 'delayed' ? 'Click to show all orders' : 'Click to filter delayed orders only'}
        >
          <div className="flex items-center justify-between text-rose-800 text-xs mb-3 font-semibold">
            <span className="flex items-center gap-1.5">
              <span>Delayed Orders</span>
              {statusFilter === 'delayed' && (
                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span>
              )}
            </span>
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-extrabold text-rose-700 font-mono">{delayedOrders.length}</div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
              statusFilter === 'delayed' ? 'bg-rose-600 text-white' : 'bg-rose-100/80 text-rose-800'
            }`}>
              {statusFilter === 'delayed' ? '⚠ Filter Active' : 'Click to filter'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-2 flex-wrap">
            <p className="text-xs text-rose-600 font-medium">Requires schedule attention</p>
            {delayedLdCount > 0 && (
              <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-black" title={`${delayedLdCount} delayed order(s) have LD clause liability`}>
                ⚠️ {delayedLdCount} LD Delayed
              </span>
            )}
          </div>
        </div>

        {/* LD (Liquidated Damages) Orders Filter Card - Accessible to All Roles */}
        <div 
          onClick={() => setStatusFilter(prev => prev === 'ld' ? 'all' : 'ld')}
          className={`bg-white border p-5 sm:p-6 rounded-2xl shadow-xs cursor-pointer transition-all hover:scale-[1.01] hover:shadow-md ${
            statusFilter === 'ld'
              ? 'border-amber-600 ring-2 ring-amber-600/80 bg-amber-50/70 shadow-amber-100'
              : 'border-amber-200/80 bg-amber-50/20 hover:border-amber-400'
          }`}
          title={statusFilter === 'ld' ? 'Click to show all orders' : 'Click to filter LD (Liquidated Damages) orders only'}
        >
          <div className="flex items-center justify-between text-amber-800 text-xs mb-3 font-semibold">
            <span className="flex items-center gap-1.5">
              <span>LD Orders</span>
              {statusFilter === 'ld' && (
                <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse"></span>
              )}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black font-mono bg-amber-500 text-slate-950 border border-amber-600 shadow-2xs">
              LD
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-extrabold text-amber-700 font-mono">{ldOrders.length}</div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
              statusFilter === 'ld' ? 'bg-amber-600 text-white' : 'bg-amber-100/80 text-amber-800'
            }`}>
              {statusFilter === 'ld' ? '⚖ Filter Active' : 'Click to filter'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-2 flex-wrap">
            <p className="text-xs text-amber-700 font-medium">Liquidated Damages</p>
            {delayedLdCount > 0 ? (
              <span className="text-[10px] font-bold font-mono text-rose-700">
                {delayedLdCount} Delayed
              </span>
            ) : (
              <span className="text-[10px] font-bold font-mono text-emerald-700">
                All On Track
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Current Active Orders Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="font-bold text-base text-slate-900">Current Active Orders &amp; Work Progress</h2>
              {statusFilter !== 'all' && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold font-mono border ${
                  statusFilter === 'on_time'
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : statusFilter === 'delayed'
                    ? 'bg-rose-100 text-rose-900 border-rose-300'
                    : 'bg-amber-100 text-amber-900 border-amber-300'
                }`}>
                  {statusFilter === 'on_time' 
                    ? `Filtered: On Time (${onTimeOrders.length})` 
                    : statusFilter === 'delayed'
                    ? `Filtered: Delayed (${delayedOrders.length})`
                    : `Filtered: LD Orders (${ldOrders.length})`}
                </span>
              )}
              {searchQuery.trim() && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-100 text-cyan-950 border border-cyan-300 flex items-center gap-1">
                  <span>Results: <strong>{displayedOrders.length}</strong></span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPMRole ? 'Use "Baseline Edit" to revise master timelines, or click "Details" to inspect stage progression.' : 'Click "Details" on any order to inspect shop-floor work or stage changes.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Real-time Order Search Bar */}
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search PO #, Customer, Product, Stage..."
                className="w-full pl-8 pr-8 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {(statusFilter !== 'all' || searchQuery.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold border border-slate-300 transition-colors cursor-pointer shadow-2xs flex items-center gap-1 shrink-0"
                title="Reset all filters and clear search"
              >
                Reset
              </button>
            )}
            <span className="px-2.5 py-1.5 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold font-mono border border-emerald-200 shrink-0">
              {displayedOrders.length} / {activeOrders.length}
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
                <th className="py-4 px-6 text-center">Timeline Validation &amp; Schedule</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {displayedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    {searchQuery.trim() ? (
                      <div className="py-4">
                        <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="font-bold text-slate-800 text-sm">No Orders Found Matching "{searchQuery}"</p>
                        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                          No active factory orders matched your search term across PO numbers, customer names, product tag items, or milestone stages.
                        </p>
                        {matchingPendingBaseline.length > 0 && (
                          <div className="mt-3 inline-flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>
                              {matchingPendingBaseline.length} order(s) matching "{searchQuery}" are currently in <strong>Baseline Pending</strong> review.
                            </span>
                            <button
                              type="button"
                              onClick={() => onNavigateModule('3. Baseline Review & Planning')}
                              className="font-bold underline text-amber-800 hover:text-amber-950 cursor-pointer ml-1"
                            >
                              Go to Baseline Planning &rarr;
                            </button>
                          </div>
                        )}
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs cursor-pointer shadow-2xs"
                          >
                            Clear Search
                          </button>
                        </div>
                      </div>
                    ) : statusFilter === 'delayed' ? (
                      <div className="py-4">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                        <p className="font-bold text-slate-800 text-sm">No Delayed Orders</p>
                        <p className="text-xs text-slate-500 mt-1">All active factory orders are running strictly on schedule according to approved baselines.</p>
                        <button
                          onClick={() => setStatusFilter('all')}
                          className="mt-3 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs cursor-pointer shadow-2xs"
                        >
                          Show All Orders ({activeOrders.length})
                        </button>
                      </div>
                    ) : statusFilter === 'on_time' ? (
                      <div className="py-4">
                        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
                        <p className="font-bold text-slate-800 text-sm">No On-Time Orders</p>
                        <p className="text-xs text-slate-500 mt-1">All active factory orders are currently carrying delayed milestone variances.</p>
                        <button
                          onClick={() => setStatusFilter('all')}
                          className="mt-3 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs cursor-pointer shadow-2xs"
                        >
                          Show All Orders ({activeOrders.length})
                        </button>
                      </div>
                    ) : statusFilter === 'ld' ? (
                      <div className="py-4">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                        <p className="font-bold text-slate-800 text-sm">No Liquidated Damages (LD) Orders</p>
                        <p className="text-xs text-slate-500 mt-1">There are currently no active orders with Liquidated Damages penalty clauses.</p>
                        <button
                          onClick={() => setStatusFilter('all')}
                          className="mt-3 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs cursor-pointer shadow-2xs"
                        >
                          Show All Orders ({activeOrders.length})
                        </button>
                      </div>
                    ) : (
                      'No active orders found. Click "+ Add New Order" above to create one.'
                    )}
                  </td>
                </tr>
              ) : (
                displayedOrders.map((po) => {
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-emerald-800 text-sm">
                            {po.poNumber}
                          </span>
                          {po.isLd && (
                            <span 
                              className="px-2 py-0.5 rounded-full text-[10px] font-black font-mono tracking-wide bg-amber-500 text-slate-950 border border-amber-600 shadow-2xs shrink-0" 
                              title="Liquidated Damages (LD) clause applicable"
                            >
                              LD
                            </span>
                          )}
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
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-xs ${
                              po.isLd 
                                ? 'bg-rose-100 text-rose-900 border-rose-400 font-extrabold ring-1 ring-rose-300' 
                                : 'bg-rose-100 text-rose-800 border-rose-300'
                            }`}>
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                              DELAYED ({statusSummary.delayDays > 0 ? `+${statusSummary.delayDays}d` : ''}){po.isLd ? ' • LD AT RISK' : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              {po.isLd ? 'ON TIME (LD)' : 'ON TIME'}
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

                          {onOpenCancelModal && !po.isClosed && activeRole !== 'Viewer' && (
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
