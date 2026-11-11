import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Clock,
  Award,
  Download,
  DollarSign,
  Search,
  Lightbulb,
  Package,
  Eye,
  CheckCheck,
  CheckCircle2,
  BarChart2,
  PieChart,
  Layers,
  X,
  FileText
} from 'lucide-react';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import { getDaysDifference } from '../../services/calculationEngine';
import { extractDelayFlow } from '../common/DelayAnalysisFlow';
import type { PurchaseOrder, Role } from '../../types';

interface YearlyCompletedOrdersReportProps {
  onSelectPO?: (po: PurchaseOrder) => void;
}

interface StageBottleneckItem {
  stageKey: string;
  stageName: string;
  stageOrder: number;
  totalDelayDays: number;
  ordersCount: number;
  sharePct: number;
  rootCause: string;
}

interface ManufacturingStageDef {
  key: string;
  order: number;
  name: string;
  category: string;
  primaryCause: string;
  improvementTip: string;
  responsibleRole: Role;
}

// Shared shape for per-stage delay aggregation (empty state, real state, and all consumers).
interface StageDelayStat {
  stageKey: string;
  stageName: string;
  stageOrder: number;
  category: string;
  responsibleRole: Role;
  totalDays: number;
  orders: number;
  reasons: string[];
  impactedPOs: Array<{
    poNumber: string;
    customerName: string;
    delayDays: number;
    reason?: string;
  }>;
}

const CIRCOR_STANDARD_STAGES: ManufacturingStageDef[] = [
  {
    key: 'po_from_customer',
    order: 1,
    name: '1. Customer Purchase Order (PO)',
    category: 'Commercial',
    primaryCause: 'Clarifications on technical specs, commercial terms, or customer hold',
    improvementTip: 'Use a standard intake checklist and freeze specs within 2 days of PO receipt',
    responsibleRole: 'Sales / AE (Customer PO)'
  },
  {
    key: 'corb_release',
    order: 2,
    name: '2. CORB Release',
    category: 'Engineering',
    primaryCause: 'Multi-party design sign-off bottlenecks and customer review holds',
    improvementTip: 'Set a mandatory 3-day approval window for standard design valve configurations',
    responsibleRole: 'AE (CORB Release)'
  },
  {
    key: 'pm_baseline',
    order: 3,
    name: '3. Baseline Review & Planning',
    category: 'Planning',
    primaryCause: 'Delayed schedule alignment across production and procurement slots',
    improvementTip: 'Apply standard schedule templates with pre-set buffer days',
    responsibleRole: 'Project Manager (PM Baseline)'
  },
  {
    key: 'bom_release',
    order: 4,
    name: '4. BOM Release',
    category: 'Design',
    primaryCause: 'Drawing revisions or delayed part numbering assignment',
    improvementTip: 'Pre-release long-lead material lists 10 days before locking final CAD drawings',
    responsibleRole: 'DE (BOM Release)'
  },
  {
    key: 'wo_release',
    order: 5,
    name: '5. Work Order (WO) Release',
    category: 'Planning',
    primaryCause: 'Shop-floor routing delays or machine slot reservation holds',
    improvementTip: 'Trigger automated ERP work orders as soon as the BOM is signed off',
    responsibleRole: 'Planner (WO Release)'
  },
  {
    key: 'sub_supplier_po',
    order: 6,
    name: '6. Sub-Supplier PO',
    category: 'Purchasing',
    primaryCause: 'Quote negotiations with suppliers and purchase approval cycles',
    improvementTip: 'Pre-agree annual rate contracts with approved suppliers to place orders immediately',
    responsibleRole: 'SCM (Sub-Supplier PO)'
  },
  {
    key: 'material_receipt',
    order: 7,
    name: '7. Material Receipt (GRN)',
    category: 'Supplier',
    primaryCause: 'Suppliers took longer to deliver raw metals and test certificates',
    improvementTip: 'Add extra lead-time buffer to planned schedule and order raw metals earlier',
    responsibleRole: 'Stores (Material Receipt)'
  },
  {
    key: 'machining',
    order: 8,
    name: '8. Machining & Fabrication',
    category: 'Production',
    primaryCause: 'Cutting machines got backed up when multiple batches arrived together',
    improvementTip: 'Prepare tools in advance and send extra work to backup workshops',
    responsibleRole: 'SCM / Planner (Machining)'
  },
  {
    key: 'assembly',
    order: 9,
    name: '9. Assembly',
    category: 'Production',
    primaryCause: 'Missing small parts, seal rings, or test bench availability hold',
    improvementTip: 'Kit all parts and seals together 2 days before assembly begins',
    responsibleRole: 'Planner (Assembly)'
  },
  {
    key: 'fg',
    order: 10,
    name: '10. Finished Goods (FG)',
    category: 'Quality',
    primaryCause: 'Internal quality inspection queue and test pressure chart verification',
    improvementTip: 'Perform in-process QC inspection concurrently instead of batching at the end',
    responsibleRole: 'QC (FG)'
  },
  {
    key: 'customer_inspection',
    order: 11,
    name: '11. Customer Inspection',
    category: 'Customer',
    primaryCause: 'Waiting for client officers to visit and inspect the finished valves',
    improvementTip: 'Invite inspectors 10 days earlier and agree on automatic sign-off after 5 days',
    responsibleRole: 'QC (Customer Inspection)'
  },
  {
    key: 'painting',
    order: 12,
    name: '12. Painting',
    category: 'Production',
    primaryCause: 'Paint booth backlog or paint drying time in humid weather',
    improvementTip: 'Batch paint orders by color specification and use forced-air drying heaters',
    responsibleRole: 'QC (Painting)'
  },
  {
    key: 'trn',
    order: 13,
    name: '13. TRN',
    category: 'Documentation',
    primaryCause: 'Compiling manufacturer test certificates and inspection dossiers',
    improvementTip: 'Digitally compile test documents in real time at each stage instead of at the end',
    responsibleRole: 'QC (TRN)'
  },
  {
    key: 'shipment',
    order: 14,
    name: '14. Final Shipment & Dispatch',
    category: 'Dispatch',
    primaryCause: 'Custom export crating delays, customs clearance, or freight booking',
    improvementTip: 'Pre-book shipping containers and build wooden export crates during painting',
    responsibleRole: 'Stores (Shipment)'
  }
];

// USD Currency Formatter: standard international grouping ($10,015,000 instead of Indian commas)
export const formatUSD = (val: number): string => {
  if (typeof val !== 'number' || isNaN(val)) return '$0';
  return '$' + Math.round(val).toLocaleString('en-US');
};

export const formatUSDExact = (val: number): string => {
  if (typeof val !== 'number' || isNaN(val)) return '$0';
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Small ▲/▼ chip comparing the selected year against the previous year
const DeltaChip: React.FC<{
  current: number;
  previous: number | null;
  unit: string;
  goodDirection: 'up' | 'down';
  prevYear: number;
  money?: boolean;
}> = ({ current, previous, unit, goodDirection, prevYear, money }) => {
  if (previous === null || previous === undefined) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) {
    return <span className="text-[10px] font-mono text-slate-400 mt-1 inline-block">→ flat vs {prevYear}</span>;
  }
  const isGood = goodDirection === 'up' ? diff > 0 : diff < 0;
  const abs = Math.abs(diff);
  const formatted = money ? formatUSD(abs) : `${abs}${unit}`;
  return (
    <span className={`text-[10px] font-mono font-bold mt-1 inline-block px-1.5 py-0.5 rounded-full border ${
      isGood ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
    }`}>
      {diff > 0 ? '▲' : '▼'} {formatted} vs {prevYear}
    </span>
  );
};

export const YearlyCompletedOrdersReport: React.FC<YearlyCompletedOrdersReportProps> = ({ onSelectPO }) => {
  const { purchaseOrders } = useApp();

  // Filter completed / closed orders only
  const completedOrders = useMemo(() => {
    return purchaseOrders.filter(po => 
      (po.status === 'Completed' || po.isClosed) && 
      !po.isCancelled && 
      po.status !== 'Cancelled'
    );
  }, [purchaseOrders]);

  // Extract completion date helper
  const getCompletionDate = (po: PurchaseOrder): string => {
    if (po.actualDeliveryDate) return po.actualDeliveryDate;
    
    // Milestone 14 (Shipment / Dispatch)
    for (const line of po.productLines || []) {
      const msList = line.milestones || [];
      const shipmentMs = msList.find(m => 
        m.key === 'shipment' || m.key === 'dispatch' || m.key === 'delivery' || m.stageOrder === 14
      );
      if (shipmentMs?.actualEndDate) return shipmentMs.actualEndDate;
    }

    // Last completed milestone
    for (const line of po.productLines || []) {
      const completedMsList = (line.milestones || []).filter(m => m.status === 'Completed' || Boolean(m.actualEndDate));
      if (completedMsList.length > 0) {
        const last = completedMsList[completedMsList.length - 1];
        if (last.actualEndDate) return last.actualEndDate;
      }
    }

    return po.revisedDeliveryDate || po.committedDeliveryDate || po.poDate;
  };

  // Helper to extract order start date
  const getOrderStartDate = (po: PurchaseOrder): string => {
    if (po.startDate) return po.startDate;
    if (po.poDate) return po.poDate;

    // First milestone start date
    for (const line of po.productLines || []) {
      const msList = line.milestones || [];
      const ms1 = msList.find(m => m.stageOrder === 1 || m.key === 'po_from_customer');
      if (ms1?.actualStartDate) return ms1.actualStartDate;
      if (ms1?.committedBaselineStartDate) return ms1.committedBaselineStartDate;
      if (msList[0]?.actualStartDate) return msList[0].actualStartDate;
      if (msList[0]?.committedBaselineStartDate) return msList[0].committedBaselineStartDate;
    }

    return po.createdAt ? po.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  };

  // Group year-wise orders strictly by start date
  const getOrderStartYear = (po: PurchaseOrder): number => {
    const sStr = getOrderStartDate(po);
    if (sStr && sStr.length >= 4) {
      const parsed = parseInt(sStr.slice(0, 4), 10);
      if (!isNaN(parsed) && parsed >= 2000 && parsed <= 2099) {
        return parsed;
      }
    }
    return new Date().getFullYear();
  };

  // Alias for backward compatibility
  const getCompletionYear = getOrderStartYear;

  // Directly use the order's current approved baseline and delay logs as they are
  const getPOEffectiveDelay = (po: PurchaseOrder): number => {
    const compDate = getCompletionDate(po);
    const currentBaseline = po.revisedDeliveryDate || po.committedDeliveryDate;
    const currentBaselineDiff = (currentBaseline && compDate && compDate > currentBaseline)
      ? getDaysDifference(currentBaseline, compDate)
      : 0;
    const delayLog = extractDelayFlow(po);
    const summary = getPOManufacturingStatus(po);

    // If delivered on or before the current baseline and delay logs show no net delay:
    if (currentBaseline && compDate && compDate <= currentBaseline && delayLog.netVarianceDays <= 0) {
      return 0;
    }

    return Math.max(0, delayLog.netVarianceDays, currentBaselineDiff, summary.delayDays);
  };

  // Recovered delay days directly from the order's milestone delay logs
  const getPORecoveredDays = (po: PurchaseOrder): number => {
    const delayLog = extractDelayFlow(po);
    return delayLog.totalDaysRecovered;
  };

  // Extract bottleneck stage directly from the order's delay logs as it is
  const getPOBottleneckInfo = (po: PurchaseOrder) => {
    const effDelay = getPOEffectiveDelay(po);
    const delayLog = extractDelayFlow(po);
    const recDays = delayLog.totalDaysRecovered;
    const summary = getPOManufacturingStatus(po);

    if (effDelay <= 0 && recDays <= 0 && !delayLog.hasDelays && !delayLog.hasHistoricalDelays) {
      return {
        stageName: '—',
        delayDays: 0,
        hasBottleneck: false,
        isDelayed: false,
        isResolved: false
      };
    }

    // Use root delay step directly from the order's delay logs as it is
    const rootStep = delayLog.rootDelayStep;
    let bottleneckStage = rootStep?.stageName || summary.delayedStageName;
    let stageReason = rootStep?.delayReason || summary.delayReason;

    if (!bottleneckStage && effDelay > 0) {
      bottleneckStage = '14. Final Shipment & Dispatch';
    }

    if (bottleneckStage) {
      const matched = CIRCOR_STANDARD_STAGES.find(s =>
        bottleneckStage?.toLowerCase().includes(s.name.toLowerCase()) ||
        bottleneckStage?.toLowerCase().includes(s.key.toLowerCase()) ||
        s.name.toLowerCase().includes(bottleneckStage?.toLowerCase() || '')
      );
      if (matched) bottleneckStage = matched.name;
    }

    const delayDays = effDelay > 0
      ? effDelay
      : (rootStep?.stageDelayAdded && rootStep.stageDelayAdded > 0 ? rootStep.stageDelayAdded : (recDays || 1));

    return {
      stageName: bottleneckStage || '7. Material Receipt (GRN)',
      delayDays: delayDays || 1,
      reason: stageReason,
      hasBottleneck: true,
      isDelayed: effDelay > 0,
      isResolved: effDelay <= 0 && (recDays > 0 || delayLog.isRecovered)
    };
  };

  // Lightweight per-order-set stats used for the YoY trend + delta chips
  // (OTIF / avg-delay use the same definitions as the main metrics)
  const computeSimpleStats = (orders: PurchaseOrder[]) => {
    let booked = 0, onTime = 0, delayed = 0, delaySum = 0;
    orders.forEach(po => {
      booked += typeof po.bookedAmount === 'number' && !isNaN(po.bookedAmount) ? po.bookedAmount : 0;
      const d = getPOEffectiveDelay(po);
      delaySum += d;
      if (d <= 0) onTime++; else delayed++;
    });
    return {
      totalOrders: orders.length,
      totalBooked: booked,
      otif: orders.length > 0 ? Math.round((onTime / orders.length) * 100) : 100,
      avgDelay: delayed > 0 ? Math.round((delaySum / delayed) * 10) / 10 : 0
    };
  };

  // Distinct years present in data
  const availableYears = useMemo(() => {
    const yearSet = new Set<number>();
    completedOrders.forEach(po => yearSet.add(getCompletionYear(po)));
    const sorted = Array.from(yearSet).sort((a, b) => b - a);
    return sorted.length > 0 ? sorted : [new Date().getFullYear()];
  }, [completedOrders]);

  const [selectedYear, setSelectedYear] = useState<number | 'ALL'>('ALL');
  const [activeReportTab, setActiveReportTab] = useState<'all' | 'performance' | 'bottlenecks' | 'orders'>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ON_TIME' | 'DELAYED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionViewMode, setActionViewMode] = useState<'matrix' | 'cards'>('matrix');
  const [stageSearch, setStageSearch] = useState('');
  const [previewPO, setPreviewPO] = useState<PurchaseOrder | null>(null);

  // Orders for chosen year
  const yearOrders = useMemo(() => {
    if (selectedYear === 'ALL') return completedOrders;
    return completedOrders.filter(po => getCompletionYear(po) === selectedYear);
  }, [completedOrders, selectedYear]);

  // Year-over-Year trend stats (chronological)
  const yearlyStats = useMemo(() => {
    return [...availableYears].sort((a, b) => a - b).map(year => ({
      year,
      ...computeSimpleStats(completedOrders.filter(po => getCompletionYear(po) === year))
    }));
  }, [completedOrders, availableYears]);

  // Previous-year stats for KPI delta chips (availableYears is sorted desc → next entry is the prior year)
  const prevYearStats = useMemo(() => {
    if (selectedYear === 'ALL') return null;
    const prevYear = availableYears[availableYears.indexOf(selectedYear) + 1];
    if (prevYear === undefined) return null;
    return { year: prevYear, ...computeSimpleStats(completedOrders.filter(po => getCompletionYear(po) === prevYear)) };
  }, [selectedYear, availableYears, completedOrders]);

  // Booked value delivered late in the current scope (for the verdict banner)
  const lateBookedValue = useMemo(() => yearOrders.reduce((sum, po) => {
    const amt = typeof po.bookedAmount === 'number' && !isNaN(po.bookedAmount) ? po.bookedAmount : 0;
    return sum + (getPOEffectiveDelay(po) > 0 ? amt : 0);
  }, 0), [yearOrders]);

  // On-time orders that had mid-flow delays which were resolved before delivery
  const recoveredStats = useMemo(() => {
    let count = 0;
    let days = 0;
    yearOrders.forEach(po => {
      if (getPOEffectiveDelay(po) > 0) return;
      const rec = getPORecoveredDays(po);
      if (rec > 0) { count++; days += rec; }
    });
    return { count, days };
  }, [yearOrders]);

  // Executive metrics calculation
  const metrics = useMemo(() => {
    const totalOrders = yearOrders.length;
    if (totalOrders === 0) {
      return {
        totalOrders: 0,
        totalBookedAmount: 0,
        avgOrderValue: 0,
        onTimeCount: 0,
        delayedCount: 0,
        otifRate: 100,
        avgDelay: 0,
        maxDelay: 0,
        totalDelayDays: 0,
        totalUnits: 0,
        topBottlenecks: [] as StageBottleneckItem[],
        supplierDelayDays: 0,
        productionDelayDays: 0,
        customerDelayDays: 0,
        engineeringDelayDays: 0,
        stageDelayMap: {} as Record<string, StageDelayStat>
      };
    }

    let totalBooked = 0;
    let onTimeCount = 0;
    let delayedCount = 0;
    let totalDelaySum = 0;
    let maxDelay = 0;
    let totalUnits = 0;

    let supplierDelayDays = 0;
    let productionDelayDays = 0;
    let customerDelayDays = 0;
    let engineeringDelayDays = 0;

    const stageDelayMap: Record<string, {
      stageKey: string;
      stageName: string;
      stageOrder: number;
      category: string;
      responsibleRole: Role;
      totalDays: number;
      orders: number;
      reasons: Set<string>;
      impactedPOs: Array<{
        poNumber: string;
        customerName: string;
        delayDays: number;
        reason?: string;
      }>;
    }> = {};

    CIRCOR_STANDARD_STAGES.forEach(st => {
      stageDelayMap[st.key] = {
        stageKey: st.key,
        stageName: st.name,
        stageOrder: st.order,
        category: st.category,
        responsibleRole: st.responsibleRole,
        totalDays: 0,
        orders: 0,
        reasons: new Set<string>(),
        impactedPOs: []
      };
    });

    yearOrders.forEach(po => {
      const booked = typeof po.bookedAmount === 'number' && !isNaN(po.bookedAmount) ? po.bookedAmount : 0;
      totalBooked += booked;

      const summary = getPOManufacturingStatus(po);
      const delay = getPOEffectiveDelay(po);
      totalDelaySum += delay;

      if (delay <= 0) {
        onTimeCount++;
      } else {
        delayedCount++;
        if (delay > maxDelay) maxDelay = delay;
      }

      (po.productLines || []).forEach(line => {
        totalUnits += (line.qty || 1);
      });

      // Track stage deltas & root causes directly from the order's delay logs as it is
      const delayLog = extractDelayFlow(po);
      const poCapturedStages = new Set<string>();
      let poCapturedDelta = 0;

      const originSteps = delayLog.allDelayOriginSteps?.length > 0
        ? delayLog.allDelayOriginSteps
        : delayLog.delaySteps.filter(s => !s.isRecovery && s.stageDelayAdded > 0);

      originSteps.forEach(step => {
        let k = step.stageKey;
        if (k === 'baseline_review' || k === 'planning' || k === 'baseline') k = 'pm_baseline';
        else if (k === 'raw_material' || k === 'incoming_inspection' || k === 'stores_inward' || k === 'material') k = 'material_receipt';
        else if (k === 'production' || k === 'production_assembly') k = 'assembly';
        else if (k === 'fabrication' || k === 'production_machining') k = 'machining';
        else if (k === 'qc_pass' || k === 'quality_check' || k === 'fg_inspection') k = 'fg';
        else if (k === 'dispatch' || k === 'delivery' || k === 'shipping') k = 'shipment';
        else if (k === 'procurement' || k === 'supplier_po') k = 'sub_supplier_po';
        else if (k === 'client_inspection' || k === 'third_party_inspection') k = 'customer_inspection';
        else if (k === 'coating') k = 'painting';
        else if (k === 'dispatch_clearance' || k === 'test_report') k = 'trn';
        else if (k === 'corb') k = 'corb_release';
        else if (k === 'bom' || k === 'engineering') k = 'bom_release';
        else if (k === 'wo' || k === 'work_order') k = 'wo_release';

        // Fallback to stageOrder if key is custom or unmapped
        if (!stageDelayMap[k] && step.stageOrder >= 1 && step.stageOrder <= 14) {
          const mapped = CIRCOR_STANDARD_STAGES.find(s => s.order === step.stageOrder);
          if (mapped) k = mapped.key;
        }

        const stageEntry = stageDelayMap[k];
        const addedDays = step.stageDelayAdded > 0 ? step.stageDelayAdded : (step.delayDays || 0);

        if (stageEntry && addedDays > 0) {
          stageEntry.totalDays += addedDays;
          if (!poCapturedStages.has(k)) {
            stageEntry.orders += 1;
            poCapturedStages.add(k);
          }
          poCapturedDelta += addedDays;
          if (step.delayReason && !step.delayReason.startsWith('Inherited') && !step.delayReason.startsWith('Cascaded')) {
            stageEntry.reasons.add(step.delayReason);
          }
          stageEntry.impactedPOs.push({
            poNumber: po.poNumber,
            customerName: po.customerName,
            delayDays: addedDays,
            reason: step.delayReason
          });

          const cat = step.delayCategory || stageEntry.category;
          if (cat === 'Supplier') supplierDelayDays += addedDays;
          else if (cat === 'Customer') customerDelayDays += addedDays;
          else if (cat === 'Engineering' || cat === 'Design') engineeringDelayDays += addedDays;
          else productionDelayDays += addedDays;
        }
      });

      // If order had a net delay, but incremental milestone deltas were not captured (e.g. legacy/imported POs where intermediate dates weren't tracked):
      if (delay > 0 && poCapturedDelta === 0) {
        let targetKey = summary.currentStageKey || 'material_receipt';
        if (summary.delayedStageName) {
          const matched = CIRCOR_STANDARD_STAGES.find(s => 
            summary.delayedStageName?.toLowerCase().includes(s.name.toLowerCase()) || 
            summary.delayedStageName?.toLowerCase().includes(s.key.toLowerCase()) ||
            s.name.toLowerCase().includes(summary.delayedStageName?.toLowerCase() || '')
          );
          if (matched) targetKey = matched.key;
        }

        const stageEntry = stageDelayMap[targetKey];
        if (stageEntry) {
          stageEntry.totalDays += delay;
          stageEntry.orders += 1;
          if (summary.delayReason && !summary.delayReason.startsWith('Inherited') && !summary.delayReason.startsWith('Cascaded')) {
            stageEntry.reasons.add(summary.delayReason);
          }
          stageEntry.impactedPOs.push({
            poNumber: po.poNumber,
            customerName: po.customerName,
            delayDays: delay,
            reason: summary.delayReason
          });
        }

        const cat = stageEntry?.category || 'Supplier';
        if (cat === 'Supplier') supplierDelayDays += delay;
        else if (cat === 'Customer') customerDelayDays += delay;
        else if (cat === 'Engineering' || cat === 'Design') engineeringDelayDays += delay;
        else productionDelayDays += delay;
      }
      // If order delay exceeded the captured intermediate milestone deltas, attribute remaining uncaptured overrun to Stage 14 (Shipment & Dispatch)
      else if (delay > poCapturedDelta) {
        const remainingDelay = delay - poCapturedDelta;
        const shipmentEntry = stageDelayMap['shipment'];
        if (shipmentEntry) {
          shipmentEntry.totalDays += remainingDelay;
          if (!poCapturedStages.has('shipment')) {
            shipmentEntry.orders += 1;
          }
          shipmentEntry.impactedPOs.push({
            poNumber: po.poNumber,
            customerName: po.customerName,
            delayDays: remainingDelay,
            reason: 'Final dispatch lead-time overrun'
          });
        }
        productionDelayDays += remainingDelay;
      }
    });

    // Shares must be percentages of the stage-attributed delay days (not the PO-level net delay),
    // so the bottleneck shares always sum to ~100%.
    const stageDaysSum = Object.values(stageDelayMap).reduce((sum, s) => sum + s.totalDays, 0);
    const totalCalculatedDelays = Math.max(stageDaysSum, 1);

    const topBottlenecks: StageBottleneckItem[] = Object.values(stageDelayMap)
      .filter(s => s.totalDays > 0)
      .map(s => ({
        stageKey: s.stageKey,
        stageName: s.stageName,
        stageOrder: s.stageOrder,
        totalDelayDays: s.totalDays,
        ordersCount: s.orders,
        sharePct: Math.round((s.totalDays / totalCalculatedDelays) * 100),
        rootCause: Array.from(s.reasons)[0] || `Schedule baseline overrun (+${s.totalDays}d across ${s.orders} ${s.orders === 1 ? 'order' : 'orders'})`
      }))
      .sort((a, b) => b.totalDelayDays - a.totalDelayDays);

    return {
      totalOrders,
      totalBookedAmount: totalBooked,
      avgOrderValue: totalOrders > 0 ? Math.round(totalBooked / totalOrders) : 0,
      onTimeCount,
      delayedCount,
      otifRate: totalOrders > 0 ? Math.round((onTimeCount / totalOrders) * 100) : 100,
      avgDelay: delayedCount > 0 ? Math.round((totalDelaySum / delayedCount) * 10) / 10 : 0,
      maxDelay,
      totalDelayDays: totalDelaySum,
      totalUnits,
      topBottlenecks,
      supplierDelayDays,
      productionDelayDays,
      customerDelayDays,
      engineeringDelayDays,
      stageDelayMap: Object.fromEntries(
        Object.entries(stageDelayMap).map(([k, v]) => [k, { 
          stageKey: v.stageKey,
          stageName: v.stageName,
          stageOrder: v.stageOrder,
          category: v.category,
          responsibleRole: v.responsibleRole,
          totalDays: v.totalDays, 
          orders: v.orders,
          reasons: Array.from(v.reasons),
          impactedPOs: v.impactedPOs
        }])
      )
    };
  }, [yearOrders]);

  // Top 4 delayed stages stats ranked by max repeated delays (frequency of delay across orders)
  const delayedStagesStats = useMemo(() => {
    const allDelayed = CIRCOR_STANDARD_STAGES.map(item => {
      const stat = metrics.stageDelayMap[item.key];

      return {
        key: item.key,
        order: item.order,
        name: item.name,
        category: item.category,
        // Generic per-stage cause from the standard catalog (intentionally NOT a single
        // order's recorded reason — this is a standard annual report, not an order log).
        primaryDelayCause: item.primaryCause,
        improvementTip: item.improvementTip,
        responsibleRole: item.responsibleRole,
        delayDays: stat?.totalDays || 0,
        ordersCount: stat?.orders || 0,
        isDelayed: (stat?.totalDays || 0) > 0,
      };
    })
    .filter(stage => stage.isDelayed)
    // Rank strictly by max repeated delays (ordersCount desc), then total delay days (delayDays desc)
    .sort((a, b) => {
      if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
      if (b.delayDays !== a.delayDays) return b.delayDays - a.delayDays;
      return a.order - b.order;
    });

    // Default view: top 4 by delay frequency. When searching, search ALL delayed
    // stages (not just the top 4) so a ranked-#5 stage is still findable.
    if (!stageSearch.trim()) return allDelayed.slice(0, 4);
    const q = stageSearch.toLowerCase();
    return allDelayed.filter(stage => (
      stage.name.toLowerCase().includes(q) ||
      stage.primaryDelayCause.toLowerCase().includes(q) ||
      stage.improvementTip.toLowerCase().includes(q) ||
      stage.responsibleRole.toLowerCase().includes(q) ||
      stage.category.toLowerCase().includes(q)
    ));
  }, [metrics.stageDelayMap, stageSearch]);

  const delayedStagesCount = useMemo(() => {
    return CIRCOR_STANDARD_STAGES.filter(item => (metrics.stageDelayMap[item.key]?.totalDays || 0) > 0).length;
  }, [metrics.stageDelayMap]);

  // Filtered orders list for the table
  const filteredOrders = useMemo(() => {
    return yearOrders.filter(po => {
      const isDelayed = getPOEffectiveDelay(po) > 0;

      if (statusFilter === 'ON_TIME' && isDelayed) return false;
      if (statusFilter === 'DELAYED' && !isDelayed) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchPO = po.poNumber.toLowerCase().includes(q);
        const matchCust = po.customerName.toLowerCase().includes(q);
        const matchProd = po.productLines.some(l => l.productName.toLowerCase().includes(q));
        const bInfo = getPOBottleneckInfo(po);
        const matchBottleneck = bInfo.hasBottleneck && bInfo.stageName.toLowerCase().includes(q);
        return matchPO || matchCust || matchProd || matchBottleneck;
      }

      return true;
    });
  }, [yearOrders, statusFilter, searchQuery]);

  // Export individual single order PDF with full baseline schedule, delay logs, milestones, and product lines
  const handleExportSingleOrderPDF = (po: PurchaseOrder) => {
    const compDate = getCompletionDate(po);
    const startDate = getOrderStartDate(po);
    const effDelay = getPOEffectiveDelay(po);
    const isDelayed = effDelay > 0;
    const bottleneck = getPOBottleneckInfo(po);
    const recDays = getPORecoveredDays(po);
    const booked = typeof po.bookedAmount === 'number' && !isNaN(po.bookedAmount) ? po.bookedAmount : 0;
    const delayLog = extractDelayFlow(po);
    const currentBaseline = po.revisedDeliveryDate || po.committedDeliveryDate;
    const revCount = po.revisions?.length || 0;
    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    // Milestone rows across the primary product line
    const line = po.productLines[0];
    const milestones = line?.milestones || [];
    const lastMs = milestones[milestones.length - 1];
    const baselineEnd = lastMs?.committedBaselineEndDate || po.revisedDeliveryDate;
    const targetDeliv = po.actualDeliveryDate || po.committedDeliveryDate;
    const hasBaselineOverrun = Boolean(baselineEnd && targetDeliv && baselineEnd > targetDeliv);
    const overrunDays = hasBaselineOverrun
      ? Math.max(0, Math.round((new Date(baselineEnd).getTime() - new Date(targetDeliv).getTime()) / 864e5))
      : 0;
    const latestRev = po.revisions && po.revisions.length > 0 ? po.revisions[po.revisions.length - 1] : null;

    const milestoneRows = milestones.map((ms, idx) => {
      const step = delayLog.delaySteps.find(s => s.stageKey === ms.key || s.stageOrder === ms.stageOrder);
      const isRecovery = step?.isRecovery;
      const delayAdded = step?.stageDelayAdded || 0;
      const varDays = typeof ms.varianceDays === 'number' ? ms.varianceDays : 0;
      const cleanName = (ms.name || '').replace(/^(\d+\.)+\s*/, '');
      const isStage3Baseline = idx === 2 || ms.stageOrder === 3 || ms.key === 'pm_baseline' || ms.key === 'baseline_review';
      const stage3Reason = ms.delayReason || latestRev?.reason || (po.revisions && po.revisions.length > 0 ? po.revisions[po.revisions.length - 1].reason : null) || (po.revisions && po.revisions.length > 0 ? po.revisions[0].reason : null);

      let varianceBadge = '<span style="color:#64748b;font-weight:600;">0d</span>';
      if (varDays > 0) {
        varianceBadge = `<span style="color:#be123c;font-weight:700;">+${varDays}d</span>`;
      } else if (varDays < 0) {
        varianceBadge = `<span style="color:#059669;font-weight:700;">${varDays}d</span>`;
      }

      let impactBadge = '—';
      if (isStage3Baseline && (stage3Reason || hasBaselineOverrun)) {
        impactBadge = `<span style="background:${hasBaselineOverrun ? '#fef3c7' : '#e0f2fe'};color:${hasBaselineOverrun ? '#92400e' : '#0369a1'};border:1px solid ${hasBaselineOverrun ? '#fcd34d' : '#bae6fd'};padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;">${hasBaselineOverrun ? `+${overrunDays}d baseline change` : `Rev ${revCount || 1} edited`}</span>`;
      } else if (delayAdded > 0) {
        impactBadge = `<span style="background:#ffe4e6;color:#9f1239;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;">+${delayAdded}d delay</span>`;
      } else if (delayAdded < 0) {
        impactBadge = `<span style="background:#d1fae5;color:#065f46;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;">${delayAdded}d resolved</span>`;
      }

      const reason = isStage3Baseline && stage3Reason
        ? stage3Reason
        : (ms.delayReason || step?.delayReason || (delayAdded > 0 ? 'Schedule overrun' : (delayAdded < 0 ? 'Time recovered' : '—')));
      const cat = isStage3Baseline && (stage3Reason || hasBaselineOverrun)
        ? 'Baseline Revision'
        : (ms.delayCategory || step?.delayCategory || '—');

      return `<tr style="font-size:9.5px;border-bottom:1px solid #f1f5f9;background:${idx % 2 === 0 ? '#ffffff' : '#fcfcfd'};">
        <td style="padding:5px 8px;font-weight:700;color:#334155;">${ms.stageOrder || idx + 1}. ${cleanName}</td>
        <td style="padding:5px 8px;font-family:monospace;color:#475569;">${ms.committedBaselineStartDate || '—'} → ${ms.committedBaselineEndDate || '—'}</td>
        <td style="padding:5px 8px;font-family:monospace;color:#0f172a;font-weight:600;">${ms.currentBaselineEndDate || ms.committedBaselineEndDate || '—'}</td>
        <td style="padding:5px 8px;font-family:monospace;color:${ms.actualEndDate ? '#0f172a' : '#64748b'};">${ms.actualStartDate || '—'} → ${ms.actualEndDate || (ms.status === 'Completed' ? 'Done' : '—')}</td>
        <td style="padding:5px 8px;text-align:center;">${varianceBadge}</td>
        <td style="padding:5px 8px;text-align:center;">${impactBadge}</td>
        <td style="padding:5px 8px;color:#475569;">${reason}</td>
        <td style="padding:5px 8px;color:#64748b;font-size:9px;">${cat}</td>
      </tr>`;
    }).join('');

    // Revisions table if any revisions exist
    const revisionsHTML = (po.revisions && po.revisions.length > 0)
      ? `<div style="margin-top:12px;">
          <h3 style="font-size:11px;font-weight:800;color:#0f172a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">Approved Baseline Revisions (${po.revisions.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:9.5px;">
            <thead><tr style="background:#f8fafc;color:#475569;font-weight:700;border-bottom:1px solid #e2e8f0;">
              <th style="padding:4px 8px;text-align:left;">Rev #</th>
              <th style="padding:4px 8px;text-align:left;">Approved By</th>
              <th style="padding:4px 8px;text-align:left;">Date</th>
              <th style="padding:4px 8px;text-align:left;">Doc Ref</th>
              <th style="padding:4px 8px;text-align:left;">Reason</th>
            </tr></thead>
            <tbody>
              ${po.revisions.map((rev, rIdx) => `
                <tr style="border-bottom:1px solid #f1f5f9;">
                  <td style="padding:4px 8px;font-weight:700;">Rev ${rev.revNumber ?? rIdx}</td>
                  <td style="padding:4px 8px;">${rev.approvedBy || 'Project Manager'}</td>
                  <td style="padding:4px 8px;font-family:monospace;">${rev.approvedAt ? rev.approvedAt.slice(0, 10) : '—'}</td>
                  <td style="padding:4px 8px;font-family:monospace;">${rev.docRef || '—'}</td>
                  <td style="padding:4px 8px;">${rev.reason || 'Baseline schedule update'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`
      : '';

    // Product lines summary
    const productLinesHTML = po.productLines.map((pl, idx) => `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:800;color:#0f172a;font-size:11px;">${pl.lineNumber || `LINE-${idx + 1}`}: ${pl.productName}</div>
          <div style="font-size:9px;color:#64748b;margin-top:2px;">Design: <strong>${pl.designType || 'Existing Design'}</strong> · Qty: <strong>${pl.qty || 1} units</strong> · Category: ${pl.category || 'Standard'}</div>
        </div>
        <div style="text-align:right;">
          <span style="font-size:10px;font-weight:700;font-family:monospace;${(pl.overallVarianceDays || 0) > 0 ? 'color:#be123c;' : 'color:#059669;'}">
            Variance: ${(pl.overallVarianceDays || 0) > 0 ? `+${pl.overallVarianceDays}d` : `${pl.overallVarianceDays || 0}d`}
          </span>
        </div>
      </div>
    `).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Order Report — ${po.poNumber}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; background: #fff; font-size: 10px; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 3px solid #059669; margin-bottom: 14px; }
  .title { font-size: 18px; font-weight: 900; color: #0f172a; }
  .subtitle { font-size: 10px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 10px; }
  .card-label { font-size: 8px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-val { font-size: 12px; font-weight: 800; color: #0f172a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 5px 8px; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px; background: #f1f5f9; color: #475569; border-bottom: 1px solid #cbd5e1; }
  .footer { text-align: center; font-size: 8px; color: #94a3b8; padding-top: 10px; border-top: 1px solid #e2e8f0; margin-top: 14px; }
  @media print {
    .no-print { display: none !important; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="no-print" style="position:fixed;top:10px;right:10px;display:flex;gap:8px;z-index:99999;">
  <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">Save as PDF / Print</button>
  <button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">Close</button>
</div>

<!-- HEADER -->
<div class="header">
  <div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="title">${po.poNumber}</div>
      <span class="badge" style="${isDelayed ? 'background:#ffe4e6;color:#9f1239;border:1px solid #fda4af;' : 'background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;'}">
        ${isDelayed ? `+${effDelay}d Delayed` : 'Delivered On-Time'}
      </span>
      ${po.isClosed ? '<span class="badge" style="background:#e2e8f0;color:#334155;">Closed & Archived</span>' : ''}
    </div>
    <div class="subtitle">
      Customer: <strong style="color:#0f172a;">${po.customerName}</strong> · PO Ref: <span style="font-family:monospace;">${po.customerPoRef || '—'}</span> · Contract Review: <span style="font-family:monospace;">${po.contractReviewRef || '—'}</span>
    </div>
  </div>
  <div style="text-align:right;">
    <div style="font-weight:800;color:#059669;font-size:11px;">ORDER COMPLETION DOSSIER</div>
    <div style="font-size:9px;color:#64748b;">Generated: ${generatedAt}</div>
    ${booked > 0 ? `<div style="font-size:13px;font-weight:900;color:#0f172a;margin-top:2px;">${formatUSD(booked)}</div>` : ''}
  </div>
</div>

<!-- BASELINE VS ACTUAL SCHEDULE COMPARISON -->
<div class="grid-4">
  <div class="card">
    <div class="card-label">Order Start Date</div>
    <div class="card-val" style="font-family:monospace;">${startDate}</div>
  </div>
  <div class="card">
    <div class="card-label">Original Baseline Date</div>
    <div class="card-val" style="font-family:monospace;">${po.committedDeliveryDate || '—'}</div>
  </div>
  <div class="card" style="border-color:#bbf7d0;background:#f0fdf4;">
    <div class="card-label" style="color:#166534;">Current Approved Baseline${revCount > 0 ? ` (Rev ${revCount - 1})` : ''}</div>
    <div class="card-val" style="font-family:monospace;color:#166534;">${currentBaseline || '—'}</div>
  </div>
  <div class="card" style="${isDelayed ? 'border-color:#fecdd3;background:#fff1f2;' : 'border-color:#bbf7d0;background:#f0fdf4;'}">
    <div class="card-label" style="${isDelayed ? 'color:#9f1239;' : 'color:#166534;'}">Actual Delivery Date</div>
    <div class="card-val" style="font-family:monospace;${isDelayed ? 'color:#be123c;' : 'color:#166534;'}">${compDate || '—'}</div>
  </div>
</div>

<!-- DELAY & BOTTLENECK SUMMARY BANNER -->
<div style="display:grid;grid-template-columns:${bottleneck.hasBottleneck ? '1.5fr 1fr' : '1fr'};gap:8px;margin-bottom:12px;">
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;">
    <div style="font-size:8px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:2px;">Delivery Schedule Performance</div>
    <div style="font-size:11px;font-weight:700;color:#0f172a;">
      ${isDelayed
        ? `Delivered late with +${effDelay} days overrun against baseline schedule.`
        : (recDays > 0
          ? `Delivered 100% on schedule — resolved +${recDays} days of mid-flow delays before final delivery.`
          : 'Delivered 100% on schedule with zero milestone variance.')
      }
    </div>
    <div style="font-size:9px;color:#64748b;margin-top:2px;">
      Total delay events logged: <strong>${delayLog.delaySteps.length}</strong> · Net variance: <strong>${delayLog.netVarianceDays}d</strong> · Total recovered: <strong>${delayLog.totalDaysRecovered}d</strong>
    </div>
  </div>

  ${bottleneck.hasBottleneck ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 10px;">
      <div style="font-size:8px;font-weight:700;color:#c2410c;text-transform:uppercase;margin-bottom:2px;">Primary Bottleneck Stage</div>
      <div style="font-size:11px;font-weight:800;color:#9a3412;">
        ${bottleneck.stageName} ${bottleneck.isDelayed ? `(+${bottleneck.delayDays}d)` : ''}
      </div>
      <div style="font-size:9px;color:#7c2d12;margin-top:2px;">
        Reason: <strong>${bottleneck.reason || 'Schedule overrun at this stage'}</strong>
      </div>
    </div>
  ` : ''}
</div>

<!-- PRODUCT LINES -->
<div style="margin-bottom:12px;">
  <h3 style="font-size:10px;font-weight:800;color:#0f172a;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Product Lines in PO (${po.productLines.length})</h3>
  ${productLinesHTML}
</div>

<!-- 14-STAGE MANUFACTURING & DELAY LOG LEDGER -->
${hasBaselineOverrun ? `
<div style="margin-bottom:10px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:10px;color:#78350f;">
  <strong>Baseline Changes Note:</strong> Baseline schedule (<strong>${baselineEnd}</strong>) exceeded ${po.actualDeliveryDate ? 'actual' : 'committed'} delivery date (<strong>${targetDeliv}</strong>) by <strong>+${overrunDays} days</strong>.
  ${latestRev?.reason ? `<br/><span style="color:#92400e;margin-top:2px;display:inline-block;">Reason: ${latestRev.reason}</span>` : ''}
</div>
` : ''}
<div>
  <h3 style="font-size:10px;font-weight:800;color:#0f172a;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">14-Stage Milestone Baseline &amp; Delay Log Ledger</h3>
  <table>
    <thead>
      <tr>
        <th style="width:24%;">Milestone Stage</th>
        <th style="width:17%;">Original Baseline</th>
        <th style="width:11%;">Current Target</th>
        <th style="width:17%;">Actual Dates</th>
        <th style="width:6%;text-align:center;">Var</th>
        <th style="width:10%;text-align:center;">Delay Log</th>
        <th style="width:10%;">Logged Reason</th>
        <th style="width:5%;">Category</th>
      </tr>
    </thead>
    <tbody>
      ${milestoneRows}
    </tbody>
  </table>
</div>

${revisionsHTML}

${po.closureNotes ? `
  <div style="margin-top:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;">
    <div style="font-size:8px;font-weight:700;color:#64748b;text-transform:uppercase;">PO Closure Notes</div>
    <div style="font-size:10px;color:#0f172a;margin-top:2px;font-style:italic;">"${po.closureNotes}"</div>
  </div>
` : ''}

<div class="footer">
  PO ${po.poNumber} Completion &amp; Baseline Performance Report · CIRCOR E2E Tracker · Generated on ${generatedAt}
</div>

</body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=1000,height=800');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    }
  };

  // Max value for the Bottleneck SVG Bar Chart
  const maxBottleneckDays = useMemo(() => {
    if (metrics.topBottlenecks.length === 0) return 10;
    return Math.max(...metrics.topBottlenecks.map(b => b.totalDelayDays), 10);
  }, [metrics.topBottlenecks]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* TOP HEADER & YEAR FILTER (Clean & Spacious) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-100 text-emerald-800 border border-emerald-200">
              ANNUAL REPORT • GROUPED BY START DATE
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {completedOrders.length} Total Historical Completed Orders
            </span>
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            Year-Wise Completed Orders & Performance Insights
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Key delivery metrics, bottleneck graphs, and practical takeaways grouped by order start date (intake year).
          </p>
        </div>

        {/* Year Pills + CSV Export */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setSelectedYear('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedYear === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              All Years ({completedOrders.length})
            </button>
            {availableYears.map(yr => {
              const yrCount = completedOrders.filter(po => getCompletionYear(po) === yr).length;
              return (
                <button
                  key={yr}
                  onClick={() => setSelectedYear(yr)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedYear === yr
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  {yr} ({yrCount})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION NAVIGATOR (Clean, responsive header tabs with non-wrapping pill badge) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <button
            onClick={() => setActiveReportTab('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeReportTab === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>All Sections</span>
          </button>
          <button
            onClick={() => setActiveReportTab('performance')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeReportTab === 'performance'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>1. Delivery Performance & Graphs</span>
          </button>
          <button
            onClick={() => setActiveReportTab('bottlenecks')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeReportTab === 'bottlenecks'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>2. Bottleneck Breakdown & Solutions</span>
            {delayedStagesCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeReportTab === 'bottlenecks' ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-700'
              }`}>
                {delayedStagesCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveReportTab('orders')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeReportTab === 'orders'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>3. Completed Orders Ledger</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeReportTab === 'orders' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}>
              {yearOrders.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-mono shrink-0 self-start md:self-auto">
          <span className="font-bold text-slate-800">
            {selectedYear === 'ALL' ? 'All Historical Data' : `Year ${selectedYear}`}
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-slate-600">{yearOrders.length} Completed POs</span>
          <span className="text-slate-300">•</span>
          <span className={`font-bold ${metrics.otifRate >= 80 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {metrics.otifRate}% OTIF
          </span>
        </div>
      </div>

      {/* ===== EXECUTIVE VERDICT BANNER (Clean, balanced grid summary) ===== */}
      {metrics.totalOrders > 0 && (
        <div className={`rounded-2xl border p-4 shadow-xs space-y-3 ${
          metrics.otifRate >= 85 ? 'bg-emerald-50/80 border-emerald-200' :
          metrics.otifRate >= 60 ? 'bg-amber-50/80 border-amber-200' : 'bg-rose-50/80 border-rose-200'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-black/5">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase font-mono tracking-wider ${
                metrics.otifRate >= 85 ? 'bg-emerald-700 text-white' :
                metrics.otifRate >= 60 ? 'bg-amber-700 text-white' : 'bg-rose-700 text-white'
              }`}>
                {selectedYear === 'ALL' ? 'All Years Verdict' : `Year ${selectedYear} Verdict`}
              </span>
              <span className="text-xs text-slate-600 font-medium">
                Analysis of {metrics.totalOrders} delivered orders
              </span>
            </div>
            {lateBookedValue > 0 && (
              <div className="text-xs font-mono flex items-center gap-1.5">
                <span className="text-slate-500">Delivered Late:</span>
                <strong className="text-rose-700 font-bold">{formatUSD(lateBookedValue)}</strong>
                <span className="text-slate-400 text-[11px]">of {formatUSD(metrics.totalBookedAmount)} booked</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {/* Metric 1: OTIF */}
            <div className="bg-white/90 p-3 rounded-xl border border-black/5 shadow-2xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 font-mono block">On-Time (OTIF)</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className={`text-xl font-black font-mono ${metrics.otifRate >= 85 ? 'text-emerald-700' : metrics.otifRate >= 60 ? 'text-amber-700' : 'text-rose-700'}`}>
                  {metrics.otifRate}%
                </span>
                <span className="text-[10px] text-slate-400 font-mono">(Target 85%)</span>
              </div>
            </div>

            {/* Metric 2: Delay */}
            <div className="bg-white/90 p-3 rounded-xl border border-black/5 shadow-2xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 font-mono block">Total Delay</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black font-mono text-rose-700">
                  +{metrics.totalDelayDays}d
                </span>
                <span className="text-[10px] text-slate-500">across {metrics.delayedCount} late {metrics.delayedCount === 1 ? 'order' : 'orders'}</span>
              </div>
            </div>

            {/* Metric 3: Top Bottleneck */}
            <div className="bg-white/90 p-3 rounded-xl border border-black/5 shadow-2xs col-span-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 font-mono block">Primary Root Bottleneck</span>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {metrics.topBottlenecks[0]?.stageName || 'None Detected'}
                </span>
                {metrics.topBottlenecks[0] && (
                  <span className="font-mono text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded shrink-0">
                    +{metrics.topBottlenecks[0].totalDelayDays}d ({metrics.topBottlenecks[0].sharePct}% delay share)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* SECTION 1: DELIVERY PERFORMANCE & VISUAL ANALYTICS             */}
      {/* ============================================================== */}
      {(activeReportTab === 'all' || activeReportTab === 'performance') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-extrabold flex items-center justify-center font-mono">
                01
              </span>
              <div>
                <h3 className="font-extrabold text-sm text-slate-900">
                  Delivery Performance & Executive KPIs
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedYear === 'ALL' ? 'All historical data' : `Year ${selectedYear}`} order volume, compliance rate, and schedule variance
                </p>
              </div>
            </div>
            {activeReportTab === 'all' && (
              <button
                onClick={() => setActiveReportTab('performance')}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer"
              >
                Focus Section →
              </button>
            )}
          </div>

          {/* 4 HIGH-LEVEL KPI CARDS (Simple, clean, breathable) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Completed Orders Count */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[148px]">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase font-mono mb-1.5">
                  <span>Completed Orders</span>
                  <Package className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-3xl font-black text-slate-900 font-mono">
                  {metrics.totalOrders}
                </div>
                {prevYearStats && <DeltaChip current={metrics.totalOrders} previous={prevYearStats.totalOrders} unit="" goodDirection="up" prevYear={prevYearStats.year} />}
              </div>
              <div className="text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <span>Delivered Volume:</span>
                <strong className="text-slate-800 font-mono font-bold">{metrics.totalUnits} Units</strong>
              </div>
            </div>

            {/* Total Booked Revenue */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[148px]">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase font-mono mb-1.5">
                  <span>Total Order Value</span>
                  <DollarSign className="w-4 h-4 text-emerald-700" />
                </div>
                <div className="text-2xl xl:text-3xl font-black text-slate-900 font-mono tracking-tight truncate" title={`Exact: ${formatUSDExact(metrics.totalBookedAmount)}`}>
                  {metrics.totalBookedAmount > 0 
                    ? formatUSD(metrics.totalBookedAmount) 
                    : '—'}
                </div>
                {prevYearStats && <DeltaChip current={metrics.totalBookedAmount} previous={prevYearStats.totalBooked} unit="" goodDirection="up" prevYear={prevYearStats.year} money />}
              </div>
              <div className="text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <span>Average / Order:</span>
                <strong className="text-slate-800 font-mono font-bold">
                  {metrics.avgOrderValue > 0 ? formatUSD(metrics.avgOrderValue) : '$0'}
                </strong>
              </div>
            </div>

            {/* On-Time Delivery Rate (OTIF) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[148px]">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase font-mono mb-1.5">
                  <span>On-Time Delivery Rate</span>
                  <Award className="w-4 h-4 text-emerald-600" />
                </div>
                <div className={`text-3xl font-black font-mono ${
                  metrics.otifRate >= 80 ? 'text-emerald-700' :
                  metrics.otifRate >= 60 ? 'text-amber-700' : 'text-rose-700'
                }`}>
                  {metrics.otifRate}%
                </div>
                {prevYearStats && <DeltaChip current={metrics.otifRate} previous={prevYearStats.otif} unit=" pts" goodDirection="up" prevYear={prevYearStats.year} />}
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Delivery Split:</span>
                  <div className="font-mono text-[11px] font-bold flex items-center gap-1.5">
                    <span className="text-emerald-700">{metrics.onTimeCount} On-Time</span>
                    <span className="text-slate-300">•</span>
                    <span className="text-rose-600">{metrics.delayedCount} Late</span>
                  </div>
                </div>
                {recoveredStats.count > 0 && (
                  <div className="text-[10.5px] text-emerald-700 font-medium flex items-center justify-end gap-1 font-mono">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span>{recoveredStats.count} recovered schedule delay</span>
                  </div>
                )}
              </div>
            </div>

            {/* Average Order Delay */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[148px]">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase font-mono mb-1.5">
                  <span>Avg Delay (Late Orders)</span>
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-3xl font-black text-amber-700 font-mono">
                  +{metrics.avgDelay}d
                </div>
                {prevYearStats && <DeltaChip current={metrics.avgDelay} previous={prevYearStats.avgDelay} unit="d" goodDirection="down" prevYear={prevYearStats.year} />}
              </div>
              <div className="text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <span>Maximum Delay:</span>
                <strong className="text-rose-700 font-mono font-bold">+{metrics.maxDelay}d</strong>
              </div>
            </div>

          </div>

          {/* YEAR-OVER-YEAR TREND TABLE (click a year row to focus the report on it) */}
          {yearlyStats.length >= 1 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Year-over-Year Trend</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Completion-year performance comparison — click a row to filter the entire report by that year</p>
                </div>
                {selectedYear !== 'ALL' && (
                  <button
                    onClick={() => setSelectedYear('ALL')}
                    className="text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 self-start sm:self-auto cursor-pointer"
                  >
                    Reset to All Years ✕
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 font-mono text-[10px] uppercase border-b border-slate-100">
                      <th className="py-2.5 px-3">Year</th>
                      <th className="py-2.5 px-3 text-center">Orders</th>
                      <th className="py-2.5 px-3 text-right">Booked Value</th>
                      <th className="py-2.5 px-3 text-center">OTIF Rate</th>
                      <th className="py-2.5 px-3 text-center">Avg Delay</th>
                      <th className="py-2.5 px-3 text-right">Scope</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {yearlyStats.map(ys => {
                      const isSel = selectedYear === ys.year;
                      const otifBadge = ys.otif >= 85 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : ys.otif >= 60 
                        ? 'bg-amber-50 text-amber-700 border-amber-200' 
                        : 'bg-rose-50 text-rose-700 border-rose-200';
                      return (
                        <tr
                          key={ys.year}
                          onClick={() => setSelectedYear(isSel ? 'ALL' : ys.year)}
                          className={`cursor-pointer transition-colors ${
                            isSel 
                              ? 'bg-emerald-50/80 hover:bg-emerald-100/60 font-medium' 
                              : 'hover:bg-slate-50/90'
                          }`}
                        >
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-900 font-mono text-xs bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg inline-block">
                              {ys.year}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-700 text-center font-bold">
                            {ys.totalOrders} {ys.totalOrders === 1 ? 'order' : 'orders'}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-slate-900 text-right">
                            {formatUSD(ys.totalBooked)}
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] border inline-block ${otifBadge}`}>
                              {ys.otif}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono">
                            {ys.avgDelay > 0 ? (
                              <span className="px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-rose-50 text-rose-700 border border-rose-200 inline-block">
                                +{ys.avgDelay}d Late
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full font-bold text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block">
                                0d On-Time
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {isSel ? (
                              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded font-mono">
                                ● Active Focus
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 group-hover:text-slate-600 font-mono">
                                Click to focus →
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

      {/* ============================================================== */}
      {/* SECTION: VISUAL GRAPHS (Clean, Focused, Not Overwhelming)     */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* GRAPH 1: Bottleneck Delay Days by Stage (SVG Bar Chart) */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-emerald-700" />
                <h3 className="font-extrabold text-sm text-slate-900">
                  Where Delays Occurred (Bottlenecks by Milestone Stage)
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Ranked by <strong className="text-slate-700">total delay days</strong> added at each stage across completed contracts
              </p>
            </div>
            <div className="text-xs font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
              Total Delays: +{metrics.totalDelayDays} Days
            </div>
          </div>

          {metrics.topBottlenecks.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-50" />
              Zero schedule delays recorded. All stages finished strictly on or ahead of schedule!
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              {metrics.topBottlenecks.slice(0, 5).map((b, idx) => {
                const barWidthPct = Math.max(8, Math.round((b.totalDelayDays / maxBottleneckDays) * 100));
                const isTop = idx === 0;

                return (
                  <div key={b.stageKey} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-medium text-slate-800">
                        <span className={`w-4 h-4 rounded text-[10px] font-mono font-bold flex items-center justify-center ${
                          isTop ? 'bg-rose-700 text-white' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="font-semibold">{b.stageName}</span>
                        <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                          ({b.ordersCount} {b.ordersCount === 1 ? 'order' : 'orders'})
                        </span>
                      </div>

                      <div className="font-mono text-xs flex items-center gap-2">
                        <span className="font-bold text-rose-700">+{b.totalDelayDays} days</span>
                        <span className="text-[10px] text-slate-400">({b.sharePct}%)</span>
                      </div>
                    </div>

                    {/* SVG/HTML Bar */}
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div
                        style={{ width: `${barWidthPct}%` }}
                        className={`h-full rounded-full transition-all duration-500 ${
                          isTop ? 'bg-gradient-to-r from-rose-500 to-rose-600' :
                          idx === 1 ? 'bg-gradient-to-r from-amber-500 to-amber-600' :
                          'bg-gradient-to-r from-slate-400 to-slate-500'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* GRAPH 2: Delivery Compliance Donut / Breakdown Chart */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-emerald-700" />
              <h3 className="font-extrabold text-sm text-slate-900">
                Delivery Compliance (OTIF)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Proportion of on-time vs delayed order shipments
            </p>
          </div>

          {/* Clean Visual Donut Chart */}
          <div className="flex flex-col items-center justify-center py-4">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                {/* Background Ring */}
                <circle
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="transparent"
                  stroke="#e2e8f0"
                  strokeWidth="3.5"
                />
                {/* Delayed Ring Segment */}
                {metrics.delayedCount > 0 && (
                  <circle
                    cx="18"
                    cy="18"
                    r="15.915"
                    fill="transparent"
                    stroke="#f43f5e"
                    strokeWidth="3.5"
                    strokeDasharray={`${100 - metrics.otifRate} ${metrics.otifRate}`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                  />
                )}
                {/* On-Time Ring Segment */}
                {metrics.onTimeCount > 0 && (
                  <circle
                    cx="18"
                    cy="18"
                    r="15.915"
                    fill="transparent"
                    stroke="#059669"
                    strokeWidth="3.5"
                    strokeDasharray={`${metrics.otifRate} ${100 - metrics.otifRate}`}
                    strokeDashoffset={`${-(100 - metrics.otifRate)}`}
                    strokeLinecap="round"
                  />
                )}
              </svg>

              {/* Center Stat */}
              <div className="absolute text-center">
                <span className="text-2xl font-black font-mono text-slate-900 block leading-tight">
                  {metrics.otifRate}%
                </span>
                <span className="text-[10px] font-bold text-slate-400 font-mono uppercase">
                  On-Time
                </span>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-600"></span>
                <span className="text-slate-700">On-Time ({metrics.onTimeCount}{recoveredStats.count > 0 ? `, ${recoveredStats.count} recovered` : ''})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                <span className="text-slate-700">Delayed ({metrics.delayedCount})</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] text-slate-600 text-center">
            {metrics.otifRate >= 85 
              ? 'Excellent delivery execution meeting international customer expectations.' 
              : 'Delivery targets missed on some orders. Root cause mitigations outlined below.'}
          </div>
        </div>

      </div>
      </div>
      )}

      {/* ============================================================== */}
      {/* SECTION 2: BOTTLENECK BREAKDOWN & SOLUTIONS                    */}
      {/* ============================================================== */}
      {(activeReportTab === 'all' || activeReportTab === 'bottlenecks') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-800 text-xs font-extrabold flex items-center justify-center font-mono">
                02
              </span>
              <div>
                <h3 className="font-extrabold text-sm text-slate-900">
                  Top 4 Stage Delays & Actionable Improvements
                </h3>
                <p className="text-xs text-slate-500">
                  Ranked by <strong className="text-slate-700">how often</strong> a stage delayed orders (frequency, not total days), with root causes and actionable improvements
                </p>
              </div>
            </div>
            {activeReportTab === 'all' && (
              <button
                onClick={() => setActiveReportTab('bottlenecks')}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer"
              >
                Focus Section →
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            {/* Section Header & Interactive Controls */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-emerald-700" />
                  <h4 className="font-extrabold text-sm text-slate-900">
                    Recorded Stage Delays ({delayedStagesStats.length} Delayed {delayedStagesStats.length === 1 ? 'Stage' : 'Stages'})
                  </h4>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Showing top 4 manufacturing stages with the highest delay recurrence, typical root causes, and actionable solutions
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Stage Search Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    placeholder="Search stage, cause, role..."
                    value={stageSearch}
                    onChange={(e) => setStageSearch(e.target.value)}
                    className="pl-7 pr-6 py-1 bg-white border border-slate-200 rounded-lg text-xs w-52 focus:outline-none focus:ring-1 focus:ring-emerald-600 text-slate-800"
                  />
                  {stageSearch && (
                    <button
                      onClick={() => setStageSearch('')}
                      className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* View Mode Toggle */}
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    onClick={() => setActionViewMode('matrix')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      actionViewMode === 'matrix'
                        ? 'bg-white text-slate-900 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Summary Table
                  </button>
                  <button
                    onClick={() => setActionViewMode('cards')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      actionViewMode === 'cards'
                        ? 'bg-white text-slate-900 shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Summary Cards
                  </button>
                </div>
              </div>
            </div>

            {/* Empty state with validation if zero delays occurred or search yields no results */}
            {delayedStagesStats.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-emerald-200 text-xs text-slate-500 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto opacity-90" />
                <p className="font-bold text-slate-800 text-sm">
                  {delayedStagesCount === 0 
                    ? `100% On-Time Execution for ${selectedYear === 'ALL' ? 'all historical orders' : `Year ${selectedYear}`}!`
                    : 'No delayed manufacturing stages match your search.'}
                </p>
                <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                  {delayedStagesCount === 0 
                    ? 'Zero bottleneck delays were recorded in this period. Every manufacturing stage completed strictly on or ahead of schedule.'
                    : 'Try clearing your search term.'}
                </p>
                {stageSearch && (
                  <button
                    onClick={() => setStageSearch('')}
                    className="mt-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                  >
                    <span>Clear Search Filter</span>
                  </button>
                )}
              </div>
            ) : actionViewMode === 'matrix' ? (
              /* View Mode 1: Clean Matrix Table covering actual delayed stages */
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider font-mono">
                      <th className="py-2.5 px-3 min-w-[200px]">Stage</th>
                      <th className="py-2.5 px-3 min-w-[130px]">Delay Status</th>
                      <th className="py-2.5 px-3 min-w-[240px]">Primary Delay Cause</th>
                      <th className="py-2.5 px-3 min-w-[280px]">How We Can Improve</th>
                      <th className="py-2.5 px-3 text-right min-w-[170px]">Responsible Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {delayedStagesStats.map((stage, idx) => {
                      const hasDelay = stage.delayDays > 0;
                  return (
                    <tr
                      key={stage.key}
                      className={`transition-colors ${hasDelay ? 'hover:bg-rose-50/30' : 'hover:bg-slate-50/80'}`}
                    >
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-md bg-slate-900 text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs">
                            #{idx + 1}
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              hasDelay ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                          ></span>
                          <span className="font-medium">{stage.name}</span>
                          <span className="text-[10px] font-normal text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200/60">
                            {stage.category}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {hasDelay ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 inline-block">
                            +{stage.delayDays} {stage.delayDays === 1 ? 'day' : 'days'} • {stage.ordersCount} {stage.ordersCount === 1 ? 'order' : 'orders'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block">
                            0 days • On Schedule
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-700 leading-relaxed font-normal">
                        <span>{stage.primaryDelayCause}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-medium text-emerald-950 bg-emerald-50/90 border border-emerald-200/80 px-2.5 py-1 rounded-md inline-flex items-start gap-1.5 leading-snug">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{stage.improvementTip}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-[11px] whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono text-[10.5px] border border-slate-200">
                          {stage.responsibleRole}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* View Mode 2: Clean, Responsive Cards covering actual delayed stages */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
            {delayedStagesStats.map((stage, idx) => {
              const hasDelay = stage.delayDays > 0;
              return (
                <div
                  key={stage.key}
                  className={`p-4 rounded-xl border space-y-2.5 transition-all hover:shadow-xs flex flex-col justify-between ${
                    hasDelay
                      ? 'bg-white border-rose-200/80'
                      : 'bg-slate-50/70 border-slate-200'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Card Top: Stage Name & Delay Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-md bg-slate-900 text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs">
                          #{idx + 1}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            hasDelay ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                        ></span>
                        <span className="font-bold text-slate-900 leading-tight">
                          {stage.name}
                        </span>
                      </div>
                      {hasDelay ? (
                        <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap shrink-0">
                          +{stage.delayDays} {stage.delayDays === 1 ? 'day' : 'days'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap shrink-0">
                          On Schedule
                        </span>
                      )}
                    </div>

                    {/* What Caused Delay */}
                    <div className="text-[11px] text-slate-600 leading-relaxed">
                      <strong className="text-slate-700 font-semibold">Typical cause: </strong>
                      <span className="text-slate-800">{stage.primaryDelayCause}</span>
                    </div>

                    {/* How We Can Improve */}
                    <div className="p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-lg text-emerald-950 font-medium text-[11px] flex items-start gap-1.5 leading-snug">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{stage.improvementTip}</span>
                    </div>
                  </div>

                  {/* Card Bottom: Category & Team */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-600">
                      {stage.category}
                    </span>
                    <span>
                      Role: <strong className="text-slate-800 font-semibold font-mono">{stage.responsibleRole}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      )}

      {/* ============================================================== */}
      {/* SECTION 3: COMPLETED ORDERS LEDGER                             */}
      {/* ============================================================== */}
      {(activeReportTab === 'all' || activeReportTab === 'orders') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-800 text-xs font-extrabold flex items-center justify-center font-mono">
                03
              </span>
              <div>
                <h3 className="font-extrabold text-sm text-slate-900">
                  Completed Orders Ledger ({filteredOrders.length} of {yearOrders.length} {yearOrders.length === 1 ? 'Order' : 'Orders'})
                </h3>
                <p className="text-xs text-slate-500">
                  Individual order records, completed dates, delivery variance, and bottleneck stage
                </p>
              </div>
            </div>
            {activeReportTab === 'all' && (
              <button
                onClick={() => setActiveReportTab('orders')}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer"
              >
                Focus Section →
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden space-y-0">
        
        {/* Table Filter Controls */}
        <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by PO#, customer, product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs w-64 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 mr-1">Status Filter:</span>
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              All ({yearOrders.length})
            </button>
            <button
              onClick={() => setStatusFilter('ON_TIME')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                statusFilter === 'ON_TIME'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              On-Time ({metrics.onTimeCount})
            </button>
            <button
              onClick={() => setStatusFilter('DELAYED')}
              className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                statusFilter === 'DELAYED'
                  ? 'bg-rose-700 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Delayed ({metrics.delayedCount})
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">PO Number</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Product Details</th>
                <th className="py-3 px-4 text-right">Booked Amount</th>
                <th className="py-3 px-4">Start Date</th>
                <th className="py-3 px-4">Delivered Date</th>
                <th className="py-3 px-4 text-center">Variance</th>
                <th className="py-3 px-4">Bottleneck Stage</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No completed orders match the chosen filter.
                  </td>
                </tr>
              ) : (
                filteredOrders.map(po => {
                  const line = po.productLines[0];
                  const compDate = getCompletionDate(po);
                  const effDelay = getPOEffectiveDelay(po);
                  const isDelayed = effDelay > 0;
                  const booked = typeof po.bookedAmount === 'number' ? po.bookedAmount : 0;
                  const bottleneck = getPOBottleneckInfo(po);

                  return (
                    <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-emerald-800">
                        {po.poNumber}
                        <div className="text-[10px] text-slate-400 font-mono">Ref: {po.customerPoRef}</div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {po.customerName}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span className="font-medium">{line?.productName || 'Standard Item'}</span>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Qty: {line?.qty || 1} • {line?.designType || 'Existing Design'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {booked > 0 ? formatUSD(booked) : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        {getOrderStartDate(po)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        <div>{compDate}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Target: {po.revisedDeliveryDate || po.committedDeliveryDate}
                          {po.revisions && po.revisions.length > 0 ? ` (Rev ${po.revisions.length - 1})` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-center">
                        {isDelayed ? (
                          <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-200 rounded-full font-bold text-[10px]">
                            +{effDelay}d Late
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                            <CheckCheck className="w-3 h-3 text-emerald-600" /> On-Time
                            {(() => {
                              const rec = getPORecoveredDays(po);
                              return rec > 0
                                ? <span className="text-emerald-600/80 font-normal">(delay resolved +{rec}d)</span>
                                : null;
                            })()}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {bottleneck.hasBottleneck ? (
                          bottleneck.isDelayed ? (
                            <span className="font-semibold text-rose-900 block leading-tight">
                              {bottleneck.stageName}
                              <span className="text-[10px] text-rose-600 font-normal ml-1">
                                (+{bottleneck.delayDays}d)
                              </span>
                            </span>
                          ) : (
                            <span className="font-semibold text-slate-900 block leading-tight">
                              {bottleneck.stageName}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewPO(po)}
                            className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors inline-flex items-center gap-1 shadow-2xs"
                            title={`Preview and Export PDF for ${po.poNumber}`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View PDF</span>
                          </button>
                          {onSelectPO && (
                            <button
                              onClick={() => onSelectPO(po)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors inline-flex items-center gap-1"
                              title="View PO details"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" /> View
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

      {/* PDF DOSSIER VIEW / PREVIEW MODAL */}
      {previewPO && (() => {
        const pEffDelay = getPOEffectiveDelay(previewPO);
        const pIsDelayed = pEffDelay > 0;
        const pBottleneck = getPOBottleneckInfo(previewPO);
        const pRecDays = getPORecoveredDays(previewPO);
        const pBooked = typeof previewPO.bookedAmount === 'number' && !isNaN(previewPO.bookedAmount) ? previewPO.bookedAmount : 0;
        const pFlow = extractDelayFlow(previewPO);
        const pBase = previewPO.revisedDeliveryDate || previewPO.committedDeliveryDate || '—';
        const pStart = getOrderStartDate(previewPO);
        const pComp = getCompletionDate(previewPO);
        const pLine = previewPO.productLines[0];
        const pMilestones = pLine?.milestones || [];
        const pRevs = previewPO.revisions || [];
        const pLastMs = pMilestones[pMilestones.length - 1];
        const pBaselineEnd = pLastMs?.committedBaselineEndDate || previewPO.revisedDeliveryDate;
        const pDeliveryTarget = previewPO.actualDeliveryDate || previewPO.committedDeliveryDate;
        const pHasBaselineOverrun = Boolean(pBaselineEnd && pDeliveryTarget && pBaselineEnd > pDeliveryTarget);
        const pOverrunDays = pHasBaselineOverrun
          ? Math.max(0, Math.round((new Date(pBaselineEnd).getTime() - new Date(pDeliveryTarget).getTime()) / 864e5))
          : 0;
        const pLatestRev = pRevs.length > 0 ? pRevs[pRevs.length - 1] : null;

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-slate-100 rounded-2xl shadow-2xl border border-slate-300 max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              
              {/* Modal Top Toolbar */}
              <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between gap-4 shrink-0 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-800 flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black text-slate-900">
                        PO Completion Dossier Preview: {previewPO.poNumber}
                      </h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        pIsDelayed ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {pIsDelayed ? `+${pEffDelay}d Late` : 'Delivered On-Time'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Customer: <strong className="text-slate-800">{previewPO.customerName}</strong> · Review baseline dates &amp; milestone delay logs before downloading
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExportSingleOrderPDF(previewPO)}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs"
                    title="Download formatted PDF or Print"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download as PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewPO(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    title="Close Preview"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Scrollable Body: A4 Sheet Simulation */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-200/50">
                <div className="mx-auto max-w-4xl w-full bg-white border border-slate-300 rounded-2xl shadow-xl p-6 sm:p-8 text-slate-800 space-y-6 text-xs">
                  
                  {/* Sheet Header */}
                  <div className="flex justify-between items-start pb-4 border-b-2 border-emerald-600">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-slate-900">{previewPO.poNumber}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          pIsDelayed ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}>
                          {pIsDelayed ? `+${pEffDelay}d Delayed` : 'Delivered On-Time'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Customer: <strong className="text-slate-900">{previewPO.customerName}</strong> · PO Ref: <span className="font-mono">{previewPO.customerPoRef || '—'}</span> · Contract Review: <span className="font-mono">{previewPO.contractReviewRef || '—'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-emerald-700 text-xs uppercase tracking-wider">CIRCOR E2E TRACKER</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Order Completion Dossier</div>
                      {pBooked > 0 && (
                        <div className="text-sm font-black text-slate-900 mt-1 font-mono">{formatCurrency(pBooked)}</div>
                      )}
                    </div>
                  </div>

                  {/* 4-KPI Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Order Start Date</div>
                      <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">{pStart}</div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Original Baseline</div>
                      <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">{previewPO.committedDeliveryDate || '—'}</div>
                    </div>
                    <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                      <div className="text-[10px] font-bold text-emerald-800 uppercase">Current Baseline{pRevs.length > 0 ? ` (Rev ${pRevs.length - 1})` : ''}</div>
                      <div className="text-sm font-mono font-bold text-emerald-900 mt-0.5">{pBase}</div>
                    </div>
                    <div className={`p-3 rounded-lg border ${pIsDelayed ? 'bg-rose-50/60 border-rose-200' : 'bg-emerald-50/60 border-emerald-200'}`}>
                      <div className={`text-[10px] font-bold uppercase ${pIsDelayed ? 'text-rose-800' : 'text-emerald-800'}`}>
                        {pIsDelayed ? 'Actual Delivery' : 'Delivered Date'}
                      </div>
                      <div className={`text-sm font-mono font-bold mt-0.5 ${pIsDelayed ? 'text-rose-900' : 'text-emerald-900'}`}>
                        {pComp}
                      </div>
                    </div>
                  </div>

                  {/* Schedule Performance & Bottlenecks */}
                  <div className={`grid gap-3 ${pBottleneck.hasBottleneck ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Schedule Performance</div>
                      <div className="text-xs font-bold text-slate-900 mt-1">
                        {pIsDelayed
                          ? `Delivered late with +${pEffDelay} days overrun against baseline.`
                          : pRecDays > 0
                          ? `Delivered on schedule — recovered +${pRecDays}d of mid-flow delay.`
                          : 'Delivered 100% on schedule with zero milestone variance.'}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Delay Events: <strong>{pFlow.delaySteps.length}</strong> · Net Variance: <strong>{pFlow.netVarianceDays}d</strong> · Resolved: <strong>{pFlow.totalDaysRecovered}d</strong>
                      </div>
                    </div>
                    {pBottleneck.hasBottleneck && (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                        <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Primary Bottleneck Stage</div>
                        <div className="text-xs font-bold text-amber-950 mt-1">
                          {pBottleneck.stageName} {pBottleneck.isDelayed ? `(+${pBottleneck.delayDays}d)` : ''}
                        </div>
                        <div className="text-[11px] text-amber-800 mt-1">
                          Cause: <strong>{pBottleneck.reason || 'Schedule overrun at this stage'}</strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Product Lines */}
                  <div>
                    <h4 className="text-[11px] font-black uppercase text-slate-700 tracking-wider mb-2">
                      Product Lines ({previewPO.productLines.length})
                    </h4>
                    <div className="space-y-1.5">
                      {previewPO.productLines.map((pl, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                          <div>
                            <div className="font-bold text-slate-900 text-xs">{pl.lineNumber || `LINE-${idx+1}`}: {pl.productName}</div>
                            <div className="text-[10px] text-slate-500">Design: {pl.designType || 'Existing Design'} · Qty: {pl.qty || 1} units · Category: {pl.category || 'Standard'}</div>
                          </div>
                          <span className={`font-mono font-bold text-xs ${(pl.overallVarianceDays || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {(pl.overallVarianceDays || 0) > 0 ? `+${pl.overallVarianceDays}d` : `${pl.overallVarianceDays || 0}d`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Baseline Change Note Banner (if exceeded delivery date) */}
                  {pHasBaselineOverrun && (
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 shadow-2xs">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 text-xs">
                        <div className="font-bold text-amber-950 flex items-center gap-2">
                          <span>Baseline Change Note</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-200 text-amber-900 border border-amber-300">
                            +{pOverrunDays}d vs {previewPO.actualDeliveryDate ? 'Actual' : 'Committed'} Delivery
                          </span>
                        </div>
                        <div className="text-amber-800 mt-1">
                          Baseline schedule ({pBaselineEnd}) exceeded {previewPO.actualDeliveryDate ? 'actual' : 'committed'} delivery date ({pDeliveryTarget}) by +{pOverrunDays} days.
                          {pLatestRev?.reason ? ` Note: ${pLatestRev.reason}` : (previewPO.closureNotes ? ` Closure Note: ${previewPO.closureNotes}` : '')}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 14-Stage Milestone Baseline & Delay Ledger */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-black uppercase text-slate-700 tracking-wider">
                        14-Stage Milestone Baseline &amp; Delay Ledger
                      </h4>
                      <span className="text-[10px] text-slate-400 font-mono">14 CIRCOR Standard Milestones</span>
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-2xs">
                      <table className="w-full min-w-[760px] text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase text-[9px]">
                            <th className="p-2.5 whitespace-nowrap">Stage</th>
                            <th className="p-2.5 whitespace-nowrap">Original Baseline</th>
                            <th className="p-2.5 whitespace-nowrap">Current Target</th>
                            <th className="p-2.5 whitespace-nowrap">Actual Dates</th>
                            <th className="p-2.5 text-center whitespace-nowrap">Var</th>
                            <th className="p-2.5 text-center whitespace-nowrap">Delay Impact</th>
                            <th className="p-2.5 whitespace-nowrap">Logged Reason</th>
                            <th className="p-2.5 whitespace-nowrap">Category</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pMilestones.map((ms, idx) => {
                            const step = pFlow.delaySteps.find(s => s.stageKey === ms.key || s.stageOrder === ms.stageOrder);
                            const delayAdded = step?.stageDelayAdded || 0;
                            const varDays = typeof ms.varianceDays === 'number' ? ms.varianceDays : 0;
                            const cleanStageName = (ms.name || '').replace(/^(\d+\.)+\s*/, '');
                            const isStage3Baseline = idx === 2 || ms.stageOrder === 3 || ms.key === 'pm_baseline' || ms.key === 'baseline_review';
                            const stage3Reason = ms.delayReason || pLatestRev?.reason || (pRevs.length > 0 ? pRevs[pRevs.length - 1].reason : null) || (pRevs.length > 0 ? pRevs[0].reason : null);

                            const reason = isStage3Baseline && stage3Reason
                              ? stage3Reason
                              : (ms.delayReason || step?.delayReason || (delayAdded > 0 ? 'Schedule overrun' : (delayAdded < 0 ? 'Time recovered' : '—')));

                            const cat = isStage3Baseline && (stage3Reason || pHasBaselineOverrun)
                              ? 'Baseline Revision'
                              : (ms.delayCategory || step?.delayCategory || '—');

                            return (
                              <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                                <td className="p-2.5 font-bold text-slate-800 whitespace-nowrap">{ms.stageOrder || idx+1}. {cleanStageName}</td>
                                <td className="p-2.5 font-mono text-slate-600 whitespace-nowrap">{ms.committedBaselineStartDate || '—'} → {ms.committedBaselineEndDate || '—'}</td>
                                <td className="p-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">{ms.currentBaselineEndDate || ms.committedBaselineEndDate || '—'}</td>
                                <td className="p-2.5 font-mono text-slate-700 whitespace-nowrap">{ms.actualStartDate || '—'} → {ms.actualEndDate || (ms.status === 'Completed' ? 'Done' : '—')}</td>
                                <td className="p-2.5 text-center font-bold whitespace-nowrap">
                                  {varDays > 0 ? <span className="text-rose-700">+{varDays}d</span> : varDays < 0 ? <span className="text-emerald-700">{varDays}d</span> : <span className="text-slate-400">0d</span>}
                                </td>
                                <td className="p-2.5 text-center whitespace-nowrap">
                                  {isStage3Baseline && (stage3Reason || pHasBaselineOverrun) ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                      pHasBaselineOverrun
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-cyan-100 text-cyan-900 border-cyan-300'
                                    }`}>
                                      {pHasBaselineOverrun ? `+${pOverrunDays}d baseline change` : `Rev ${pRevs.length || 1} baseline edit`}
                                    </span>
                                  ) : delayAdded > 0 ? (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800">+{delayAdded}d delay</span>
                                  ) : delayAdded < 0 ? (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">{delayAdded}d resolved</span>
                                  ) : <span className="text-slate-400">—</span>}
                                </td>
                                <td className="p-2.5 text-slate-600 max-w-[200px]" title={reason}>
                                  {isStage3Baseline && stage3Reason ? (
                                    <div className="flex items-center gap-1.5" title={stage3Reason}>
                                      <span className="font-bold text-cyan-950 bg-cyan-100/90 px-1.5 py-0.2 rounded border border-cyan-300 text-[9px] shrink-0">
                                        Reason:
                                      </span>
                                      <span className="text-slate-900 font-semibold truncate">{stage3Reason}</span>
                                    </div>
                                  ) : (
                                    <span className="truncate block">{reason}</span>
                                  )}
                                </td>
                                <td className="p-2.5 text-slate-400 font-mono text-[10px] whitespace-nowrap">{cat}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Approved Revisions (if any) */}
                  {pRevs.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-black uppercase text-slate-700 tracking-wider mb-2">
                        Approved Baseline Revisions ({pRevs.length})
                      </h4>
                      <table className="w-full text-left text-[11px] border border-slate-200 rounded-lg overflow-hidden">
                        <thead>
                          <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[9px]">
                            <th className="p-2">Rev #</th>
                            <th className="p-2">Approved By</th>
                            <th className="p-2">Date</th>
                            <th className="p-2">Doc Ref</th>
                            <th className="p-2">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pRevs.map((rev, rIdx) => (
                            <tr key={rIdx}>
                              <td className="p-2 font-bold text-slate-800">Rev {rev.revNumber ?? rIdx}</td>
                              <td className="p-2 text-slate-700">{rev.approvedBy || 'Project Manager'}</td>
                              <td className="p-2 font-mono text-slate-600">{rev.approvedAt ? rev.approvedAt.slice(0, 10) : '—'}</td>
                              <td className="p-2 font-mono text-slate-600">{rev.docRef || '—'}</td>
                              <td className="p-2 text-slate-600">{rev.reason || 'Baseline schedule update'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Closure Notes */}
                  {previewPO.closureNotes && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">PO Closure Notes</div>
                      <div className="text-xs text-slate-800 italic mt-0.5">"{previewPO.closureNotes}"</div>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="text-center text-[10px] text-slate-400 pt-4 border-t border-slate-200 font-mono">
                    PO {previewPO.poNumber} Completion &amp; Baseline Performance Dossier · CIRCOR E2E Tracker
                  </div>

                </div>
              </div>

              {/* Modal Bottom Action Bar */}
              <div className="p-3.5 bg-white border-t border-slate-200 flex items-center justify-between text-xs shrink-0">
                <span className="text-slate-500 font-mono text-[11px]">
                  Ready to print or save as PDF. Click "Download as PDF" to generate the document.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewPO(null)}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportSingleOrderPDF(previewPO)}
                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download as PDF</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
};
