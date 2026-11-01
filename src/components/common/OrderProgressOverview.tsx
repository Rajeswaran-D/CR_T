import React, { useState } from 'react';
import type { PurchaseOrder } from '../../types';
import { CheckCircle2, ChevronDown, ChevronUp, Package, Activity, Check, ShieldAlert } from 'lucide-react';
import { extractDelayFlow } from './DelayAnalysisFlow';

interface OrderProgressOverviewProps {
  po: PurchaseOrder;
  onOpenCloseModal?: (po: PurchaseOrder) => void;
  defaultExpanded?: boolean;
  className?: string;
}

export const OrderProgressOverview: React.FC<OrderProgressOverviewProps> = ({
  po,
  onOpenCloseModal,
  defaultExpanded = true,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  if (!po || !po.productLines || po.productLines.length === 0) return null;

  const totalLines = po.productLines.length;
  const totalQty = po.productLines.reduce((acc, l) => acc + (l.qty || 1), 0);

  // Line-level detailed progress calculations
  const lineDetails = po.productLines.map(line => {
    const totalMilestones = line.milestones?.length || 14;
    const completedMilestones = (line.milestones || []).filter(
      m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100
    ).length;

    const inProgressMs = (line.milestones || []).find(
      m => m.status !== 'Completed' && !m.actualEndDate && (m.status === 'In Progress' || Boolean(m.actualStartDate))
    );

    const activeMs = (line.milestones || []).find(m => m.status !== 'Completed' && !m.actualEndDate) || line.milestones[line.milestones.length - 1];

    // Give partial credit for currently in-progress milestones (50% of 1 milestone weight)
    const rawScore = completedMilestones + (inProgressMs ? 0.5 : 0);
    const progressPct = Math.min(100, Math.round((rawScore / totalMilestones) * 100));
    const isCompleted = totalMilestones > 0 && completedMilestones === totalMilestones;

    return {
      line,
      totalMilestones,
      completedMilestones,
      activeMs,
      progressPct,
      isCompleted,
      qty: line.qty || 1
    };
  });

  // Calculate Weighted Order Progress
  const totalWeight = lineDetails.reduce((acc, d) => acc + d.qty, 0);
  const weightedSum = lineDetails.reduce((acc, d) => acc + (d.progressPct * d.qty), 0);
  const calculatedPOProgress = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  
  const isAllComplete = po.isClosed || (lineDetails.length > 0 && lineDetails.every(d => d.isCompleted));
  const overallProgressPct = isAllComplete ? 100 : calculatedPOProgress;

  const totalStagesCompleted = lineDetails.reduce((acc, d) => acc + d.completedMilestones, 0);
  const totalStagesCount = lineDetails.reduce((acc, d) => acc + d.totalMilestones, 0);
  const completedLinesCount = lineDetails.filter(d => d.isCompleted).length;

  const maxVariance = lineDetails.reduce((max, d) => Math.max(max, d.line.overallVarianceDays || 0), 0);
  const isDelayed = (po.status === 'Delayed' || maxVariance > 0) && !isAllComplete;

  const { rootDelayStep } = extractDelayFlow(po);

  return (
    <div className={`bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 border border-slate-700/80 rounded-2xl shadow-xl overflow-hidden text-white transition-all ${className}`}>
      
      {/* Top Banner & Overall Animated Progress Bar */}
      <div className="p-5 sm:p-6 space-y-4">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                MASTER PROGRESS
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-slate-200">
                {totalLines} Product Lines ({totalQty} Pcs Total)
              </span>
              {po.isClosed ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600">
                  CLOSED
                </span>
              ) : isAllComplete ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  READY TO CLOSE
                </span>
              ) : isDelayed ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  DELAYED (+{maxVariance}d)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  ON TRACK
                </span>
              )}
            </div>

            <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-2 pt-0.5">
              <Activity className="w-5 h-5 text-cyan-400" />
              Order Execution Progress: {overallProgressPct}%
            </h2>
            <p className="text-xs text-slate-300">
              Aggregated across all {totalLines} product lines &amp; {totalStagesCount} stages for PO <strong className="font-mono text-cyan-300">{po.poNumber}</strong>
            </p>
          </div>

          {/* Quick Metrics & Close Action */}
          <div className="flex items-center gap-3 self-end sm:self-center">
            {/* Close Order CTA Button if finished and not closed */}
            {isAllComplete && !po.isClosed && onOpenCloseModal && (
              <button
                type="button"
                onClick={() => onOpenCloseModal(po)}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-emerald-900/40 border border-emerald-400/40 cursor-pointer animate-bounce transition-all"
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
                Close Purchase Order Now
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsExpanded(prev => !prev)}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>{isExpanded ? 'Hide Products' : `View ${totalLines} Products`}</span>
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Animated Master Glowing Progress Bar */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>Manufacturing &amp; Stage Flow</span>
            </span>
            <span className="font-bold text-cyan-300">
              {totalStagesCompleted} of {totalStagesCount} Total Stages ({completedLinesCount}/{totalLines} Lines Complete)
            </span>
          </div>

          <div className="w-full bg-slate-950/80 rounded-full h-3.5 p-0.5 border border-slate-700/60 shadow-inner relative overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden ${
                po.isClosed
                  ? 'bg-slate-400'
                  : overallProgressPct === 100
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400'
                  : isDelayed
                  ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-cyan-400'
                  : 'bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400'
              }`}
              style={{ width: `${overallProgressPct}%` }}
            >
              {/* Shimmer Light Reflection Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>
        </div>

        {/* 4 Metric Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold font-mono text-xs">
              {overallProgressPct}%
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono">Overall Completion</div>
              <div className="font-bold text-white text-xs">{overallProgressPct === 100 ? '100% Finished' : `${overallProgressPct}% Complete`}</div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-300 font-bold font-mono text-xs">
              {completedLinesCount}/{totalLines}
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono">Products Delivered</div>
              <div className="font-bold text-white text-xs">{completedLinesCount} of {totalLines} Lines Done</div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-300 font-bold font-mono text-xs">
              {totalStagesCompleted}
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono">Completed Stages</div>
              <div className="font-bold text-white text-xs">{totalStagesCompleted} / {totalStagesCount} Stages</div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold font-mono text-xs border ${
              isDelayed ? 'bg-rose-500/20 border-rose-500/30 text-rose-300' : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
            }`}>
              {maxVariance > 0 ? `+${maxVariance}d` : '0d'}
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-mono">Schedule Variance</div>
              <div className="font-bold text-white text-xs">{isDelayed ? `Delayed +${maxVariance}d` : 'On Schedule'}</div>
            </div>
          </div>
        </div>

        {/* Compact Delay Notice in Progress Card - Only when the order actually has an active delay */}
        {isDelayed && rootDelayStep && (
          <div className="bg-rose-950/60 border border-rose-500/40 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-in fade-in duration-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-rose-600 text-white flex items-center gap-1 shadow-2xs">
                <ShieldAlert className="w-3.5 h-3.5" />
                DELAY DETECTED
              </span>
              {rootDelayStep.productLineName && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/30 text-purple-200 border border-purple-400/30">
                  {rootDelayStep.lineNumber ? `${rootDelayStep.lineNumber}: ` : ''}{rootDelayStep.productLineName}
                </span>
              )}
              <span className="font-mono font-bold text-white text-xs">
                Stage {rootDelayStep.stageOrder}: {rootDelayStep.stageName.replace(/^\d+\.\s*/, '')}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/30 text-rose-200 border border-rose-400/30">
                +{maxVariance > 0 ? maxVariance : (rootDelayStep.varianceDays || 1)}d Delay
              </span>
            </div>
            {rootDelayStep.delayReason && (
              <div className="text-[11px] text-rose-200/90 font-medium truncate max-w-sm">
                Reason: <strong className="text-white font-semibold">{rootDelayStep.delayReason}</strong>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Product-Wise Detailed Progress Section */}
      {isExpanded && (
        <div className="border-t border-slate-700/80 bg-slate-950/50 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Package className="w-4 h-4 text-cyan-400" />
              Product-Wise Progress Breakdown ({totalLines} {totalLines === 1 ? 'Product Line' : 'Product Lines'})
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              Each product tracks 14 standardized manufacturing stages
            </span>
          </div>

          <div className={`grid gap-4 ${
            totalLines === 1 
              ? 'grid-cols-1' 
              : totalLines === 2 
              ? 'grid-cols-1 md:grid-cols-2' 
              : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {lineDetails.map(({ line, totalMilestones, completedMilestones, activeMs, progressPct, isCompleted, qty }) => {
              const finalMs = (line.milestones || []).slice(-1)[0];
              const targetDelivery = finalMs?.committedBaselineEndDate || po.committedDeliveryDate;
              const revisedDelivery = isCompleted
                ? (finalMs?.actualEndDate || targetDelivery)
                : (finalMs?.forecastEndDate || po.revisedDeliveryDate || targetDelivery);
              const isDelayedLine = (line.overallVarianceDays && line.overallVarianceDays > 0) || (revisedDelivery > targetDelivery);

              return (
                <div
                  key={line.id}
                  className="bg-slate-900/90 border border-slate-700/80 hover:border-cyan-500/50 rounded-xl p-4 space-y-3.5 transition-all shadow-md group relative overflow-hidden"
                >
                  {/* Top Bar: Line ID, Tag, and % Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-cyan-400 text-xs px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">
                        {line.lineNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {line.designType}
                      </span>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold border shrink-0 ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : line.status === 'Delayed'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    }`}>
                      {isCompleted ? '100% Done' : `${progressPct}%`}
                    </span>
                  </div>

                  {/* Product Name */}
                  <div>
                    <h4 className="font-bold text-white text-sm leading-snug group-hover:text-cyan-300 transition-colors" title={line.productName}>
                      {line.productName}
                    </h4>
                  </div>

                  {/* Individual Line Progress Bar & Stage Metric */}
                  <div className="space-y-1.5 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                      <span className="font-semibold text-slate-200">
                        {completedMilestones} of {totalMilestones} Stages
                      </span>
                      <span className="text-slate-400">
                        Qty: <strong className="text-white font-bold">{qty} Pcs</strong>
                      </span>
                    </div>

                    <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          isCompleted
                            ? 'bg-emerald-500'
                            : line.status === 'Delayed'
                            ? 'bg-rose-500'
                            : 'bg-gradient-to-r from-cyan-500 to-teal-400'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Clean Delivery Schedule Block (Baseline vs Revised) */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] text-slate-400 font-sans uppercase font-medium">
                        Baseline Date
                      </div>
                      <div className="text-slate-200 font-semibold font-mono whitespace-nowrap">
                        {targetDelivery}
                      </div>
                    </div>
                    <div className="space-y-0.5 text-right min-w-0">
                      <div className="text-[10px] text-slate-400 font-sans uppercase font-medium">
                        {isCompleted ? 'Delivered Date' : 'Revised Target'}
                      </div>
                      <div className={`font-semibold font-mono whitespace-nowrap ${isDelayedLine ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                        {revisedDelivery}
                      </div>
                    </div>
                  </div>

                  {/* Active Milestone Status Footer */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1 flex items-center gap-1.5" title={activeMs ? `${activeMs.stageOrder}. ${activeMs.name.replace(/^\d+\.\s*/, '')}` : undefined}>
                      <span className="text-slate-400 text-[11px] shrink-0">Current:</span>
                      {isCompleted ? (
                        <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1 truncate">
                          <Check className="w-3.5 h-3.5 shrink-0" /> Fully Delivered
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-200 text-[11px] truncate">
                          {activeMs ? `${activeMs.stageOrder}. ${activeMs.name.replace(/^\d+\.\s*/, '')}` : 'In Progress'}
                        </span>
                      )}
                    </div>
                    <span className={`shrink-0 font-mono text-[10px] px-2 py-0.5 rounded font-bold whitespace-nowrap ${
                      line.overallVarianceDays > 0 
                        ? 'text-rose-300 bg-rose-500/20 border border-rose-500/30' 
                        : 'text-emerald-300 bg-emerald-500/20 border border-emerald-500/30'
                    }`}>
                      {line.overallVarianceDays > 0 ? `+${line.overallVarianceDays}d Delay` : 'On track'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};
