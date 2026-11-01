import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface HeaderProps {
  onOpenTestsModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTestsModal: _onOpenTestsModal }) => {
  const { activeRole } = useApp();

  return (
    <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between text-slate-800 select-none z-20 shadow-xs">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center font-black text-white tracking-widest text-xs shadow-xs">
          CFT
        </div>
        <span className="font-black tracking-tight text-slate-900 text-lg">
          CIRCOR
        </span>
      </div>

      {/* Right Controls: Active Role Badge */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 bg-emerald-50/80 border border-emerald-200 rounded-lg px-3.5 py-1.5 text-emerald-900 shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Role:</span>
              <span className="text-xs font-bold text-emerald-950">{activeRole}</span>
            </div>
            <span className="text-[9px] text-emerald-700 font-mono leading-none mt-0.5">
              Role-Based Milestone Access
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

