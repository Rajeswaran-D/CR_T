import React from 'react';
import { 
  LayoutDashboard, 
  FilePlus2, 
  Package,
  PackageCheck, 
  Factory, 
  Truck,
  ChevronDown,
  ShieldCheck,
  Settings
} from 'lucide-react';
import type { Role } from '../../types';
import { useApp } from '../../context/AppContext';

export type ModuleType = 
  | 'Dashboard' 
  | 'Administration & Governance'
  | '1. Customer Purchase Order (PO)'
  | '2. Baseline Review & Planning'
  | '3. CORB Release'
  | '4. BOM Release'
  | '5. Work Order (WO) Release'
  | '6. Sub-Supplier PO'
  | '7. Material Incoming Receipt'
  | '8. Machining & Fabrication'
  | '9. Assembly'
  | '10. Finished Goods (FG)'
  | '11. Customer Inspection'
  | '12. Painting'
  | '13. TRN'
  | '14. Final Shipment & Dispatch'
  | 'Product Catalog';

interface SidebarProps {
  activeModule: ModuleType;
  setActiveModule: (module: ModuleType) => void;
  delayedCount: number;
  atRiskCount: number;
  delayedSummary?: string;
}

const ALL_ROLES: Role[] = [
  'Project Management',
  'Sales / AE (Customer PO)',
  'Project Manager (PM Baseline)',
  'AE (CORB Release)',
  'DE (BOM Release)',
  'Planner (WO Release)',
  'SCM (Sub-Supplier PO)',
  'Stores (Material Receipt)',
  'SCM / Planner (Machining)',
  'Planner (Assembly)',
  'QC (FG)',
  'QC (Customer Inspection)',
  'QC (Painting)',
  'QC (TRN)',
  'Stores (Shipment)'
];

// Role → badge color classes
const ROLE_BADGE: Record<Role, string> = {
  'Project Management':           'bg-emerald-100 text-emerald-800 border-emerald-300',
  'Sales / AE (Customer PO)':     'bg-blue-100 text-blue-800 border-blue-300',
  'Project Manager (PM Baseline)':'bg-cyan-100 text-cyan-800 border-cyan-300',
  'AE (CORB Release)':            'bg-teal-100 text-teal-800 border-teal-300',
  'DE (BOM Release)':             'bg-indigo-100 text-indigo-800 border-indigo-300',
  'Planner (WO Release)':         'bg-violet-100 text-violet-800 border-violet-300',
  'SCM (Sub-Supplier PO)':        'bg-amber-100 text-amber-800 border-amber-300',
  'Stores (Material Receipt)':    'bg-yellow-100 text-yellow-800 border-yellow-300',
  'SCM / Planner (Machining)':    'bg-orange-100 text-orange-800 border-orange-300',
  'Planner (Assembly)':           'bg-purple-100 text-purple-800 border-purple-300',
  'QC (FG)':                      'bg-rose-100 text-rose-800 border-rose-300',
  'QC (Customer Inspection)':     'bg-pink-100 text-pink-800 border-pink-300',
  'QC (Painting)':                'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
  'QC (TRN)':                     'bg-red-100 text-red-800 border-red-300',
  'Stores (Shipment)':            'bg-sky-100 text-sky-800 border-sky-300'
};

const ROLE_RESPONSIBLE_MODULE: Record<Role, ModuleType> = {
  'Project Management':           'Administration & Governance',
  'Sales / AE (Customer PO)':     '1. Customer Purchase Order (PO)',
  'Project Manager (PM Baseline)':'2. Baseline Review & Planning',
  'AE (CORB Release)':            '3. CORB Release',
  'DE (BOM Release)':             '4. BOM Release',
  'Planner (WO Release)':         '5. Work Order (WO) Release',
  'SCM (Sub-Supplier PO)':        '6. Sub-Supplier PO',
  'Stores (Material Receipt)':    '7. Material Incoming Receipt',
  'SCM / Planner (Machining)':    '8. Machining & Fabrication',
  'Planner (Assembly)':           '9. Assembly',
  'QC (FG)':                      '10. Finished Goods (FG)',
  'QC (Customer Inspection)':     '11. Customer Inspection',
  'QC (Painting)':                '12. Painting',
  'QC (TRN)':                     '13. TRN',
  'Stores (Shipment)':            '14. Final Shipment & Dispatch'
};

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeModule, 
  setActiveModule,
  delayedCount,
  delayedSummary
}) => {
  const { activeRole, setActiveRole } = useApp();
  const [roleOpen, setRoleOpen] = React.useState(false);

  const allNavItems: { name: ModuleType; icon: React.ReactNode; badge?: number; badgeColor?: string; step: string }[] = [
    { name: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, step: '1' },
    { name: 'Administration & Governance', icon: <Settings className="w-4 h-4" />, step: 'ADM' },
    { name: '1. Customer Purchase Order (PO)', icon: <FilePlus2 className="w-4 h-4" />, step: '2' },
    { name: '2. Baseline Review & Planning', icon: <FilePlus2 className="w-4 h-4" />, step: '3' },
    { name: '3. CORB Release', icon: <FilePlus2 className="w-4 h-4" />, step: '4' },
    { name: '4. BOM Release', icon: <FilePlus2 className="w-4 h-4" />, step: '5' },
    { name: '5. Work Order (WO) Release', icon: <Factory className="w-4 h-4" />, step: '6' },
    { name: '6. Sub-Supplier PO', icon: <PackageCheck className="w-4 h-4" />, step: '7' },
    { name: '7. Material Incoming Receipt', icon: <PackageCheck className="w-4 h-4" />, step: '8' },
    { name: '8. Machining & Fabrication', icon: <Factory className="w-4 h-4" />, step: '9' },
    { name: '9. Assembly', icon: <Factory className="w-4 h-4" />, step: '10' },
    { name: '10. Finished Goods (FG)', icon: <Factory className="w-4 h-4" />, step: '11' },
    { name: '11. Customer Inspection', icon: <Factory className="w-4 h-4" />, step: '12' },
    { name: '12. Painting', icon: <Factory className="w-4 h-4" />, step: '13' },
    { name: '13. TRN', icon: <Factory className="w-4 h-4" />, step: '14' },
    { 
      name: '14. Final Shipment & Dispatch', 
      icon: <Truck className="w-4 h-4" />, 
      step: '15',
      badge: delayedCount > 0 ? delayedCount : undefined,
      badgeColor: 'bg-rose-100 border-rose-300 text-rose-800'
    },
    { name: 'Product Catalog', icon: <Package className="w-4 h-4" />, step: '16' }
  ];

  const allowedModule = ROLE_RESPONSIBLE_MODULE[activeRole];

  const navItems = allNavItems.filter((item) => {
    if (item.name === 'Dashboard') return true;
    return item.name === allowedModule;
  });

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between select-none text-slate-700 shadow-xs">
      {/* Module Navigation List */}
      <div className="py-4 px-3 space-y-2">
        <div className="px-3 pb-2 text-[10px] font-bold text-slate-400 tracking-wider uppercase flex items-center justify-between">
          <span>Manufacturing Pipeline</span>
          <span className="text-emerald-700 font-mono">{navItems.length} {navItems.length === 1 ? 'MODULE' : 'MODULES'}</span>
        </div>

        {navItems.map((item) => {
          const isActive = activeModule === item.name;
          return (
            <button
              key={item.name}
              onClick={() => setActiveModule(item.name)}
              title={item.name === '14. Final Shipment & Dispatch' && delayedSummary ? delayedSummary : undefined}
              className={`w-full flex items-center justify-between px-3.5 py-3 text-xs rounded-xl transition-all text-left cursor-pointer ${
                isActive 
                  ? 'bg-emerald-50/90 text-emerald-900 font-bold border-l-4 border-emerald-600 shadow-xs' 
                  : 'hover:bg-slate-50 text-slate-600 hover:text-slate-900 border-l-4 border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center font-mono ${
                  isActive ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {item.step}
                </div>
                <span className={isActive ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span className="text-xs">{item.name}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border font-semibold ${item.badgeColor || 'bg-slate-100 text-slate-600'}`}>
                  {item.badge} delayed
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Role Switcher — dev convenience; TODO: replace with authenticated session in org-api adapter */}
      <div className="px-3 pb-3">
        <div className="relative">
          <button
            onClick={() => setRoleOpen(o => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-0.5">Active Role</p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ROLE_BADGE[activeRole]} truncate max-w-[140px]`}>
                  {activeRole}
                </span>
              </div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${roleOpen ? 'rotate-180' : ''}`} />
          </button>

          {roleOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50 max-h-64 overflow-y-auto">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-1.5 pb-1">
                Switch Role (Dev Mode)
              </p>
              {ALL_ROLES.map(role => (
                <button
                  key={role}
                  onClick={() => { setActiveRole(role); setRoleOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-2 ${
                    activeRole === role ? 'font-bold text-emerald-800' : 'text-slate-700'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeRole === role ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {role}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Info / Operator Mode */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/70 text-[11px] text-slate-500 space-y-2">
        <div className="flex justify-between items-center text-[10px] font-mono">
          <span>PLANT SITE:</span>
          <span className="text-slate-800 font-bold">CIRCOR PLANT 01</span>
        </div>
        <div className="flex justify-between items-center text-[10px] font-mono">
          <span>OPERATOR MODE:</span>
          <span className="text-emerald-700 font-bold">ACTIVE</span>
        </div>
        <div className="pt-2 text-[10px] text-slate-500 border-t border-slate-200 leading-tight">
          Seamless 6-step order, catalog & manufacturing flow.
        </div>
      </div>
    </aside>
  );
};
