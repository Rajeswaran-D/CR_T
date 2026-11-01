import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Save, 
  Package, 
  Settings, 
  History, 
  AlertTriangle, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Search, 
  Eye, 
  Archive, 
  X,
  Edit3,
  RotateCcw,
  Lock,
  BarChart3
} from 'lucide-react';
import { ProductCatalogModule } from './ProductCatalogModule';
import { YearlyCompletedOrdersReport } from './YearlyCompletedOrdersReport';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import type { PurchaseOrder, CategoryTemplate } from '../../types';

interface AdministrationModuleProps {
  onSelectPO?: (po: PurchaseOrder) => void;
}

export const AdministrationModule: React.FC<AdministrationModuleProps> = ({ onSelectPO }) => {
  const { 
    purchaseOrders, 
    templates, 
    updateTemplates,
    config, 
    updateConfig, 
    activeRole,
    approvePOCancellation,
    rejectPOCancellation,
    deletePurchaseOrder,
    pendingCancellationCount
  } = useApp();

  const [activeTab, setActiveTab] = useState<'history' | 'reports' | 'requests' | 'governance' | 'catalog'>('history');
  const [atRiskDays, setAtRiskDays] = useState(config.atRiskThresholdDays);
  const [delayedDays, setDelayedDays] = useState(config.delayedThresholdDays);
  
  // Template Configuration Edit State
  const [editableTemplates, setEditableTemplates] = useState<CategoryTemplate[]>(templates);
  const [isEditingTemplates, setIsEditingTemplates] = useState(false);
  const [templateSuccessMsg, setTemplateSuccessMsg] = useState<string | null>(null);
  const [configSuccessMsg, setConfigSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setEditableTemplates(templates);
  }, [templates]);

  // History Filters
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | 'completed' | 'cancelled' | 'active'>('all');

  // Decision Modal State for Requests
  const [decisionModal, setDecisionModal] = useState<{
    isOpen: boolean;
    po: PurchaseOrder | null;
    actionType: 'approve_cancel' | 'approve_delete' | 'reject';
    notes: string;
  }>({ isOpen: false, po: null, actionType: 'approve_cancel', notes: '' });

  const isAdmin = activeRole === 'Project Management';

  const handleDurationChange = (templateId: string, milestoneKey: string, newDays: number) => {
    const val = Math.max(1, newDays || 1);
    setEditableTemplates(prev => prev.map(tmpl => {
      if (tmpl.id !== templateId) return tmpl;
      return {
        ...tmpl,
        milestoneDurations: tmpl.milestoneDurations.map(m => 
          m.milestoneKey === milestoneKey ? { ...m, durationDays: val } : m
        )
      };
    }));
  };

  const handleSaveTemplates = () => {
    updateTemplates(editableTemplates);
    setIsEditingTemplates(false);
    setTemplateSuccessMsg('Category schedule templates and default durations saved successfully.');
    setTimeout(() => setTemplateSuccessMsg(null), 3000);
  };

  const handleCancelTemplateEdit = () => {
    setEditableTemplates(templates);
    setIsEditingTemplates(false);
  };

  const handleResetTemplateDefaults = () => {
    const confirmed = window.confirm('Reset all category template milestone durations to factory defaults?');
    if (!confirmed) return;

    const DEFAULT_DURATIONS: Record<string, number> = {
      po_from_customer: 1,
      pm_baseline: 3,
      corb_release: 2,
      bom_release: 3,
      wo_release: 2,
      sub_supplier_po: 3,
      material_receipt: 14,
      machining: 14,
      assembly: 5,
      fg: 2,
      customer_inspection: 2,
      painting: 2,
      trn: 1,
      shipment: 5
    };

    const reset = editableTemplates.map(tmpl => ({
      ...tmpl,
      milestoneDurations: tmpl.milestoneDurations.map(m => ({
        ...m,
        durationDays: DEFAULT_DURATIONS[m.milestoneKey] || m.durationDays
      }))
    }));

    setEditableTemplates(reset);
    updateTemplates(reset);
    setIsEditingTemplates(false);
    setTemplateSuccessMsg('Schedule templates restored to standard 14-stage defaults.');
    setTimeout(() => setTemplateSuccessMsg(null), 3000);
  };

  const handleSaveConfig = () => {
    updateConfig({
      ...config,
      atRiskThresholdDays: atRiskDays,
      delayedThresholdDays: delayedDays
    });
    setConfigSuccessMsg('Variance thresholds saved successfully.');
    setTimeout(() => setConfigSuccessMsg(null), 3000);
  };

  // Orders calculations for History
  const completedOrders = purchaseOrders.filter(p => p.status === 'Completed' || p.isClosed);
  const cancelledOrders = purchaseOrders.filter(p => p.status === 'Cancelled' || p.isCancelled);
  const activeOrders = purchaseOrders.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled' && !p.isClosed);
  
  // Pending cancellation requests
  const pendingRequests = purchaseOrders.filter(p => p.cancellationRequest?.status === 'Pending');
  const resolvedRequests = purchaseOrders.filter(p => p.cancellationRequest && p.cancellationRequest.status !== 'Pending');

  const filteredHistoryOrders = purchaseOrders.filter(po => {
    // Status Filter
    if (historyStatusFilter === 'completed' && !(po.status === 'Completed' || (po.isClosed && !po.isCancelled))) return false;
    if (historyStatusFilter === 'cancelled' && !(po.status === 'Cancelled' || po.isCancelled)) return false;
    if (historyStatusFilter === 'active' && (po.status === 'Completed' || po.status === 'Cancelled' || po.isClosed)) return false;

    // Search Filter
    if (historySearch.trim()) {
      const term = historySearch.toLowerCase();
      const matchPO = po.poNumber.toLowerCase().includes(term);
      const matchCust = po.customerName.toLowerCase().includes(term);
      const matchProd = po.productLines.some(l => l.productName.toLowerCase().includes(term));
      return matchPO || matchCust || matchProd;
    }
    return true;
  });

  const handleExecuteDecision = () => {
    if (!decisionModal.po) return;

    if (decisionModal.actionType === 'approve_delete') {
      const confirmed = window.confirm(`WARNING: Are you sure you want to permanently delete PO "${decisionModal.po.poNumber}"? This action cannot be undone.`);
      if (!confirmed) return;
      approvePOCancellation({
        poId: decisionModal.po.id,
        actionType: 'delete',
        decisionNotes: decisionModal.notes.trim() || undefined
      });
    } else if (decisionModal.actionType === 'approve_cancel') {
      approvePOCancellation({
        poId: decisionModal.po.id,
        actionType: 'cancel',
        decisionNotes: decisionModal.notes.trim() || undefined
      });
    } else if (decisionModal.actionType === 'reject') {
      if (!decisionModal.notes.trim()) {
        alert('Please provide rejection justification notes.');
        return;
      }
      rejectPOCancellation({
        poId: decisionModal.po.id,
        decisionNotes: decisionModal.notes.trim()
      });
    }

    setDecisionModal({ isOpen: false, po: null, actionType: 'approve_cancel', notes: '' });
  };

  const handleDirectDelete = (po: PurchaseOrder) => {
    const confirmed = window.confirm(`Are you sure you want to permanently purge order "${po.poNumber}" from history?`);
    if (!confirmed) return;
    deletePurchaseOrder(po.id, 'Admin purged order from history archive.');
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              ADMINISTRATIVE CONTROL
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              {activeRole} {isAdmin ? '(Administrator)' : '(Read-Only)'}
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">System Administration & Orders Archive</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Access complete orders history archive, review role-based cancellation and deletion requests, manage product catalog, and configure governance thresholds.
          </p>
        </div>

        {pendingCancellationCount > 0 && (
          <button
            onClick={() => setActiveTab('requests')}
            className="px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs animate-pulse"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>{pendingCancellationCount} Cancellation {pendingCancellationCount === 1 ? 'Request' : 'Requests'} Pending</span>
          </button>
        )}
      </div>

      {/* Admin Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
            activeTab === 'history'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Complete Orders History & Archive</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
            activeTab === 'reports'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Annual Performance & Insights</span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 relative ${
            activeTab === 'requests'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Cancellation & Delete Requests</span>
          {pendingCancellationCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold ml-1">
              {pendingCancellationCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('governance')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
            activeTab === 'governance'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Governance & Thresholds</span>
        </button>

        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
            activeTab === 'catalog'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Product Catalog Master</span>
        </button>
      </div>

      {/* TAB 1: COMPLETE ORDERS HISTORY & ARCHIVE */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="text-[11px] font-bold text-slate-400 font-mono uppercase">Total Historical Orders</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{purchaseOrders.length}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">All registered orders in system</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="text-[11px] font-bold text-emerald-700 font-mono uppercase">Completed & Delivered</div>
              <div className="text-2xl font-black text-emerald-700 mt-1">{completedOrders.length}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">100% finished lifecycle</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="text-[11px] font-bold text-rose-700 font-mono uppercase">Cancelled Orders</div>
              <div className="text-2xl font-black text-rose-700 mt-1">{cancelledOrders.length}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Terminated with recorded reasons</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="text-[11px] font-bold text-blue-700 font-mono uppercase">Active in Pipeline</div>
              <div className="text-2xl font-black text-blue-700 mt-1">{activeOrders.length}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Live shop floor manufacturing</div>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            
            {/* Table Filter Controls */}
            <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by PO#, customer, product..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs w-64 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-500 mr-1">Filter:</span>
                <button
                  onClick={() => setHistoryStatusFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    historyStatusFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All ({purchaseOrders.length})
                </button>
                <button
                  onClick={() => setHistoryStatusFilter('completed')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    historyStatusFilter === 'completed'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Completed ({completedOrders.length})
                </button>
                <button
                  onClick={() => setHistoryStatusFilter('cancelled')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    historyStatusFilter === 'cancelled'
                      ? 'bg-rose-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Cancelled ({cancelledOrders.length})
                </button>
                <button
                  onClick={() => setHistoryStatusFilter('active')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    historyStatusFilter === 'active'
                      ? 'bg-blue-700 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Active ({activeOrders.length})
                </button>
              </div>
            </div>

            {/* Orders Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">PO Number</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Product Details</th>
                    <th className="py-3 px-4">Order Dates</th>
                    <th className="py-3 px-4">Revisions</th>
                    <th className="py-3 px-4">Status & Reason</th>
                    <th className="py-3 px-4 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredHistoryOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        No orders match the selected search or filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryOrders.map((po) => {
                      const firstLine = po.productLines[0];
                      const totalQty = po.productLines.reduce((acc, l) => acc + (l.qty || 1), 0);
                      const isCancelled = po.status === 'Cancelled' || po.isCancelled;
                      const isCompleted = po.status === 'Completed' || (po.isClosed && !isCancelled);
                      const revCount = po.revisions?.length || 0;

                      const statusSummary = getPOManufacturingStatus(po);

                      return (
                        <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-emerald-800">
                            {po.poNumber}
                            {po.cancellationRequest?.status === 'Pending' && (
                              <span className="block mt-0.5 text-[9px] font-mono font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded w-max">
                                Cancel Pending
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {po.customerName}
                            <div className="text-[10px] text-slate-400 font-mono">Ref: {po.customerPoRef}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            <span className="font-medium">{firstLine?.productName || 'Standard Item'}</span>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {po.productLines.length} Line{po.productLines.length !== 1 ? 's' : ''} • Qty: {totalQty} Pcs
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                            <div>PO: <strong className="text-slate-800">{po.poDate}</strong></div>
                            <div>Target: <strong className="text-slate-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong></div>
                          </td>
                          <td className="py-3 px-4 font-mono text-center">
                            <span className="px-2 py-0.5 bg-slate-100 rounded-full font-bold text-[10px] text-slate-700">
                              Rev {revCount > 0 ? revCount - 1 : 0}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${
                                isCancelled ? 'bg-rose-100 text-rose-800 border-rose-300' :
                                isCompleted ? (statusSummary.delayDays > 0 ? 'bg-amber-100 text-amber-900 border-amber-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300') :
                                'bg-blue-100 text-blue-800 border-blue-300'
                              }`}>
                                {isCancelled ? 'CANCELLED' : isCompleted ? (statusSummary.delayDays > 0 ? `COMPLETED BY DELAY OF ${statusSummary.delayDays} DAYS` : 'COMPLETED ON TIME') : 'IN EXECUTION'}
                              </span>

                              {isCancelled && (po.cancellationReason || po.closureNotes) && (
                                <p className="text-[10px] text-rose-700 line-clamp-2 italic">
                                  "{po.cancellationReason || po.closureNotes}"
                                </p>
                              )}

                              {isCompleted && (
                                <p className={`text-[10px] line-clamp-1 ${statusSummary.delayDays > 0 ? 'text-amber-800 font-medium' : 'text-emerald-700'}`}>
                                  {statusSummary.delayDays > 0 ? `Completed with +${statusSummary.delayDays}d delay` : 'Delivered on original schedule'}
                                  {po.closureNotes ? ` — ${po.closureNotes}` : ''}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {onSelectPO && (
                                <button
                                  onClick={() => onSelectPO(po)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                                  title="View Full PO Drawer"
                                >
                                  <Eye className="w-3.5 h-3.5 text-slate-500" /> View
                                </button>
                              )}

                              {isAdmin && (
                                <button
                                  onClick={() => handleDirectDelete(po)}
                                  className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                  title="Purge / Delete Order Permanently"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
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

        </div>
      )}

      {/* TAB: ANNUAL PERFORMANCE & EXECUTIVE INSIGHTS */}
      {activeTab === 'reports' && (
        <YearlyCompletedOrdersReport onSelectPO={onSelectPO} />
      )}

      {/* TAB 2: CANCELLATION & DELETE REQUESTS */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          
          {/* Pending Requests Section */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-4 bg-amber-50/60 border-b border-amber-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">
                    Pending Cancellation & Deletion Requests ({pendingRequests.length})
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Requests submitted by operational roles requiring formal Administrator sign-off or rejection.
                  </p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {pendingRequests.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-50" />
                  No pending cancellation requests. All orders are running smoothly.
                </div>
              ) : (
                pendingRequests.map((po) => {
                  const req = po.cancellationRequest!;
                  const statusSummary = getPOManufacturingStatus(po);

                  return (
                    <div key={po.id} className="p-5 space-y-4 hover:bg-slate-50/50 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-emerald-800 text-sm bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              {po.poNumber}
                            </span>
                            <span className="font-bold text-slate-900">{po.customerName}</span>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600">{po.productLines[0]?.productName}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-3">
                            <span>Stage: <strong>{statusSummary.currentStageName}</strong></span>
                            <span>Delivery: <strong>{po.revisedDeliveryDate || po.committedDeliveryDate}</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full font-mono text-[10px] font-bold border border-amber-300 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-700" />
                            Requested by: {req.requestedRole}
                          </span>
                          <span className="text-slate-400 text-[10px] font-mono">
                            {new Date(req.requestedAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* Reason Box */}
                      <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1 text-xs">
                        <div className="font-bold text-rose-900 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Cancellation Justification:</span>
                        </div>
                        <p className="text-slate-800 pl-5 font-medium">
                          "{req.reason}"
                        </p>
                      </div>

                      {/* Admin Actions */}
                      {isAdmin ? (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            onClick={() => setDecisionModal({
                              isOpen: true,
                              po,
                              actionType: 'reject',
                              notes: ''
                            })}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5 text-slate-500" /> Reject
                          </button>
                          <button
                            onClick={() => setDecisionModal({
                              isOpen: true,
                              po,
                              actionType: 'approve_cancel',
                              notes: req.reason
                            })}
                            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1"
                          >
                            <Archive className="w-3.5 h-3.5" /> Approve & Archive as Cancelled
                          </button>
                          <button
                            onClick={() => setDecisionModal({
                              isOpen: true,
                              po,
                              actionType: 'approve_delete',
                              notes: req.reason
                            })}
                            className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Approve & Permanently Delete
                          </button>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 font-italic text-right">
                          Awaiting Administrator (Project Management) decision.
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Resolved Requests History */}
          {resolvedRequests.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider font-mono">
                  Resolved Requests History ({resolvedRequests.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {resolvedRequests.map((po) => {
                  const req = po.cancellationRequest!;
                  const isApproved = req.status === 'Approved';

                  return (
                    <div key={po.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-800">{po.poNumber}</span>
                          <span className="text-slate-600">{po.customerName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                            isApproved ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'
                          }`}>
                            {req.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px] mt-1">
                          <strong>Reason:</strong> "{req.reason}"
                        </p>
                        {req.decisionNotes && (
                          <p className="text-slate-500 text-[10px] mt-0.5 italic">
                            Admin notes: "{req.decisionNotes}"
                          </p>
                        )}
                      </div>

                      <div className="text-right text-[10px] font-mono text-slate-400">
                        <div>Decision by: <strong>{req.decisionBy || 'Admin'}</strong></div>
                        {req.decisionAt && <div>{new Date(req.decisionAt).toLocaleString()}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}

      {/* TAB 3: GOVERNANCE, TEMPLATES & THRESHOLDS */}
      {activeTab === 'governance' && (
        <div className="space-y-6">

          {/* Success Alerts */}
          {templateSuccessMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900 flex items-center gap-2 shadow-xs animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{templateSuccessMsg}</span>
            </div>
          )}

          {configSuccessMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900 flex items-center gap-2 shadow-xs animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{configSuccessMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Default Schedule Templates & Durations Editor */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-extrabold text-base text-slate-900">
                      Category Schedule Templates & Default Durations
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Standard milestone cycle days applied when new customer purchase orders are booked.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin ? (
                    !isEditingTemplates ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleResetTemplateDefaults}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1"
                          title="Reset to standard 14-stage factory defaults"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reset
                        </button>
                        <button
                          onClick={() => setIsEditingTemplates(true)}
                          className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Durations
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCancelTemplateEdit}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveTemplates}
                          className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" /> Save Durations
                        </button>
                      </div>
                    )
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px] font-semibold flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" /> Read Only (Admin Required)
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-5 max-h-[560px] overflow-y-auto pr-1">
                {(isEditingTemplates ? editableTemplates : templates).map(tmpl => {
                  const totalCycleDays = tmpl.milestoneDurations.reduce((acc, curr) => acc + (curr.durationDays || 0), 0);

                  return (
                    <div key={tmpl.id} className={`p-4 rounded-xl border transition-all ${isEditingTemplates ? 'bg-emerald-50/20 border-emerald-300 ring-1 ring-emerald-200' : 'bg-slate-50/80 border-slate-200'}`}>
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-900 text-sm">{tmpl.categoryName}</span>
                          <span className="px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-800 font-mono text-[10px] font-bold">
                            {tmpl.designType}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono font-bold bg-white px-2.5 py-1 rounded-md border border-slate-200 text-emerald-800 shadow-2xs">
                          Total Lead Time: {totalCycleDays} Days
                        </span>
                      </div>

                      <div className="divide-y divide-slate-200/80 text-xs bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
                        {tmpl.milestoneDurations.map((m) => (
                          <div key={m.milestoneKey} className="px-3.5 py-2.5 flex items-center justify-between text-slate-800 hover:bg-slate-50/60 transition-colors">
                            <span className="font-medium text-slate-700 text-[11px]">{m.milestoneName}</span>
                            
                            {isEditingTemplates ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange(tmpl.id, m.milestoneKey, (m.durationDays || 1) - 1)}
                                  className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs cursor-pointer border border-slate-300 active:scale-95"
                                  title="Decrease duration by 1 day"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  max="120"
                                  value={m.durationDays}
                                  onChange={(e) => handleDurationChange(tmpl.id, m.milestoneKey, parseInt(e.target.value) || 1)}
                                  className="w-14 px-1.5 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-center text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleDurationChange(tmpl.id, m.milestoneKey, (m.durationDays || 1) + 1)}
                                  className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs cursor-pointer border border-slate-300 active:scale-95"
                                  title="Increase duration by 1 day"
                                >
                                  +
                                </button>
                                <span className="font-mono text-[10px] text-slate-500 font-bold ml-1">Days</span>
                              </div>
                            ) : (
                              <span className="font-mono text-emerald-800 font-bold bg-emerald-50/80 px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                                {m.durationDays} Days
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {isEditingTemplates && (
                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    onClick={handleCancelTemplateEdit}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTemplates}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" /> Save Category Durations
                  </button>
                </div>
              )}
            </div>

            {/* Thresholds Config */}
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
                <div className="border-b border-slate-100 pb-4">
                  <h2 className="font-extrabold text-base text-slate-900">
                    Delay Variance Thresholds Configuration
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure tolerances for triggering automated "At Risk" and "Delayed" alerts across all active orders.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                  <div className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-2">
                    <label className="block text-amber-900 font-bold">At Risk Threshold (Days)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="30"
                        disabled={!isAdmin}
                        value={atRiskDays}
                        onChange={(e) => setAtRiskDays(parseInt(e.target.value) || 3)}
                        className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-slate-900 font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <span className="font-mono text-xs text-amber-800 font-bold">Days</span>
                    </div>
                    <p className="text-[11px] text-amber-700/90 leading-tight">
                      Milestones flag <strong>At Risk</strong> when schedule slippage exceeds this tolerance.
                    </p>
                  </div>

                  <div className="p-4 bg-rose-50/40 border border-rose-200 rounded-xl space-y-2">
                    <label className="block text-rose-900 font-bold">Delayed Threshold (Days)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="60"
                        disabled={!isAdmin}
                        value={delayedDays}
                        onChange={(e) => setDelayedDays(parseInt(e.target.value) || 7)}
                        className="w-full px-3 py-2 bg-white border border-rose-300 rounded-lg text-slate-900 font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                      <span className="font-mono text-xs text-rose-800 font-bold">Days</span>
                    </div>
                    <p className="text-[11px] text-rose-700/90 leading-tight">
                      Milestones flag <strong>Delayed</strong> and mandate baseline revision when variance exceeds this threshold.
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleSaveConfig}
                      className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Save className="w-4 h-4" /> Save Threshold Settings
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 4: PRODUCT CATALOG */}
      {activeTab === 'catalog' && (
        <div className="-mx-8 -my-6">
          <ProductCatalogModule />
        </div>
      )}

      {/* ADMIN DECISION MODAL */}
      {decisionModal.isOpen && decisionModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <span className="font-bold text-sm">
                {decisionModal.actionType === 'reject' ? 'Reject Cancellation Request' :
                 decisionModal.actionType === 'approve_delete' ? 'Approve & Permanently Delete PO' :
                 'Approve & Archive as Cancelled'}
              </span>
              <button 
                onClick={() => setDecisionModal({ isOpen: false, po: null, actionType: 'approve_cancel', notes: '' })}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-slate-600">
                Order: <strong className="font-mono text-slate-900">{decisionModal.po.poNumber}</strong> ({decisionModal.po.customerName})
              </p>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Administrator Decision Comments: <span className={decisionModal.actionType === 'reject' ? 'text-rose-600' : 'text-slate-400'}>*</span>
                </label>
                <textarea
                  rows={3}
                  value={decisionModal.notes}
                  onChange={(e) => setDecisionModal(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Enter administrator decision notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDecisionModal({ isOpen: false, po: null, actionType: 'approve_cancel', notes: '' })}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDecision}
                  className={`px-4 py-1.5 text-white rounded-lg font-bold shadow-xs cursor-pointer ${
                    decisionModal.actionType === 'reject' ? 'bg-slate-800 hover:bg-slate-900' :
                    decisionModal.actionType === 'approve_delete' ? 'bg-rose-700 hover:bg-rose-800' :
                    'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  Confirm Decision
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
