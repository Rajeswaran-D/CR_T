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
  X
} from 'lucide-react';
import { getPOManufacturingStatus } from '../../utils/statusUtils';
import { getDaysDifference } from '../../services/calculationEngine';
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
    key: 'pm_baseline',
    order: 2,
    name: '2. Baseline Review & Planning',
    category: 'Planning',
    primaryCause: 'Delayed schedule alignment across production and procurement slots',
    improvementTip: 'Apply standard schedule templates with pre-set buffer days',
    responsibleRole: 'Project Manager (PM Baseline)'
  },
  {
    key: 'corb_release',
    order: 3,
    name: '3. CORB Release',
    category: 'Engineering',
    primaryCause: 'Multi-party design sign-off bottlenecks and customer review holds',
    improvementTip: 'Set a mandatory 3-day approval window for standard design valve configurations',
    responsibleRole: 'AE (CORB Release)'
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

  // Helper to extract 100% accurate net delay days for an order from system delivery records
  const getPOEffectiveDelay = (po: PurchaseOrder): number => {
    const summary = getPOManufacturingStatus(po);
    const compDate = getCompletionDate(po);
    const contractDiff = (po.committedDeliveryDate && compDate && compDate > po.committedDeliveryDate)
      ? getDaysDifference(po.committedDeliveryDate, compDate)
      : 0;
    return Math.max(0, summary.delayDays, contractDiff);
  };

  // Days of mid-flow delay that were absorbed/recovered before final delivery
  // (same per-milestone rule as MilestoneModuleView / DeliveryDispatchModule)
  const getPORecoveredDays = (po: PurchaseOrder): number => {
    let recovered = 0;
    for (const line of po.productLines || []) {
      const sorted = [...(line.milestones || [])].sort((a, b) => a.stageOrder - b.stageOrder);
      for (let i = 0; i < sorted.length; i++) {
        const ms = sorted[i];
        const isDone = ms.status === 'Completed' || Boolean(ms.actualEndDate);
        if (!isDone) continue;
        const varOf = (m: typeof ms) => Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
        const currVar = varOf(ms);
        const prevVar = i > 0 ? varOf(sorted[i - 1]) : 0;
        recovered += Math.max(0, prevVar - currVar);
      }
    }
    return recovered;
  };

  // Helper to extract the primary bottleneck stage for an order (strictly dynamic from actual system records)
  const getPOBottleneckInfo = (po: PurchaseOrder) => {
    const effDelay = getPOEffectiveDelay(po);
    const recDays = getPORecoveredDays(po);
    const summary = getPOManufacturingStatus(po);

    // If the order has NO net delay and NO recovered delay (e.g. PO-QE-8802):
    // It was strictly on schedule; no delay occurred or was recorded anywhere.
    if (effDelay <= 0 && recDays <= 0) {
      return {
        stageName: '—',
        delayDays: 0,
        hasBottleneck: false,
        isDelayed: false,
        isResolved: false
      };
    }

    // For orders that experienced delay or recovered delay, find the actual causing stage from system milestones
    let bottleneckStage: string | null = null;
    let maxDelta = 0;
    let maxVar = 0;
    let stageReason: string | undefined = undefined;

    (po.productLines || []).forEach(line => {
      const sorted = [...(line.milestones || [])].sort((a, b) => a.stageOrder - b.stageOrder);
      for (let i = 0; i < sorted.length; i++) {
        const ms = sorted[i];
        const prev = i > 0 ? sorted[i - 1] : null;
        const v = typeof ms.varianceDays === 'number' && ms.varianceDays > 0 ? ms.varianceDays : 0;
        const prevV = prev && typeof prev.varianceDays === 'number' && prev.varianceDays > 0 ? prev.varianceDays : 0;
        const delta = Math.max(0, v - prevV);
        const reason = (ms.delayReason && !ms.delayReason.startsWith('Inherited') && !ms.delayReason.startsWith('Cascaded'))
          ? ms.delayReason
          : undefined;

        if (delta > maxDelta) {
          maxDelta = delta;
          maxVar = v;
          bottleneckStage = ms.name;
          stageReason = reason;
        } else if (delta === maxDelta && v > maxVar) {
          maxVar = v;
          bottleneckStage = ms.name;
          if (reason) stageReason = reason;
        } else if (!bottleneckStage && (v > 0 || reason)) {
          bottleneckStage = ms.name;
          stageReason = reason;
        }
      }
    });

    // Fallback to summary.delayedStageName if available
    if (!bottleneckStage && summary.delayedStageName && summary.delayedStageName !== '14. Final Shipment & Dispatch') {
      bottleneckStage = summary.delayedStageName;
      stageReason = summary.delayReason;
    }

    if (!bottleneckStage && effDelay > 0) {
      bottleneckStage = '14. Final Shipment & Dispatch';
    }

    // Normalize to standard stage name if matched
    if (bottleneckStage) {
      const matched = CIRCOR_STANDARD_STAGES.find(s =>
        bottleneckStage?.toLowerCase().includes(s.name.toLowerCase()) ||
        bottleneckStage?.toLowerCase().includes(s.key.toLowerCase()) ||
        s.name.toLowerCase().includes(bottleneckStage?.toLowerCase() || '')
      );
      if (matched) bottleneckStage = matched.name;
    }

    const delayDays = effDelay > 0 ? effDelay : (maxDelta > 0 ? maxDelta : (maxVar > 0 ? maxVar : recDays));

    return {
      stageName: bottleneckStage || '7. Material Receipt (GRN)',
      delayDays: delayDays || 1,
      reason: stageReason,
      hasBottleneck: true,
      isDelayed: effDelay > 0,
      isResolved: effDelay <= 0 && recDays > 0
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

      // Track stage deltas & root causes for this order
      // Collect per-stage max delta across the PO's product lines to avoid artificial duplication on multi-line POs
      const poStageDeltaMap: Record<string, { delta: number; reasons: string[]; category?: string }> = {};

      (po.productLines || []).forEach(line => {
        totalUnits += (line.qty || 1);
        const sortedMilestones = [...(line.milestones || [])].sort((a, b) => a.stageOrder - b.stageOrder);
        
        for (let i = 0; i < sortedMilestones.length; i++) {
          const ms = sortedMilestones[i];
          const prev = i > 0 ? sortedMilestones[i - 1] : null;

          const currVar = Math.max(
            0,
            typeof ms.varianceDays === 'number' ? ms.varianceDays : 0,
            (ms.actualEndDate && ms.committedBaselineEndDate && ms.actualEndDate > ms.committedBaselineEndDate)
              ? getDaysDifference(ms.committedBaselineEndDate, ms.actualEndDate)
              : 0
          );

          const prevVar = prev
            ? Math.max(
                0,
                typeof prev.varianceDays === 'number' ? prev.varianceDays : 0,
                (prev.actualEndDate && prev.committedBaselineEndDate && prev.actualEndDate > prev.committedBaselineEndDate)
                  ? getDaysDifference(prev.committedBaselineEndDate, prev.actualEndDate)
                  : 0
              )
            : 0;

          const delta = Math.max(0, currVar - prevVar);

          let k = ms.key;
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
          if (!stageDelayMap[k] && ms.stageOrder >= 1 && ms.stageOrder <= 14) {
            const mapped = CIRCOR_STANDARD_STAGES.find(s => s.order === ms.stageOrder);
            if (mapped) k = mapped.key;
          }

          if (stageDelayMap[k] && delta > 0) {
            if (!poStageDeltaMap[k]) {
              poStageDeltaMap[k] = { delta: 0, reasons: [] };
            }
            if (delta > poStageDeltaMap[k].delta) {
              poStageDeltaMap[k].delta = delta;
            }
            if (ms.delayReason && !ms.delayReason.startsWith('Inherited') && !ms.delayReason.startsWith('Cascaded')) {
              poStageDeltaMap[k].reasons.push(ms.delayReason);
            }
            if (ms.delayCategory) {
              poStageDeltaMap[k].category = ms.delayCategory;
            }
          }
        }
      });

      let poCapturedDelta = 0;
      Object.entries(poStageDeltaMap).forEach(([stageKey, data]) => {
        const stageEntry = stageDelayMap[stageKey];
        if (stageEntry && data.delta > 0) {
          stageEntry.totalDays += data.delta;
          stageEntry.orders += 1;
          poCapturedDelta += data.delta;
          data.reasons.forEach(r => stageEntry.reasons.add(r));
          stageEntry.impactedPOs.push({
            poNumber: po.poNumber,
            customerName: po.customerName,
            delayDays: data.delta,
            reason: data.reasons[0]
          });

          const cat = data.category || stageEntry.category;
          if (cat === 'Supplier') supplierDelayDays += data.delta;
          else if (cat === 'Customer') customerDelayDays += data.delta;
          else if (cat === 'Engineering' || cat === 'Design') engineeringDelayDays += data.delta;
          else productionDelayDays += data.delta;
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
          if (!poStageDeltaMap['shipment']) {
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

  // Export CSV (respects the currently visible filters — status + search)
  const handleExportCSV = () => {
    if (filteredOrders.length === 0) return;
    const headers = ['PO Number', 'Customer', 'Product', 'Booked Amount ($)', 'Start Date', 'Delivered Date', 'Variance (Days)', 'Status', 'Bottleneck Stage'];
    const rows = filteredOrders.map(po => {
      const line = po.productLines[0];
      const effDelay = getPOEffectiveDelay(po);
      const bInfo = getPOBottleneckInfo(po);
      const bottleneckExport = bInfo.hasBottleneck
        ? `${bInfo.stageName}${bInfo.isDelayed ? ` (+${bInfo.delayDays}d)` : ''}`
        : 'None';
      return [
        `"${po.poNumber}"`,
        `"${po.customerName.replace(/"/g, '""')}"`,
        `"${(line?.productName || '').replace(/"/g, '""')}"`,
        po.bookedAmount || 0,
        `"${getOrderStartDate(po)}"`,
        `"${getCompletionDate(po)}"`,
        effDelay,
        effDelay > 0 ? '"Delayed"' : '"On-Time"',
        `"${bottleneckExport.replace(/"/g, '""')}"`
      ].join(',');
    });
    const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Completed_Orders_Report_${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 border border-slate-200 shadow-xs"
            title="Download CSV report"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export CSV</span>
          </button>
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
                        {compDate}
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
                        {onSelectPO && (
                          <button
                            onClick={() => onSelectPO(po)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors inline-flex items-center gap-1"
                            title="View PO details"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-500" /> View
                          </button>
                        )}
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

    </div>
  );
};
