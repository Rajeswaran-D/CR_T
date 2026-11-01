import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { PurchaseOrder, ProductLine, Milestone } from '../../types';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

interface DesignModuleProps {
  onOpenManualInput: (po: PurchaseOrder, line: ProductLine, ms: Milestone, type: 'start' | 'complete') => void;
}

export const DesignModule: React.FC<DesignModuleProps> = ({ onOpenManualInput }) => {
  const { purchaseOrders, activeRole } = useApp();
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'completed'>('active');

  const isDesignRole = activeRole === 'Project Management' || activeRole === 'DE (BOM Release)';

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
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Design & Engineering Stage Verification</h1>
          <p className="text-xs text-slate-500 mt-1">Manage 3D CAD sign-offs, drawing verification, Engineering Change Notes (ECN) & BOM releases</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl text-xs">
            <button
              onClick={() => setStatusFilter("active")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === "active"
                  ? "bg-white text-emerald-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => setStatusFilter("completed")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === "completed"
                  ? "bg-white text-emerald-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Completed ({completedCount})
            </button>
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                statusFilter === "all"
                  ? "bg-white text-emerald-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All
            </button>
          </div>
          <div className="px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-full text-purple-800 font-mono text-xs font-semibold">
            Role: {activeRole} {isDesignRole ? '(Authorized)' : '(Read-Only)'}
          </div>
        </div>
      </div>

      {/* Dependency Warning Ribbon */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-xs text-slate-800 shadow-xs">
        <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
        <div>
          <span className="font-bold text-emerald-900">Flow #3 Dependency Rule:</span>
          <p className="text-[11px] text-slate-600 mt-0.5">
            For <strong>New Design</strong> product lines, raw material procurement is locked until Design Stage completion & BOM finalization.
          </p>
        </div>
      </div>

      {/* Product Lines Design Table */}
      <div className="space-y-6">
        {filteredOrders.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-medium bg-white rounded-xl border border-slate-200">
            No orders found in this view.
          </div>
        ) : filteredOrders.map((po) => (
          <div key={po.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-emerald-800">{po.poNumber}</span>
                <span className="text-slate-600">| Customer: {po.customerName}</span>
                {po.isClosed && <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-600 text-[10px] font-bold">CLOSED</span>}
              </div>
              <span className="text-slate-500 font-mono text-[10px]">PO Date: {po.poDate}</span>
            </div>

            <div className="p-5 space-y-3.5">
              {po.productLines.map((line) => {
                const designMs = line.milestones.find(m => m.key === 'design_approval');
                if (!designMs) return null;

                const isCompleted = designMs.status === 'Completed';

                return (
                  <div key={line.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-slate-500">{line.lineNumber}:</span>
                        <span className="font-bold text-slate-900 text-sm">{line.productName}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                          line.designType === 'New Design' ? 'bg-purple-50 border-purple-200 text-purple-800' : 'bg-slate-100 border-slate-200 text-slate-700'
                        }`}>
                          {line.designType}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] text-slate-600 font-mono pt-1">
                        <span>Milestone: <strong>{designMs.name}</strong></span>
                        <span>Baseline End: {designMs.committedBaselineEndDate}</span>
                        <span>Forecast End: {designMs.forecastEndDate}</span>
                        {designMs.approvalReference && (
                          <span className="text-emerald-800 font-bold">Approval Ref: {designMs.approvalReference}</span>
                        )}
                        {designMs.drawingNumber && (
                          <span className="text-slate-700">Drawing: {designMs.drawingNumber}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                        isCompleted ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}>
                        {designMs.status}
                      </span>

                      {isDesignRole && !isCompleted && (
                        <button
                          onClick={() => onOpenManualInput(po, line, designMs, 'complete')}
                          className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" /> Sign-off Design Approval
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
