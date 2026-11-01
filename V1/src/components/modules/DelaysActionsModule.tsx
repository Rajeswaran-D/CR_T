import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { RectificationAction } from '../../types';
import { CheckCircle2, XCircle } from 'lucide-react';

export const DelaysActionsModule: React.FC = () => {
  const { rectifications, approveRectification, activeRole } = useApp();

  const [selectedAction, setSelectedAction] = useState<RectificationAction | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');

  const handleDecision = (decision: 'Accepted' | 'Rejected') => {
    if (!selectedAction) return;
    if (!decisionNotes.trim()) return;

    approveRectification(selectedAction.id, decision, decisionNotes, `${activeRole} User`);
    setSelectedAction(null);
    setDecisionNotes('');
  };

  const isManager = activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)';

  return (
    <div className="p-8 space-y-6 bg-slate-50 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Delays Register & Rectification Actions</h1>
          <p className="text-xs text-slate-500 mt-1">Rule-based corrective action engine, cause categorization, owner assignment & manager approvals</p>
        </div>
        <div className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-800 font-mono text-xs font-semibold">
          Role: {activeRole} {isManager ? '(Manager Approver)' : '(Read-Only)'}
        </div>
      </div>

      {/* Rectification Register Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <th className="py-3.5 px-4">PO & Line</th>
                <th className="py-3.5 px-4">Milestone Delayed</th>
                <th className="py-3.5 px-4">Action Type</th>
                <th className="py-3.5 px-4">Proposed Corrective Action</th>
                <th className="py-3.5 px-4 text-center">Impact Saved</th>
                <th className="py-3.5 px-4">Assigned Owner</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {rectifications.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No delay rectifications logged in register.
                  </td>
                </tr>
              ) : (
                rectifications.map((rect) => (
                  <tr key={rect.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-800">
                      {rect.poNumber}
                      <div className="text-[10px] text-slate-500 font-normal">{rect.productLineName}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-900 font-semibold">{rect.milestoneName}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 font-mono text-[10px] font-bold">
                        {rect.type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-800 max-w-xs">
                      <div className="font-bold text-slate-900">{rect.title}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{rect.description}</div>
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-emerald-700 text-sm">
                      +{rect.impactDaysSaved}d
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 font-medium">{rect.assignedTo}</td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        rect.status === 'Accepted' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                        rect.status === 'Rejected' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                        'bg-slate-100 border-slate-200 text-slate-700'
                      }`}>
                        {rect.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {rect.status === 'Proposed' && isManager && (
                        <button
                          onClick={() => setSelectedAction(rect)}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Review & Decide
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Modal */}
      {selectedAction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-2xl space-y-4 text-slate-800">
            <h2 className="font-bold text-base text-slate-900 border-b border-slate-100 pb-3">
              Manager Rectification Decision Sign-off
            </h2>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
              <div className="font-bold text-amber-800">{selectedAction.title}</div>
              <p className="text-slate-600">{selectedAction.description}</p>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-2 pt-2 border-t border-slate-200">
                <span>Target Savings: +{selectedAction.impactDaysSaved} days</span>
                <span>Assigned: {selectedAction.assignedTo}</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 text-xs font-semibold mb-1">
                Decision Rationale & Authorization Notes *
              </label>
              <textarea
                rows={3}
                required
                placeholder="Explain justification for accepting or rejecting this corrective action..."
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedAction(null)}
                className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDecision('Rejected')}
                className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject Action
              </button>
              <button
                type="button"
                onClick={() => handleDecision('Accepted')}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200" /> Authorize & Accept Action
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
