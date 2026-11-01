import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder, DesignType } from '../../types';
import { Search, Plus, Filter, CheckCircle2, ArrowRight, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';
import { BulkImportModal } from '../modals/BulkImportModal';
import { downloadCsvTemplate } from '../../services/csvImportService';

interface PurchaseOrdersModuleProps {
  onSelectPO: (po: PurchaseOrder) => void;
}

export const PurchaseOrdersModule: React.FC<PurchaseOrdersModuleProps> = ({ onSelectPO }) => {
  const { purchaseOrders, createPurchaseOrder, activeRole, templates } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);

  // Create PO Form State
  const [newPoNumber, setNewPoNumber] = useState('');
  const [newCustomer, setNewCustomer] = useState('');
  const [newPoRef, setNewPoRef] = useState('');
  const [newContractRef, setNewContractRef] = useState('');
  const [newBookedAmount, setNewBookedAmount] = useState('');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState(templates[0]?.categoryName || 'High-Pressure Control Valves');
  const [designType, setDesignType] = useState<DesignType>('New Design');
  const [qty, setQty] = useState(10);
  const [createError, setCreateError] = useState('');

  const filteredPOs = purchaseOrders.filter(po => {
    const matchesSearch = po.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          po.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          po.customerPoRef.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || po.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.trim() || !productName.trim()) return;

    if (newPoNumber.trim()) {
      const isDuplicate = purchaseOrders.some(
        p => p.poNumber.trim().toLowerCase() === newPoNumber.trim().toLowerCase()
      );
      if (isDuplicate) {
        setCreateError(`Duplicate PO Number: Purchase Order "${newPoNumber.trim()}" already exists. PO numbers must be strictly unique.`);
        return;
      }
    }

    setCreateError('');
    const parsedBooked = newBookedAmount.trim() ? parseFloat(newBookedAmount.replace(/[^0-9.-]+/g, '')) : undefined;
    const res = createPurchaseOrder({
      poNumber: newPoNumber.trim() || undefined,
      customerName: newCustomer,
      customerPoRef: newPoRef || `PO-REF-${Math.floor(1000 + Math.random() * 9000)}`,
      bookedAmount: parsedBooked !== undefined && !isNaN(parsedBooked) ? parsedBooked : undefined,
      contractReviewRef: newContractRef || `CR-2026-${Math.floor(100 + Math.random() * 900)}`,
      productLines: [
        {
          id: '',
          lineNumber: 'LINE-01',
          productName,
          category,
          qty,
          designType,
          milestones: [],
          materials: [],
          overallVarianceDays: 0,
          status: 'Not Started'
        }
      ]
    });

    if (!res.success) {
      setCreateError(res.error || 'Failed to create purchase order.');
      return;
    }

    setShowCreateModal(false);
    setNewPoNumber('');
    setNewCustomer('');
    setNewPoRef('');
    setNewContractRef('');
    setNewBookedAmount('');
    setProductName('');
    setCreateError('');
  };

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Purchase Orders Registry</h1>
          <p className="text-xs text-slate-500 mt-1">Manage customer contracts, product lines, baseline revisions & closure summaries</p>
        </div>

        {activeRole === 'Project Management' || activeRole === 'Sales / AE (Customer PO)' || activeRole === 'Project Manager (PM Baseline)' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsvTemplate}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold shadow-2xs transition-all cursor-pointer"
              title="Download empty/prefilled CSV template with standard milestone columns"
            >
              <Download className="w-4 h-4 text-slate-500" /> Download Template (.csv)
            </button>
            <button
              onClick={() => setShowBulkImportModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer"
              title="Import spreadsheet with active orders and historical stage dates"
            >
              <FileSpreadsheet className="w-4 h-4 text-blue-200" /> Bulk Import (CSV / Excel)
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Log New Purchase Order (Flow #1)
            </button>
          </div>
        ) : null}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 text-xs shadow-xs">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by PO number, customer name, contract ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-slate-600 font-medium">Status Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses ({purchaseOrders.length})</option>
            <option value="In Progress">In Progress</option>
            <option value="At Risk">At Risk</option>
            <option value="Delayed">Delayed</option>
            <option value="Completed">Completed</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {/* PO Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <th className="py-3.5 px-4">PO Identifier</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-4">Contract Ref</th>
                <th className="py-3.5 px-4">Product Line Detail</th>
                <th className="py-3.5 px-4">Design Type</th>
                <th className="py-3.5 px-4">Committed Baseline</th>
                <th className="py-3.5 px-4">Forecast End</th>
                <th className="py-3.5 px-4 text-center">Variance</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredPOs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    No purchase orders match the selected search/filter criteria.
                  </td>
                </tr>
              ) : (
                filteredPOs.map((po) => {
                  const firstLine = po.productLines[0];
                  const maxVariance = Math.max(...(po.productLines || []).map(l => l.overallVarianceDays || 0), 0);
                  const maxForecast = firstLine?.milestones.slice(-1)[0]?.forecastEndDate || po.revisedDeliveryDate;

                  return (
                    <tr 
                      key={po.id} 
                      onClick={() => onSelectPO(po)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-800">
                        {po.poNumber}
                        <div className="text-[10px] text-slate-400 font-normal">Created by {po.createdBy}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-900 font-semibold">{po.customerName}</td>
                      <td className="py-3.5 px-4 text-slate-500 font-mono">
                        <div>{po.contractReviewRef}</div>
                        {po.bookedAmount !== undefined && (
                          <div className="text-[10px] text-emerald-800 font-bold font-mono">
                            ${Number(po.bookedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-800">
                        <div className="font-semibold text-slate-900">{firstLine?.productName}</div>
                        <div className="text-[10px] text-slate-500">{po.productLines.length} Line(s) • Qty {firstLine?.qty}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          firstLine?.designType === 'New Design' 
                            ? 'bg-purple-50 border-purple-200 text-purple-800' 
                            : 'bg-slate-100 border-slate-200 text-slate-700'
                        }`}>
                          {firstLine?.designType}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-mono">{po.committedDeliveryDate}</td>
                      <td className="py-3.5 px-4 text-slate-800 font-mono font-semibold">{maxForecast}</td>
                      <td className="py-3.5 px-4 text-center font-mono">
                        <span className={maxVariance > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-medium'}>
                          {maxVariance > 0 ? `+${maxVariance}d` : '0d'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          po.status === 'Delayed' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                          po.status === 'At Risk' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                          po.status === 'Completed' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                          po.status === 'Closed' ? 'bg-slate-100 border-slate-200 text-slate-600' :
                          'bg-emerald-50 border-emerald-200 text-emerald-800'
                        }`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button className="p-1 text-slate-400 hover:text-emerald-700 transition-colors">
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flow #1 Create PO Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 shadow-2xl space-y-4 text-slate-800">
            <h2 className="font-bold text-base text-slate-900 border-b border-slate-100 pb-3">
              Flow #1: Log Customer PO & Auto-Generate Schedule
            </h2>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              {createError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-medium text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-700 font-semibold">PO Identifier</label>
                    <span className="text-[10px] text-slate-400 font-mono">Optional</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Auto: PO-2026-XXX"
                    value={newPoNumber}
                    onChange={(e) => setNewPoNumber(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg text-xs font-mono font-bold focus:outline-none ${
                      newPoNumber.trim() && purchaseOrders.some(p => p.poNumber.trim().toLowerCase() === newPoNumber.trim().toLowerCase())
                        ? 'border-rose-400 text-rose-800 bg-rose-50/40'
                        : newPoNumber.trim()
                        ? 'border-emerald-400 text-emerald-900 bg-emerald-50/30'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  />
                  <div className="text-[9px] mt-0.5 font-mono">
                    {newPoNumber.trim() ? (
                      purchaseOrders.some(p => p.poNumber.trim().toLowerCase() === newPoNumber.trim().toLowerCase()) ? (
                        <span className="text-rose-600 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" /> Duplicate: in use
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Strictly unique
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">Auto-assigns next sequential ID</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Customer Organization Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Shell Chemicals Americas"
                    value={newCustomer}
                    onChange={(e) => setNewCustomer(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 mb-1">Customer PO Ref *</label>
                  <input
                    type="text"
                    required
                    placeholder="PO-SHELL-99120"
                    value={newPoRef}
                    onChange={(e) => setNewPoRef(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1">Booked Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 150000"
                    value={newBookedAmount}
                    onChange={(e) => setNewBookedAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 mb-1">Contract Review Ref *</label>
                  <input
                    type="text"
                    required
                    placeholder="CR-2026-0610"
                    value={newContractRef}
                    onChange={(e) => setNewContractRef(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div className="font-semibold text-emerald-800">Product Line #1 Specification</div>

                <div>
                  <label className="block text-slate-700 mb-1">Product Line Description *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CFT-HV-600 Cryogenic Control Valve 6'' 2500#"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-slate-600 mb-1">Category Template</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
                    >
                      {templates.map(t => (
                        <option key={t.id} value={t.categoryName}>{t.categoryName}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 mb-1">Design Tag *</label>
                    <select
                      value={designType}
                      onChange={(e) => setDesignType(e.target.value as DesignType)}
                      className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
                    >
                      <option value="Existing Design">Existing Design</option>
                      <option value="New Design">New Design</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 mb-1">Batch Qty</label>
                    <input
                      type="number"
                      min="1"
                      value={qty}
                      onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 text-center font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-slate-700">
                <span className="font-bold text-emerald-800">Auto-Generation Rule:</span> Selecting category and design tag auto-calculates committed baseline milestone dates from Admin Templates.
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" />
                  Generate PO & Baseline Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      <BulkImportModal
        isOpen={showBulkImportModal}
        onClose={() => setShowBulkImportModal(false)}
      />

    </div>
  );
};
