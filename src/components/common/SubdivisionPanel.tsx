import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { Subdivision, DelayCategory, Role } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { CheckSquare, AlertTriangle, Plus, Trash2, Edit2 } from 'lucide-react';

interface SubdivisionPanelProps {
  poId: string;
  productLineId: string;
  milestoneId: string;
  milestoneKey: string;
  milestoneStart: string;
  milestoneEnd: string;
  subdivisions: Subdivision[];
  isCompletedOrder?: boolean;
}

export const SubdivisionPanel: React.FC<SubdivisionPanelProps> = ({ poId, productLineId, milestoneId, milestoneKey, milestoneStart, milestoneEnd, subdivisions, isCompletedOrder }) => {
  const { activeRole, addSubdivision, updateSubdivision, deleteSubdivision, purchaseOrders } = useApp();
  
  const currentPO = purchaseOrders.find(p => p.id === poId);
  const isPOClosedOrDone = isCompletedOrder || currentPO?.isClosed || currentPO?.status === 'Completed';

  const canManageSubtasks = !isPOClosedOrDone && isMilestoneOwnedByRole(milestoneKey, activeRole);
  const [isOpen, setIsOpen] = useState(subdivisions.length > 0);
  
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTargetStart, setNewTargetStart] = useState('');
  const [newTargetEnd, setNewTargetEnd] = useState('');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<Subdivision['status']>('Not Started');
  const [editDelayCause, setEditDelayCause] = useState<DelayCategory | ''>('');
  const [editDelayNote, setEditDelayNote] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editTargetStart, setEditTargetStart] = useState('');
  const [editTargetEnd, setEditTargetEnd] = useState('');
  
  const isOwnerOrAdmin = (subOwnerSlot: Role) => {
    if (isPOClosedOrDone) return false;
    if (activeRole === 'Project Management') return true;
    return activeRole === subOwnerSlot;
  };

  const handleOpenAdd = () => {
    setNewTargetStart(milestoneStart || '');
    setNewTargetEnd(milestoneEnd || '');
    setIsAdding(true);
    setIsOpen(true);
  };
  
  const handleAdd = () => {
    if (!newTitle.trim()) return;
    if (newTargetStart && milestoneStart && newTargetStart < milestoneStart) {
      alert(`Target Start cannot be before milestone start (${milestoneStart})`);
      return;
    }
    if (newTargetEnd && milestoneEnd && newTargetEnd > milestoneEnd) {
      alert(`Target End cannot be after milestone end (${milestoneEnd})`);
      return;
    }
    if (newTargetStart && newTargetEnd && newTargetStart > newTargetEnd) {
      alert('Target Start cannot be after Target End');
      return;
    }

    addSubdivision({
      poId,
      productLineId,
      milestoneId,
      milestoneKey,
      title: newTitle.trim(),
      ownerLabel: activeRole,
      targetStart: newTargetStart || milestoneStart || undefined,
      targetEnd: newTargetEnd || milestoneEnd || undefined
    });
    setNewTitle('');
    setNewTargetStart('');
    setNewTargetEnd('');
    setIsAdding(false);
  };
  
  const handleSaveEdit = (sub: Subdivision) => {
    if (editTargetStart && milestoneStart && editTargetStart < milestoneStart) {
      alert(`Target Start cannot be before milestone start (${milestoneStart})`);
      return;
    }
    if (editTargetEnd && milestoneEnd && editTargetEnd > milestoneEnd) {
      alert(`Target End cannot be after milestone end (${milestoneEnd})`);
      return;
    }
    if (editTargetStart && editTargetEnd && editTargetStart > editTargetEnd) {
      alert('Target Start cannot be after Target End');
      return;
    }
    updateSubdivision({
      poId,
      productLineId,
      milestoneId,
      subdivisionId: sub.id,
      updates: {
        title: editTitle || sub.title,
        status: editStatus,
        targetStart: editTargetStart || undefined,
        targetEnd: editTargetEnd || undefined,
        delayCause: editStatus === 'Delayed' ? (editDelayCause as DelayCategory) : undefined,
        delayNote: editStatus === 'Delayed' ? editDelayNote : undefined,
        actualStart: editStatus !== 'Not Started' && !sub.actualStart ? new Date().toISOString().split('T')[0] : sub.actualStart,
        actualEnd: editStatus === 'Done' && !sub.actualEnd ? new Date().toISOString().split('T')[0] : (editStatus !== 'Done' ? undefined : sub.actualEnd)
      }
    });
    setEditingId(null);
  };

  return (
    <div className="mt-2 bg-slate-50/90 border border-slate-200 rounded-xl overflow-hidden text-xs shadow-2xs">
      <div className="bg-slate-100/90 px-3 py-2 flex items-center justify-between border-b border-slate-200/80">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="font-bold text-slate-700 flex items-center gap-1.5 hover:text-slate-900 cursor-pointer"
        >
          <CheckSquare className="w-3.5 h-3.5 text-emerald-700" />
          <span>Sub-Tasks ({subdivisions.length})</span>
          <span className="text-[10px] text-slate-400 font-mono">{isOpen ? '▲ Hide' : '▼ View / Manage'}</span>
        </button>

        {canManageSubtasks && (
          <button 
            type="button"
            onClick={handleOpenAdd}
            className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus className="w-3 h-3 text-emerald-600" /> Add Sub-Task
          </button>
        )}
      </div>

      {isOpen && (
        <div>
          {isAdding && (
            <div className="p-3 bg-white border-b border-slate-200 flex flex-col gap-2.5">
              <span className="text-[10px] font-bold text-slate-600 uppercase font-mono">Create New Sub-Task</span>
              <input 
                type="text" 
                autoFocus
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Confirm drawing specs & line items..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:border-emerald-600 bg-white"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-500">Target Range:</span>
                <input type="date" value={newTargetStart} onChange={e=>setNewTargetStart(e.target.value)} className="px-2.5 py-1 border border-slate-300 rounded text-xs font-mono bg-white" title={`Target Start (Window: ${milestoneStart} - ${milestoneEnd})`} />
                <span className="text-slate-400">to</span>
                <input type="date" value={newTargetEnd} onChange={e=>setNewTargetEnd(e.target.value)} className="px-2.5 py-1 border border-slate-300 rounded text-xs font-mono bg-white" title={`Target End (Window: ${milestoneStart} - ${milestoneEnd})`} />
                <div className="flex-1"></div>
                <button type="button" onClick={handleAdd} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-xs cursor-pointer shadow-2xs">Save Sub-Task</button>
                <button type="button" onClick={() => setIsAdding(false)} className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
          
          <div className="divide-y divide-slate-100">
            {subdivisions.length === 0 && !isAdding && (
              <div className="p-3 text-slate-400 italic text-center text-[11px]">No sub-tasks defined for this milestone stage.</div>
            )}
        {subdivisions.map(sub => {
          const isEditing = editingId === sub.id;
          const editable = isOwnerOrAdmin(sub.ownerSlot);
          
          if (isEditing) {
            return (
              <div key={sub.id} className="p-3 bg-white flex flex-col gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Title</label>
                  <input type="text" value={editTitle} onChange={e=>setEditTitle(e.target.value)} className="w-full border border-slate-300 px-2 py-1.5 rounded" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Target Dates</label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={editTargetStart} min={milestoneStart} max={milestoneEnd} onChange={e=>setEditTargetStart(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs w-full" title={`Target Start (Must be >= ${milestoneStart})`} />
                      <span className="text-slate-400">to</span>
                      <input type="date" value={editTargetEnd} min={milestoneStart} max={milestoneEnd} onChange={e=>setEditTargetEnd(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-xs w-full" title={`Target End (Must be <= ${milestoneEnd})`} />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value as any)} className="w-full border border-slate-300 px-2 py-1.5 rounded">
                      <option value="Not Started">Not Started</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Done">Done</option>
                      <option value="Delayed">Delayed</option>
                    </select>
                  </div>
                </div>
                
                {editStatus === 'Delayed' && (
                  <div className="bg-rose-50 p-3 rounded border border-rose-200 flex flex-col gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-rose-800 mb-1 uppercase">Delay Cause (Mandatory)</label>
                      <select value={editDelayCause} onChange={e => setEditDelayCause(e.target.value as any)} className="w-full border border-rose-300 px-2 py-1.5 rounded text-rose-900 bg-white">
                        <option value="">-- Select Cause --</option>
                        <option value="Customer">Customer</option>
                        <option value="Supplier">Supplier</option>
                        <option value="Design">Design</option>
                        <option value="Production">Production</option>
                        <option value="Internal">Internal</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-rose-800 mb-1 uppercase">Delay Notes</label>
                      <input type="text" value={editDelayNote} onChange={e=>setEditDelayNote(e.target.value)} placeholder="Provide context for the delay..." className="w-full border border-rose-300 px-2 py-1.5 rounded" />
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-slate-100 rounded text-slate-700 cursor-pointer hover:bg-slate-200">Cancel</button>
                  <button onClick={() => handleSaveEdit(sub)} disabled={editStatus === 'Delayed' && !editDelayCause} className="px-3 py-1.5 bg-emerald-700 text-white font-bold rounded cursor-pointer disabled:opacity-50">Save Changes</button>
                </div>
              </div>
            );
          }
          
          return (
            <div key={sub.id} className="p-3 bg-white flex flex-col gap-2 group hover:bg-slate-50/50">
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-2">
                  <div className={`w-3.5 h-3.5 mt-0.5 rounded-sm border flex items-center justify-center shrink-0 ${
                    sub.status === 'Done' ? 'bg-emerald-500 border-emerald-600 text-white' : 
                    sub.status === 'Delayed' ? 'bg-rose-500 border-rose-600 text-white' :
                    sub.status === 'In Progress' ? 'bg-amber-100 border-amber-400 text-amber-600' :
                    'bg-slate-100 border-slate-300'
                  }`}>
                    {sub.status === 'Done' && <CheckSquare className="w-2.5 h-2.5" />}
                    {sub.status === 'Delayed' && <AlertTriangle className="w-2.5 h-2.5" />}
                    {sub.status === 'In Progress' && <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
                  </div>
                  <div>
                    <div className={`font-semibold ${sub.status === 'Delayed' ? 'text-rose-900' : 'text-slate-700'}`}>{sub.title}</div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                      <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{sub.ownerSlot}</span>
                      <span>{sub.status}</span>
                      {sub.targetStart && <span>• Target: {sub.targetStart}{sub.targetEnd && ` to ${sub.targetEnd}`}</span>}
                      {sub.actualStart && <span>• Started: {sub.actualStart}</span>}
                    </div>
                  </div>
                </div>
                
                {editable && (
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                    <button 
                      onClick={() => {
                        setEditingId(sub.id);
                        setEditTitle(sub.title);
                        setEditStatus(sub.status);
                        setEditTargetStart(sub.targetStart || '');
                        setEditTargetEnd(sub.targetEnd || '');
                        setEditDelayCause(sub.delayCause || '');
                        setEditDelayNote(sub.delayNote || '');
                      }} 
                      className="p-1 hover:bg-slate-200 rounded text-slate-500 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm(`Delete sub-task "${sub.title}"?`)) {
                          deleteSubdivision({ poId, productLineId, milestoneId, subdivisionId: sub.id });
                        }
                      }} 
                      className="p-1 hover:bg-rose-100 rounded text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              
              {sub.status === 'Delayed' && (
                <div className="ml-5 p-2 bg-rose-50 border border-rose-100 rounded text-[10px] text-rose-800">
                  <span className="font-bold">Delay Cause ({sub.delayCause}):</span> {sub.delayNote || 'No notes provided.'}
                </div>
              )}
            </div>
          );
        })}
          </div>
        </div>
      )}
    </div>
  );
};

