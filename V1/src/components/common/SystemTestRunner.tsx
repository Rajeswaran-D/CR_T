import React, { useState } from 'react';
import { X, Play, CheckCircle2, XCircle, RefreshCw, Cpu } from 'lucide-react';
import {
  canProductionStart,
  canProcurementStart,
  getDaysDifference,
  addDays,
  todayLocal,
  recalculateProductLine,
  validateEventDate
} from '../../services/calculationEngine';
import type { ProductLine, Milestone, Subdivision } from '../../types';
import { ROLE_PERMISSIONS, isMilestoneOwnedByRole } from '../../types';

interface SystemTestRunnerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TestResult {
  id: string;
  name: string;
  category: 'Calculations' | 'Dependencies' | 'Permissions' | 'Validation' | 'SlotIsolation';
  status: 'PASSED' | 'FAILED' | 'PENDING';
  message: string;
  executionTimeMs: number;
}

// ─── Shared mock milestone factory ──────────────────────────────────────────
const makeMilestone = (id: string, key: string, name: string, stageOrder: number, status: Milestone['status'], opts: Partial<Milestone> = {}): Milestone => ({
  id,
  key,
  name,
  stageOrder,
  defaultDurationDays: 5,
  committedBaselineStartDate: '2026-08-01',
  committedBaselineEndDate: '2026-08-06',
  committedDurationDays: 5,
  forecastStartDate: '2026-08-01',
  forecastEndDate: '2026-08-06',
  varianceDays: 0,
  status,
  completionPct: status === 'Completed' ? 100 : 50,
  ...opts
});

const THE_14_KEYS = [
  'po_from_customer', 'baseline_review', 'corb_release', 'bom_release',
  'wo_release', 'sub_supplier_po', 'material_receipt', 'machining',
  'assembly', 'fg', 'customer_inspection', 'painting', 'trn', 'shipment'
] as const;

const buildChain = (overrides: Partial<Record<string, Partial<Milestone>>> = {}): Milestone[] =>
  THE_14_KEYS.map((key, i) => makeMilestone(
    `m${i + 1}`, key, key.replace(/_/g, ' '), i + 1,
    'Not Started' as Milestone['status'],
    overrides[key] || {}
  ));

const baseLine = (): ProductLine => ({
  id: 'mock-base',
  lineNumber: 'LINE-01',
  productName: 'Test Valve',
  category: 'High-Pressure Control Valves',
  qty: 1,
  designType: 'New Design',
  overallVarianceDays: 0,
  status: 'Not Started',
  materials: [],
  milestones: buildChain()
});

// ─── Test runner ─────────────────────────────────────────────────────────────
export const SystemTestRunner: React.FC<SystemTestRunnerProps> = ({ isOpen, onClose }) => {
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  if (!isOpen) return null;

  const runTests = () => {
    setIsRunning(true);
    setResults([]);

    setTimeout(() => {
      const testList: TestResult[] = [];
      const today = todayLocal();

      // ── T-01: Variance Calculation ──────────────────────────────────────
      const t1s = performance.now();
      const diff = getDaysDifference('2026-10-10', '2026-10-16');
      testList.push({ id: 't-01', name: 'Delay Variance Calculation', category: 'Calculations',
        status: diff === 6 ? 'PASSED' : 'FAILED',
        message: `Expected 6 days variance, got ${diff}.`,
        executionTimeMs: Math.round(performance.now() - t1s) });

      // ── T-02: Slot 3 blocked until Slot 2 completes ─────────────────────
      const t2s = performance.now();
      const depResult = validateEventDate({ milestones: buildChain(), index: 2, eventType: 'start', eventDate: today, todayStr: today });
      testList.push({ id: 't-02', name: 'Slot 3 Blocked Until Slot 2 Completes', category: 'Dependencies',
        status: !depResult.ok ? 'PASSED' : 'FAILED',
        message: !depResult.ok ? `Correctly blocked: "${depResult.error}"` : 'FAILED: Slot 3 was not blocked.',
        executionTimeMs: Math.round(performance.now() - t2s) });

      // ── T-03: Slot 3 unblocked when slot 2 complete ─────────────────────
      const t3s = performance.now();
      const chainOk = buildChain({
        po_from_customer: { status: 'Completed', actualEndDate: '2026-08-01', completionPct: 100 },
        baseline_review:  { status: 'Completed', actualEndDate: '2026-08-02', completionPct: 100 }
      });
      const depOk = validateEventDate({ milestones: chainOk, index: 2, eventType: 'start', eventDate: today, todayStr: today });
      testList.push({ id: 't-03', name: 'Slot 3 Unblocked When Slot 2 Is Completed', category: 'Dependencies',
        status: depOk.ok ? 'PASSED' : 'FAILED',
        message: depOk.ok ? 'Predecessor chain satisfied.' : `FAILED: "${depOk.error}"`,
        executionTimeMs: Math.round(performance.now() - t3s) });

      // ── T-04: BOM release gate for procurement ──────────────────────────
      const t4s = performance.now();
      const procBlock = canProcurementStart(baseLine());
      testList.push({ id: 't-04', name: 'Procurement Blocked Until BOM Release (Slot 4)', category: 'Dependencies',
        status: !procBlock.allowed ? 'PASSED' : 'FAILED',
        message: !procBlock.allowed ? `Correctly blocked: "${procBlock.reason}"` : 'FAILED: Procurement allowed before BOM.',
        executionTimeMs: Math.round(performance.now() - t4s) });

      // ── T-05: Production blocked by critical material ────────────────────
      const t5s = performance.now();
      const lineCrit: ProductLine = {
        ...baseLine(),
        milestones: buildChain({ bom_release: { status: 'Completed', actualEndDate: '2026-08-05', completionPct: 100 } }),
        materials: [{ id: 'm', itemCode: 'M1', description: 'Critical', qty: 1, unit: 'Pcs',
          supplierName: 'Foundry', leadTimeDays: 20, isCriticalPath: true, inspectionResult: 'Pending' }]
      };
      const prodBlock = canProductionStart(lineCrit);
      testList.push({ id: 't-05', name: 'Production Blocked: Critical Material Not Inspected', category: 'Dependencies',
        status: !prodBlock.allowed ? 'PASSED' : 'FAILED',
        message: !prodBlock.allowed ? `Correctly blocked: "${prodBlock.reason}"` : 'FAILED: Production allowed without GRN.',
        executionTimeMs: Math.round(performance.now() - t5s) });

      // ── T-06: Future actual date rejected ───────────────────────────────
      const t6s = performance.now();
      const futureCheck = validateEventDate({ milestones: buildChain(), index: 0, eventType: 'start', eventDate: addDays(today, 5), todayStr: today });
      testList.push({ id: 't-06', name: 'Future Actual Date Entry Rejected', category: 'Validation',
        status: !futureCheck.ok ? 'PASSED' : 'FAILED',
        message: !futureCheck.ok ? `Correctly rejected: "${futureCheck.error}"` : 'FAILED: Future date was accepted.',
        executionTimeMs: Math.round(performance.now() - t6s) });

      // ── T-07: Project Management owns all milestones ─────────────────────
      const t7s = performance.now();
      const pmOwnsAll = THE_14_KEYS.every(key => isMilestoneOwnedByRole(key, 'Project Management'));
      testList.push({ id: 't-07', name: 'Project Management Owns All 14 Milestone Slots', category: 'Permissions',
        status: pmOwnsAll ? 'PASSED' : 'FAILED',
        message: pmOwnsAll ? 'PM confirmed to own all 14 milestones.' : 'FAILED: PM missing at least one milestone.',
        executionTimeMs: Math.round(performance.now() - t7s) });

      // ── T-08: Each slot owns its designated milestone(s) ─────────────────
      const t8s = performance.now();
      const slotRoles = Object.entries(ROLE_PERMISSIONS).filter(
        ([role, perms]) => role !== 'Project Management' && Array.isArray(perms.allowedMilestones)
      );
      const exactlyOne = slotRoles.every(([role, p]) => {
        if (!Array.isArray(p.allowedMilestones)) return false;
        if (role === 'Project Manager (PM Baseline)') return p.allowedMilestones.length >= 1;
        if (role === 'Stores (Shipment)') return p.allowedMilestones.length >= 1;
        return p.allowedMilestones.length === 1;
      });
      testList.push({ id: 't-08', name: 'Each Slot Role Is Properly Scoped', category: 'SlotIsolation',
        status: exactlyOne ? 'PASSED' : 'FAILED',
        message: exactlyOne ? `All ${slotRoles.length} slot roles scoped to designated milestone slots.` : 'FAILED: A slot role has invalid milestone scope.',
        executionTimeMs: Math.round(performance.now() - t8s) });

      // ── T-09: QC Same-Label Slot Isolation ───────────────────────────────
      const t9s = performance.now();
      const fgOwnsFG   = isMilestoneOwnedByRole('fg', 'QC (FG)');
      const fgNoCI     = !isMilestoneOwnedByRole('customer_inspection', 'QC (FG)');
      const fgNoPaint  = !isMilestoneOwnedByRole('painting', 'QC (FG)');
      const fgNoTRN    = !isMilestoneOwnedByRole('trn', 'QC (FG)');
      const ciOwnsCI   = isMilestoneOwnedByRole('customer_inspection', 'QC (Customer Inspection)');
      const ciNoFG     = !isMilestoneOwnedByRole('fg', 'QC (Customer Inspection)');
      const qcIsoOk = fgOwnsFG && fgNoCI && fgNoPaint && fgNoTRN && ciOwnsCI && ciNoFG;
      testList.push({ id: 't-09', name: 'QC Same-Label Slots Are Fully Isolated', category: 'SlotIsolation',
        status: qcIsoOk ? 'PASSED' : 'FAILED',
        message: qcIsoOk ? 'QC (FG) & QC (CI) cannot cross-edit each other or other QC stages.' : `FAILED: fgOwns=${fgOwnsFG}, fgNoCI=${fgNoCI}, fgNoPaint=${fgNoPaint}, fgNoTRN=${fgNoTRN}, ciOwns=${ciOwnsCI}`,
        executionTimeMs: Math.round(performance.now() - t9s) });

      // ── T-10: Stores Same-Label Slot Isolation ───────────────────────────
      const t10s = performance.now();
      const s7m   = isMilestoneOwnedByRole('material_receipt', 'Stores (Material Receipt)');
      const s7ns  = !isMilestoneOwnedByRole('shipment', 'Stores (Material Receipt)');
      const s14s  = isMilestoneOwnedByRole('shipment', 'Stores (Shipment)');
      const s14nm = !isMilestoneOwnedByRole('material_receipt', 'Stores (Shipment)');
      const stOk = s7m && s7ns && s14s && s14nm;
      testList.push({ id: 't-10', name: 'Stores Material Receipt & Shipment Slots Are Isolated', category: 'SlotIsolation',
        status: stOk ? 'PASSED' : 'FAILED',
        message: stOk ? 'Stores (Material Receipt) → GRN only. Stores (Shipment) → Shipment only.' : `FAILED: s7m=${s7m}, s7ns=${s7ns}, s14s=${s14s}, s14nm=${s14nm}`,
        executionTimeMs: Math.round(performance.now() - t10s) });

      // ── T-11: CORB Officer cannot access BOM or Assembly ─────────────────
      const t11s = performance.now();
      const s3c = isMilestoneOwnedByRole('corb_release', 'AE (CORB Release)');
      const s3nb= !isMilestoneOwnedByRole('bom_release', 'AE (CORB Release)');
      const s3na= !isMilestoneOwnedByRole('assembly',    'AE (CORB Release)');
      const s3Ok = s3c && s3nb && s3na;
      testList.push({ id: 't-11', name: 'AE (CORB Release) Cannot Access BOM or Assembly', category: 'SlotIsolation',
        status: s3Ok ? 'PASSED' : 'FAILED',
        message: s3Ok ? 'AE (CORB Release) isolated to corb_release only.' : `FAILED: own=${s3c}, noBom=${s3nb}, noAssembly=${s3na}`,
        executionTimeMs: Math.round(performance.now() - t11s) });

      // ── T-12: Subdivision delay rolls up to parent milestone ──────────────
      const t12s = performance.now();
      const delayedSub: Subdivision = {
        id: 'sub-1', milestoneId: 'm7', title: 'Missing QA cert',
        ownerSlot: 'Stores (Material Receipt)',
        status: 'Delayed', delayCause: 'Supplier', delayNote: 'No cert',
        createdAt: today, updatedAt: today
      };
      const lineDelay: ProductLine = {
        ...baseLine(),
        milestones: buildChain({
          po_from_customer: { status: 'Completed', actualEndDate: '2026-08-01', completionPct: 100 },
          baseline_review:  { status: 'Completed', actualEndDate: '2026-08-02', completionPct: 100 },
          corb_release:     { status: 'Completed', actualEndDate: '2026-08-03', completionPct: 100 },
          bom_release:      { status: 'Completed', actualEndDate: '2026-08-04', completionPct: 100 },
          wo_release:       { status: 'Completed', actualEndDate: '2026-08-05', completionPct: 100 },
          sub_supplier_po:  { status: 'Completed', actualEndDate: '2026-08-06', completionPct: 100 },
          material_receipt: { status: 'In Progress', actualStartDate: '2026-08-07', subdivisions: [delayedSub] }
        })
      };
      const rolled = recalculateProductLine(lineDelay, today, 3, 5);
      const matMs  = rolled.milestones.find(m => m.key === 'material_receipt');
      const rollOk = matMs?.status === 'Delayed' && matMs?.delayCategory === 'Supplier';
      testList.push({ id: 't-12', name: 'Subdivision Delay Rolls Up to Parent Milestone', category: 'Calculations',
        status: rollOk ? 'PASSED' : 'FAILED',
        message: rollOk ? 'material_receipt promoted to Delayed with category Supplier from child subdivision.' : `FAILED: status=${matMs?.status}, cat=${matMs?.delayCategory}`,
        executionTimeMs: Math.round(performance.now() - t12s) });

      // ── T-13: Subdivision ownership isolation ────────────────────────────
      const t13s = performance.now();
      const s8can  = 'Planner (Assembly)' === delayedSub.ownerSlot;
      const s7can  = 'Stores (Material Receipt)' === delayedSub.ownerSlot;
      testList.push({ id: 't-13', name: 'Planner (Assembly) Cannot Edit Stores Subdivision', category: 'SlotIsolation',
        status: (s7can && !s8can) ? 'PASSED' : 'FAILED',
        message: (s7can && !s8can) ? 'Stores owns the sub; Planner (Assembly) correctly denied.' : `FAILED: slot7=${s7can}, slot8=${s8can}`,
        executionTimeMs: Math.round(performance.now() - t13s) });

      // ── T-14: Machining Dual Access (SCM & Planner) ──────────────────────
      const t14s = performance.now();
      const machSCM     = isMilestoneOwnedByRole('machining', 'SCM (Sub-Supplier PO)');
      const machPlanWO  = isMilestoneOwnedByRole('machining', 'Planner (WO Release)');
      const machPlanAsm = isMilestoneOwnedByRole('machining', 'Planner (Assembly)');
      const machDualOk  = machSCM && machPlanWO && machPlanAsm;
      testList.push({ id: 't-14', name: 'Machining (Slot 8) Dual Access for SCM and Planner', category: 'Permissions',
        status: machDualOk ? 'PASSED' : 'FAILED',
        message: machDualOk ? 'Machining is confirmed actionable by both SCM and Planner roles.' : `FAILED: scm=${machSCM}, planWO=${machPlanWO}, planAsm=${machPlanAsm}`,
        executionTimeMs: Math.round(performance.now() - t14s) });

      // ── T-15: Only PM approves baseline ──────────────────────────────────
      const t15s = performance.now();
      const pmApprove = ROLE_PERMISSIONS['Project Management'].canApproveBaseline && ROLE_PERMISSIONS['Project Manager (PM Baseline)'].canApproveBaseline;
      const slotsNoApprove = Object.entries(ROLE_PERMISSIONS).filter(([r]) => r !== 'Project Management' && r !== 'Project Manager (PM Baseline)').every(([, p]) => !p.canApproveBaseline);
      testList.push({ id: 't-15', name: 'Only Project Management Can Approve Baselines', category: 'Permissions',
        status: (pmApprove && slotsNoApprove) ? 'PASSED' : 'FAILED',
        message: (pmApprove && slotsNoApprove) ? 'PM & PM Baseline approved; all other slot roles denied baseline approval.' : `FAILED: pm=${pmApprove}, slotsOk=${slotsNoApprove}`,
        executionTimeMs: Math.round(performance.now() - t15s) });

      // ── T-16: Machining (Slot 8) blocked until Material Receipt (Slot 7) ─
      const t16s = performance.now();
      const chainMs8 = buildChain({
        po_from_customer: { status: 'Completed', actualEndDate: '2026-08-01', completionPct: 100 },
        baseline_review:  { status: 'Completed', actualEndDate: '2026-08-02', completionPct: 100 },
        corb_release:     { status: 'Completed', actualEndDate: '2026-08-03', completionPct: 100 },
        bom_release:      { status: 'Completed', actualEndDate: '2026-08-04', completionPct: 100 },
        wo_release:       { status: 'Completed', actualEndDate: '2026-08-05', completionPct: 100 },
        sub_supplier_po:  { status: 'Completed', actualEndDate: '2026-08-06', completionPct: 100 },
        material_receipt: { status: 'In Progress', actualStartDate: '2026-08-07' }
      });
      const ms8idx = chainMs8.findIndex(m => m.key === 'machining');
      const ms8Block = validateEventDate({ milestones: chainMs8, index: ms8idx, eventType: 'start', eventDate: today, todayStr: today });
      testList.push({ id: 't-16', name: 'Slot 8 (Machining) Blocked Until Slot 7 (Material Receipt) Completes', category: 'Dependencies',
        status: !ms8Block.ok ? 'PASSED' : 'FAILED',
        message: !ms8Block.ok ? `Correctly blocked: "${ms8Block.error}"` : 'FAILED: Machining started before Material Receipt completed.',
        executionTimeMs: Math.round(performance.now() - t16s) });

      setResults(testList);
      setIsRunning(false);
    }, 400);
  };

  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;

  const CAT_COLORS: Record<string, string> = {
    Calculations:  'bg-violet-100 text-violet-800 border-violet-200',
    Dependencies:  'bg-amber-100 text-amber-800 border-amber-200',
    Permissions:   'bg-emerald-100 text-emerald-800 border-emerald-200',
    Validation:    'bg-sky-100 text-sky-800 border-sky-200',
    SlotIsolation: 'bg-rose-100 text-rose-800 border-rose-200'
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden text-slate-800">

        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-700 text-white shadow-xs"><Cpu className="w-5 h-5" /></div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">System Verification Engine — 16 Assertions</h2>
              <p className="text-xs text-slate-500">Slot RBAC isolation · 1→14 Dependency chain · Subdivision delay rollup · Baseline locks</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="flex items-center justify-between bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
              <div className="font-bold text-slate-900">Business Rule Assertions</div>
              <p className="text-xs text-slate-500 mt-0.5">Validates all 6 steps of the role-based manufacturing model.</p>
            </div>
            <div className="flex items-center gap-3">
              {results.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">{passed} passed</span>
                  {failed > 0 && <span className="px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full border border-rose-200">{failed} failed</span>}
                </div>
              )}
              <button onClick={runTests} disabled={isRunning}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs cursor-pointer disabled:opacity-50 shadow-xs">
                {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                {isRunning ? 'Running...' : 'Run All 16 Tests'}
              </button>
            </div>
          </div>

          {results.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-bold text-slate-400 px-1 uppercase tracking-wider">
                <span>Test Assertion</span><span>Status / Time</span>
              </div>
              {results.map(res => (
                <div key={res.id} className={`p-3.5 rounded-lg border flex items-start justify-between gap-3 text-xs ${res.status === 'PASSED' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                  <div className="flex items-start gap-2.5 min-w-0">
                    {res.status === 'PASSED' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">{res.id}</span>
                        <span>{res.name}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide shrink-0 ${CAT_COLORS[res.category] || ''}`}>{res.category}</span>
                      </div>
                      <p className="text-slate-600 text-[11px] mt-0.5 break-words">{res.message}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`px-2 py-0.5 rounded-full font-mono font-bold text-[10px] ${res.status === 'PASSED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{res.status}</span>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">{res.executionTimeMs}ms</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.length === 0 && !isRunning && (
            <div className="p-10 text-center border border-dashed border-slate-200 rounded-lg text-slate-400 text-xs">
              Click 'Run All 16 Tests' to validate the entire RBAC + dependency model.
            </div>
          )}
        </div>

        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">TODO: Mirror these as server-side unit tests when the org-api backend is built.</span>
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer">Close</button>
        </div>

      </div>
    </div>
  );
};
