import React, { useState } from 'react';
import type { PurchaseOrder, DelayCategory, ProductLine } from '../../types';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { getDaysDifference } from '../../services/calculationEngine';

interface DelayAnalysisFlowProps {
  po: PurchaseOrder;
  lineId?: string;
  className?: string;
  showAllStages?: boolean;
  defaultOpen?: boolean;
}

export interface DelayStep {
  stageOrder: number;
  stageName: string;
  stageKey: string;
  varianceDays: number;
  delayDays: number;
  stageDelayAdded: number; // Exact days added (+) or recovered (-) by this specific stage
  cumulativeDelay: number;  // Running cumulative delay after this stage
  stageDelta: number;
  isRootCause: boolean;
  isRecovery: boolean;
  isAdditionalDelay: boolean;
  delayCategory?: DelayCategory;
  delayReason?: string;
  plannedDates: { start: string; end: string; duration: number };
  actualDates: { start?: string; end?: string; duration?: number };
  productLineName?: string;
  lineNumber?: string;
  productLineId?: string;
  affectedProducts?: { lineId: string; lineNumber: string; productName: string; varianceDays: number; delayReason?: string }[];
}

/**
 * Extracts and calculates simple milestone-wise delay & recovery flow for a single product line.
 */
function extractLineDelayFlow(po: PurchaseOrder, line: ProductLine): {
  hasDelays: boolean;
  hasHistoricalDelays: boolean;
  rootDelayStep: DelayStep | null;
  delaySteps: DelayStep[];
  allDelayOriginSteps: DelayStep[];
  recoverySteps: DelayStep[];
  netVarianceDays: number;
  totalDaysDelayed: number;
  totalDaysRecovered: number;
  isRecovered: boolean;
  aheadDays: number;
} {
  const milestones = line.milestones || [];
  const delaySteps: DelayStep[] = [];
  const recoverySteps: DelayStep[] = [];
  let rootDelayStep: DelayStep | null = null;
  let totalDaysDelayed = 0;
  let totalDaysRecovered = 0;

  for (let i = 0; i < milestones.length; i++) {
    const ms = milestones[i];
    const prevMs = i > 0 ? milestones[i - 1] : null;

    const isMaterialStage = ms.key === 'material_receipt' || ms.key === 'raw_material';
    const criticalMat = isMaterialStage
      ? (line.materials?.find(m => m.isCriticalPath) || line.materials?.[0])
      : undefined;

    const plannedStart = ms.committedBaselineStartDate || po.poDate;
    const plannedEnd = (isMaterialStage && criticalMat?.expectedDate)
      ? criticalMat.expectedDate
      : (ms.committedBaselineEndDate || po.committedDeliveryDate);
    const plannedDuration = (isMaterialStage && criticalMat?.leadTimeDays)
      ? criticalMat.leadTimeDays
      : (ms.committedDurationDays || 1);

    const actualStart = ms.actualStartDate || ms.forecastStartDate;
    const actualEnd = ms.actualEndDate || ms.forecastEndDate;
    const actualDuration = (actualStart && actualEnd) ? Math.max(1, getDaysDifference(actualStart, actualEnd) + 1) : undefined;

    // Direct variance at this milestone against its baseline target
    const currentVariance = typeof ms.varianceDays === 'number' ? ms.varianceDays : (
      actualEnd ? getDaysDifference(plannedEnd, actualEnd) : 0
    );

    // Active delay (non-negative)
    const activeVariance = Math.max(0, currentVariance);
    const prevActiveVariance = prevMs ? Math.max(0, typeof prevMs.varianceDays === 'number' ? prevMs.varianceDays : 0) : 0;

    const delta = activeVariance - prevActiveVariance;
    const isUnstarted = !ms.actualStartDate && !ms.actualEndDate && ms.status !== 'Completed' && ms.status !== 'In Progress';

    // 1. Stage added new delay days (only if stage has started or completed work)
    if (delta > 0 && activeVariance > 0 && !isUnstarted) {
      totalDaysDelayed += delta;
      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: activeVariance,
        delayDays: delta,
        stageDelayAdded: delta,
        cumulativeDelay: activeVariance,
        stageDelta: delta,
        isRootCause: false,
        isRecovery: false,
        isAdditionalDelay: true,
        delayCategory: ms.delayCategory,
        delayReason: (ms.delayReason && ms.delayReason.trim()) ? ms.delayReason.trim() : ms.name,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration },
        productLineName: line.productName,
        lineNumber: line.lineNumber,
        productLineId: line.id,
        affectedProducts: [{ lineId: line.id, lineNumber: line.lineNumber, productName: line.productName, varianceDays: activeVariance, delayReason: (ms.delayReason && ms.delayReason.trim()) ? ms.delayReason.trim() : ms.name }]
      };

      delaySteps.push(step);
    } 
    // 2. Stage recovered existing delay (previous delay was reduced)
    else if (delta < 0 && prevActiveVariance > 0) {
      const recoveredDays = Math.min(prevActiveVariance, Math.abs(delta));
      totalDaysRecovered += recoveredDays;

      const step: DelayStep = {
        stageOrder: ms.stageOrder,
        stageName: ms.name,
        stageKey: ms.key,
        varianceDays: activeVariance,
        delayDays: delta,
        stageDelayAdded: -recoveredDays,
        cumulativeDelay: activeVariance,
        stageDelta: delta,
        isRootCause: false,
        isRecovery: true,
        isAdditionalDelay: false,
        delayCategory: ms.delayCategory,
        delayReason: ms.delayReason || `${recoveredDays}d delay recovered on this stage`,
        plannedDates: { start: plannedStart, end: plannedEnd, duration: plannedDuration },
        actualDates: { start: actualStart, end: actualEnd, duration: actualDuration },
        productLineName: line.productName,
        lineNumber: line.lineNumber,
        productLineId: line.id,
        affectedProducts: [{ lineId: line.id, lineNumber: line.lineNumber, productName: line.productName, varianceDays: activeVariance }]
      };

      delaySteps.push(step);
      recoverySteps.push(step);
    } 

  }

  // Prioritize the true delay origin:
  const nonRecoverySteps = delaySteps.filter(s => !s.isRecovery);
  const stepWithExplicitReason = nonRecoverySteps.find(s => s.delayReason && !s.delayReason.startsWith('Cascaded') && !s.delayReason.startsWith('Inherited'));
  const stepWithMaxAddedDelay = [...nonRecoverySteps].sort((a, b) => (b.stageDelayAdded || 0) - (a.stageDelayAdded || 0))[0];
  
  rootDelayStep = stepWithExplicitReason || stepWithMaxAddedDelay || nonRecoverySteps[0] || null;

  if (rootDelayStep) {
    delaySteps.forEach(s => {
      s.isRootCause = s.stageKey === rootDelayStep?.stageKey;
      s.isAdditionalDelay = !s.isRootCause && !s.isRecovery;
    });
  }

  const lastMilestoneVariance = milestones[milestones.length - 1]?.varianceDays || line.overallVarianceDays || 0;
  const netVarianceDays = Math.max(0, lastMilestoneVariance);
  const aheadDays = lastMilestoneVariance < 0 ? Math.abs(lastMilestoneVariance) : 0;
  const isLineDelayed = line.status === 'Delayed' || netVarianceDays > 0 || (line.overallVarianceDays || 0) > 0;
  const hasHistoricalDelays = delaySteps.length > 0 || totalDaysDelayed > 0;
  const isRecovered = !isLineDelayed && hasHistoricalDelays;
  const hasDelays = isLineDelayed && delaySteps.length > 0;

  return {
    hasDelays,
    hasHistoricalDelays,
    rootDelayStep,
    delaySteps,
    allDelayOriginSteps: delaySteps.filter(s => !s.isRecovery),
    recoverySteps,
    netVarianceDays,
    totalDaysDelayed: totalDaysDelayed > 0 ? totalDaysDelayed : (hasDelays ? netVarianceDays : 0),
    totalDaysRecovered: totalDaysRecovered,
    isRecovered,
    aheadDays
  };
}

/**
 * Extracts and calculates milestone-by-milestone delay breakdown across the PO or a target product line.
 */
export function extractDelayFlow(po: PurchaseOrder, targetLineId?: string): {
  hasDelays: boolean;
  hasHistoricalDelays: boolean;
  rootDelayStep: DelayStep | null;
  delaySteps: DelayStep[];
  allDelayOriginSteps: DelayStep[];
  recoverySteps: DelayStep[];
  allStepsWithVariance: DelayStep[];
  netVarianceDays: number;
  totalDaysDelayed: number;
  totalDaysRecovered: number;
  isRecovered: boolean;
  aheadDays: number;
} {
  if (!po || !po.productLines || po.productLines.length === 0) {
    return {
      hasDelays: false,
      hasHistoricalDelays: false,
      rootDelayStep: null,
      delaySteps: [],
      allDelayOriginSteps: [],
      recoverySteps: [],
      allStepsWithVariance: [],
      netVarianceDays: 0,
      totalDaysDelayed: 0,
      totalDaysRecovered: 0,
      isRecovered: false,
      aheadDays: 0
    };
  }

  // If a specific line is requested, return that line's calculation
  if (targetLineId) {
    const line = po.productLines.find(l => l.id === targetLineId) || po.productLines[0];
    const res = extractLineDelayFlow(po, line);
    return {
      ...res,
      allStepsWithVariance: res.delaySteps
    };
  }

  // If no targetLineId is provided, analyze ALL product lines in the PO
  const allLineResults = po.productLines.map(line => extractLineDelayFlow(po, line));
  
  // Lines with either active or historical delays
  const linesWithDelayHistory = allLineResults.filter(r => r.hasHistoricalDelays || r.hasDelays);

  // Highest net variance across all lines
  const maxNetVariance = Math.max(...allLineResults.map(r => r.netVarianceDays), 0);
  const maxDaysDelayed = Math.max(...allLineResults.map(r => r.totalDaysDelayed), 0);
  const maxDaysRecovered = Math.max(...allLineResults.map(r => r.totalDaysRecovered), 0);

  // Combine unique delayed steps across lines and attach all affected products
  const stepMap = new Map<string, DelayStep>();
  const affectedProductsMap = new Map<string, { lineId: string; lineNumber: string; productName: string; varianceDays: number; delayReason?: string }[]>();

  linesWithDelayHistory.forEach(res => {
    res.delaySteps.forEach(step => {
      const existing = stepMap.get(step.stageKey);
      if (!existing || Math.abs(step.stageDelayAdded) > Math.abs(existing.stageDelayAdded)) {
        stepMap.set(step.stageKey, { ...step });
      }

      if (step.productLineId && step.productLineName) {
        const list = affectedProductsMap.get(step.stageKey) || [];
        if (!list.some(p => p.lineId === step.productLineId)) {
          list.push({
            lineId: step.productLineId,
            lineNumber: step.lineNumber || '',
            productName: step.productLineName,
            varianceDays: step.varianceDays,
            delayReason: step.delayReason
          });
          affectedProductsMap.set(step.stageKey, list);
        }
      }
    });
  });

  const combinedDelaySteps = Array.from(stepMap.values()).map(step => ({
    ...step,
    affectedProducts: affectedProductsMap.get(step.stageKey) || step.affectedProducts || []
  })).sort((a, b) => a.stageOrder - b.stageOrder);

  const combinedNonRecovery = combinedDelaySteps.filter(s => !s.isRecovery);
  const stepWithExplicitReason = combinedNonRecovery.find(s => s.delayReason && !s.delayReason.startsWith('Cascaded') && !s.delayReason.startsWith('Inherited'));
  const stepWithMaxAddedDelay = [...combinedNonRecovery].sort((a, b) => (b.stageDelayAdded || 0) - (a.stageDelayAdded || 0))[0];
  const rootDelayStep = stepWithExplicitReason || stepWithMaxAddedDelay || combinedDelaySteps.find(s => s.isRootCause) || combinedNonRecovery[0] || null;

  if (rootDelayStep) {
    combinedDelaySteps.forEach(s => {
      s.isRootCause = s.stageKey === rootDelayStep.stageKey;
      s.isAdditionalDelay = !s.isRootCause && !s.isRecovery;
    });
  }
  const isPODelayed = maxNetVariance > 0 || po.status === 'Delayed' || po.productLines.some(l => l.status === 'Delayed' || (l.overallVarianceDays || 0) > 0);
  const hasHistoricalDelays = combinedDelaySteps.length > 0 || maxDaysDelayed > 0 || maxDaysRecovered > 0;
  const isRecovered = !isPODelayed && hasHistoricalDelays;
  const hasDelays = isPODelayed && combinedDelaySteps.length > 0;
  const aheadDays = !isPODelayed && !hasHistoricalDelays ? Math.max(...allLineResults.map(r => r.aheadDays), 0) : 0;

  return {
    hasDelays,
    hasHistoricalDelays,
    rootDelayStep,
    delaySteps: combinedDelaySteps,
    allDelayOriginSteps: combinedDelaySteps.filter(s => !s.isRecovery),
    recoverySteps: combinedDelaySteps.filter(s => s.isRecovery),
    allStepsWithVariance: combinedDelaySteps,
    netVarianceDays: maxNetVariance,
    totalDaysDelayed: maxDaysDelayed,
    totalDaysRecovered: maxDaysRecovered,
    isRecovered,
    aheadDays
  };
}

export const DelayAnalysisFlow: React.FC<DelayAnalysisFlowProps> = ({
  po,
  lineId,
  className = '',
  defaultOpen = false
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const {
    hasDelays,
    hasHistoricalDelays,
    isRecovered,
    delaySteps,
    netVarianceDays,
    totalDaysDelayed,
    totalDaysRecovered,
    aheadDays
  } = extractDelayFlow(po, lineId);

  // When order has NEVER recorded any delays (clean on-track baseline)
  if (!hasDelays && !hasHistoricalDelays && delaySteps.length === 0) {
    return (
      <div className={`p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-950 shadow-2xs ${className}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            {aheadDays > 0 ? <Sparkles className="w-4 h-4 text-emerald-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          </div>
          <div>
            <div className="font-bold text-slate-800 flex items-center gap-2">
              <span>{aheadDays > 0 ? `Schedule Status: Ahead of Baseline (-${aheadDays} Days)` : 'Schedule Status: 100% On Time'}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {aheadDays > 0 ? `${aheadDays}d Ahead` : 'On Track'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Target Delivery Date: <strong className="text-slate-700 font-mono">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
            </p>
          </div>
        </div>

        <div className="text-right hidden sm:block">
          <span className="text-[10px] font-mono text-emerald-700 bg-white px-2.5 py-1 rounded-md border border-emerald-200 font-semibold shadow-2xs">
            0 Days Delay
          </span>
        </div>
      </div>
    );
  }

  const isResolvedState = isRecovered || (netVarianceDays === 0 && (totalDaysRecovered > 0 || totalDaysDelayed > 0 || delaySteps.length > 0));
  const effectiveDelayDays = netVarianceDays > 0 ? netVarianceDays : totalDaysDelayed;

  // Milestone-by-milestone delay & recovery report with collapsible dropdown
  return (
    <div className={`bg-white rounded-2xl overflow-hidden shadow-xs transition-all border ${
      isResolvedState ? 'border-emerald-300 ring-1 ring-emerald-200/60' : 'border-rose-200'
    } ${className}`}>
      
      {/* 1. Header Summary with Dropdown Toggle Arrow */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className={`w-full text-left p-3.5 sm:p-4 transition-colors text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none ${
          isResolvedState 
            ? 'bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 hover:bg-slate-800' 
            : 'bg-slate-900 hover:bg-slate-800'
        }`}
        title={isOpen ? 'Click to collapse delay log' : 'Click to expand delay log'}
      >
        <div className="flex items-center gap-3">
          <div className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors shrink-0">
            {isOpen ? <ChevronDown className={`w-4 h-4 ${isResolvedState ? 'text-emerald-300' : 'text-rose-300'}`} /> : <ChevronRight className="w-4 h-4 text-slate-300" />}
          </div>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
            isResolvedState 
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
              : 'bg-rose-500/20 border-rose-500/30 text-rose-400'
          }`}>
            {isResolvedState ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-xs sm:text-sm text-white">
                {isResolvedState ? 'Milestone Delay & Recovery Log (All Delays Resolved)' : 'Milestone Delay & Recovery Log'}
              </h3>
              {isResolvedState ? (
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-600 text-white shadow-2xs flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 100% On Time (Recovered)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-rose-600 text-white shadow-2xs">
                  +{effectiveDelayDays} {effectiveDelayDays === 1 ? 'Day' : 'Days'} Net Delay
                </span>
              )}
              {totalDaysRecovered > 0 && (
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/25 text-emerald-200 border border-emerald-400/30 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-emerald-300" />
                  -{totalDaysRecovered}d Recovered
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {isResolvedState 
                ? `${delaySteps.length} historical stage event(s) recorded • Past delays recovered • `
                : delaySteps.length === 1 
                  ? `1 stage recorded a delay (+${totalDaysDelayed}d total) • `
                  : `${delaySteps.length} stages recorded variance (+${totalDaysDelayed}d added${totalDaysRecovered > 0 ? `, -${totalDaysRecovered}d recovered` : ''}) • `
              }
              <span className={isResolvedState ? 'text-emerald-300 font-medium' : 'text-rose-300 font-medium'}>
                {isOpen ? 'Click to collapse' : 'Click dropdown to expand historical log'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <div className="text-right px-3 py-1.5 rounded-lg bg-white/10 border border-white/10">
            <div className="text-[10px] uppercase font-mono text-slate-400">Target Delivery Date</div>
            <div className={`text-xs font-bold font-mono ${isResolvedState ? 'text-emerald-300' : 'text-rose-300'}`}>
              {po.revisedDeliveryDate || po.committedDeliveryDate}
            </div>
          </div>
        </div>
      </button>

      {/* 2. Clear Milestone Delay & Recovery Cards (Collapsible Dropdown Body) */}
      {isOpen && (
        <div className="p-4 space-y-3 bg-slate-50/50 border-t border-slate-800/20 animate-fadeIn">
          <div className="flex items-center justify-between text-xs text-slate-600 font-bold px-1">
            <span className="flex items-center gap-1.5 text-slate-800">
              <Clock className="w-4 h-4 text-slate-600" />
              <span>Milestone Schedule &amp; Audit Log:</span>
            </span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
              isResolvedState 
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                : 'bg-rose-100 text-rose-800 border border-rose-200'
            }`}>
              {isResolvedState ? 'Net Impact: 0d (Fully Resolved)' : `Net Impact: +${effectiveDelayDays}d`}
            </span>
          </div>

          <div className="space-y-2.5">
            {delaySteps.map((step, idx) => {
              const isRecovery = step.isRecovery;

              return (
                <div
                  key={step.stageKey + idx}
                  className={`p-3.5 rounded-xl border bg-white shadow-2xs transition-all space-y-2 ${
                    isRecovery
                      ? 'border-emerald-300 bg-emerald-50/20'
                      : step.isRootCause
                      ? 'border-rose-300 ring-1 ring-rose-200/70'
                      : 'border-amber-300'
                  }`}
                >
                  {/* Stage Title and Badges */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center font-bold text-[10px] font-mono">
                        {step.stageOrder}
                      </span>
                      
                      <span className="font-bold text-slate-900 text-xs">
                        Stage {step.stageOrder}: {step.stageName.replace(/^\d+\.\s*/, '')}
                      </span>

                      {isRecovery ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <Zap className="w-3 h-3 text-emerald-600" />
                          {step.stageDelayAdded}d Recovered
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                          step.isRootCause 
                            ? 'bg-rose-100 text-rose-800 border-rose-300' 
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}>
                          +{step.stageDelayAdded} {step.stageDelayAdded === 1 ? 'Day Delay' : 'Days Delay'}
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        Running Total: <strong>+{step.cumulativeDelay}d</strong>
                      </span>

                      {step.delayCategory && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white text-slate-600 border border-slate-300">
                          {step.delayCategory}
                        </span>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2 self-start sm:self-auto">
                      <span>Target: <strong>{step.plannedDates.end}</strong></span>
                      {step.actualDates.end && (
                        <span className="text-slate-800">| Actual: <strong>{step.actualDates.end}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Product Causing the Delay / Variance */}
                  {step.affectedProducts && step.affectedProducts.length > 0 ? (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Affected Product:</span>
                      {step.affectedProducts.map(p => (
                        <span key={p.lineId} className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1">
                          <span className="text-indigo-600 font-semibold">{p.lineNumber ? `${p.lineNumber}:` : ''}</span>
                          <span className="font-bold">{p.productName}</span>
                          <span className="text-rose-700">(+{p.varianceDays}d)</span>
                        </span>
                      ))}
                    </div>
                  ) : step.productLineName ? (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Affected Product:</span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-900 border border-indigo-200">
                        {step.lineNumber ? `${step.lineNumber}: ` : ''}{step.productLineName}
                      </span>
                    </div>
                  ) : null}

                  {/* Delay Reason Explanation */}
                  {step.delayReason && (
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-800 flex items-start gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <AlertCircle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isRecovery ? 'text-emerald-600' : 'text-rose-500'}`} />
                      <div className="space-y-0.5">
                        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider block ${isRecovery ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {isRecovery ? 'Recovery Note:' : 'Reason / Root Cause:'}
                        </span>
                        <span className="font-medium text-slate-900 text-xs leading-relaxed">
                          {step.delayReason}
                        </span>
                        {step.productLineName && (
                          <span className="text-[10px] text-slate-500 font-mono block pt-0.5">
                            Recorded on: <strong className="text-slate-800">{step.lineNumber ? `${step.lineNumber} - ` : ''}{step.productLineName}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 3. TOTAL DELAY IN ALL STAGES SUMMARY IN LOG */}
          <div className="mt-4 p-4 rounded-xl border border-slate-300 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/80 pb-2.5">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs ${
                  isResolvedState ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                }`}>
                  Σ
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                    Total Delay in All Stages
                  </h4>
                  <p className="text-[10px] text-slate-300">
                    Comprehensive ledger of cumulative delays and recoveries across all 14 manufacturing stages
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold ${
                  isResolvedState 
                    ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40' 
                    : 'bg-rose-500/25 text-rose-300 border border-rose-400/40'
                }`}>
                  {isResolvedState ? '0 Days Net Delay' : `+${effectiveDelayDays} Days Net Overrun`}
                </span>
              </div>
            </div>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] text-slate-400 uppercase">Gross Delay Formed</div>
                <div className="text-sm font-extrabold text-rose-400 mt-0.5">+{totalDaysDelayed}d</div>
                <div className="text-[9px] text-slate-400 mt-0.5">Across {delaySteps.filter(s => !s.isRecovery).length} stage(s)</div>
              </div>

              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] text-slate-400 uppercase">Delays Recovered</div>
                <div className="text-sm font-extrabold text-emerald-400 mt-0.5">
                  {totalDaysRecovered > 0 ? `-${totalDaysRecovered}d` : '0d'}
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5">Across {delaySteps.filter(s => s.isRecovery).length} stage(s)</div>
              </div>

              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] text-slate-400 uppercase">Net Schedule Impact</div>
                <div className={`text-sm font-extrabold mt-0.5 ${isResolvedState ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isResolvedState ? '0d (On Time)' : `+${effectiveDelayDays}d`}
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5">Contract delivery shift</div>
              </div>

              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                <div className="text-[10px] text-slate-400 uppercase">Revised Delivery Target</div>
                <div className="text-xs font-extrabold text-cyan-300 mt-0.5 truncate" title={po.revisedDeliveryDate || po.committedDeliveryDate}>
                  {po.revisedDeliveryDate || po.committedDeliveryDate}
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5">Baseline: {po.committedDeliveryDate}</div>
              </div>
            </div>

            {/* Stage-by-Stage Cumulative Delay Ledger */}
            {delaySteps.length > 0 && (
              <div className="pt-2 border-t border-slate-700/60">
                <div className="text-[10px] font-mono uppercase text-slate-300 font-bold mb-1.5 flex items-center justify-between">
                  <span>Stage-by-Stage Delay Log Contributions:</span>
                  <span className="text-slate-400">Total Delayed Stages: {delaySteps.length}</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {delaySteps.map((step, idx) => (
                    <div key={idx} className="flex items-center justify-between p-1.5 rounded bg-white/5 text-[11px] font-mono border border-white/5">
                      <div className="flex items-center gap-2 truncate pr-2">
                        <span className="text-slate-400">#{step.stageOrder}</span>
                        <span className="text-slate-200 truncate">{step.stageName.replace(/^\d+\.\s*/, '')}</span>
                        {step.productLineName && (
                          <span className="text-[9px] text-slate-400 hidden sm:inline">
                            ({step.lineNumber ? `${step.lineNumber} ` : ''}{step.productLineName})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-1.5 py-0.2 rounded font-bold ${
                          step.isRecovery
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {step.isRecovery ? `${step.stageDelayAdded}d` : `+${step.stageDelayAdded}d`}
                        </span>
                        <span className="text-slate-400 text-[10px]">
                          Running: <strong className="text-white">+{step.cumulativeDelay}d</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};




