import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { MilestoneStatus, DelayCategory, PurchaseOrder, ProductLine, Milestone } from '../../types';
import { isMilestoneOwnedByRole } from '../../types';
import { validateEventDate, getDaysDifference, mergeDelayReason, addDays, getMilestoneRevisedDates } from '../../services/calculationEngine';
import { 
  Calendar, 
  CheckCircle2, 
  Lock, 
  AlertTriangle, 
  Play, 
  Edit3, 
  Layers, 
  LayoutGrid, 
  ChevronDown, 
  ChevronRight, 
  Sparkles,
  Archive,
  Eye,
  EyeOff,
  X,
  Search,
  PackageCheck
} from 'lucide-react';
import { CloseOrderModal } from '../modals/CloseOrderModal';
import { DelayAnalysisFlow } from '../common/DelayAnalysisFlow';

interface MilestoneModuleViewProps {
  stageKey: string;
  stageTitle: string;
  stageOrder: number;
  responsibleRole: string;
  description: string;
}

const ALL_14_STAGES = [
  { key: 'po_from_customer', label: '1. Customer PO' },
  { key: 'pm_baseline', label: '2. PM Baseline' },
  { key: 'corb_release', label: '3. CORB Release' },
  { key: 'bom_release', label: '4. BOM Release' },
  { key: 'wo_release', label: '5. WO Release' },
  { key: 'sub_supplier_po', label: '6. Sub-Supplier PO' },
  { key: 'material_receipt', label: '7. Material GRN' },
  { key: 'machining', label: '8. Machining' },
  { key: 'assembly', label: '9. Assembly' },
  { key: 'fg', label: '10. FG' },
  { key: 'customer_inspection', label: '11. Cust Insp' },
  { key: 'painting', label: '12. Painting' },
  { key: 'trn', label: '13. TRN' },
  { key: 'shipment', label: '14. Shipment' }
];

export const MilestoneModuleView: React.FC<MilestoneModuleViewProps> = ({
  stageKey,
  stageTitle,
  stageOrder,
  responsibleRole,
  description
}) => {
  const { purchaseOrders, acceptMilestone, updateMilestoneEvent, batchUpdateMilestoneEvents, activeRole } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  // Default is 'active' so completed orders do not clutter the work queue
  const [filterTab, setFilterTab] = useState<'active' | 'ready' | 'in_progress' | 'delayed' | 'completed'>('active');
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');
  
  // Accordion state
  const [expandedPOs, setExpandedPOs] = useState<Record<string, boolean>>({});
  const [showCompletedLinesInCard, setShowCompletedLinesInCard] = useState<Record<string, boolean>>({});
  const [closingPO, setClosingPO] = useState<PurchaseOrder | null>(null);

  // Individual line editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Local form states per editing card
  const [formData, setFormData] = useState<{
    startDate: string;
    endDate: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    docRef: string;
    particularDetails: string;
    secondaryRef: string;
    status: MilestoneStatus;
    delayCategory: DelayCategory | '';
    delayReason: string;
    varianceDays: number;
  }>({
    startDate: '',
    endDate: '',
    orderedDate: '',
    expectedDate: '',
    receivedDate: '',
    inspectionResult: 'Passed',
    docRef: '',
    particularDetails: '',
    secondaryRef: '',
    status: 'Not Started',
    delayCategory: '',
    delayReason: '',
    varianceDays: 0
  });

  // Batch Action Modal State
  const [batchModal, setBatchModal] = useState<{
    isOpen: boolean;
    po: PurchaseOrder | null;
    mode: 'start' | 'complete';
    selectedLineIds: string[];
    date: string;
    orderedDate?: string;
    expectedDate?: string;
    receivedDate?: string;
    inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    docRef: string;
    delayCategory: DelayCategory | '';
    delayReason: string;
  }>({
    isOpen: false,
    po: null,
    mode: 'start',
    selectedLineIds: [],
    date: new Date().toISOString().split('T')[0],
    orderedDate: '',
    expectedDate: '',
    receivedDate: '',
    inspectionResult: 'Passed',
    docRef: '',
    delayCategory: '',
    delayReason: ''
  });

  const canManageStage = isMilestoneOwnedByRole(stageKey, activeRole);
  const todayStr = new Date().toISOString().split('T')[0];

  const togglePOExpand = (poId: string, defaultOpen = false) => {
    setExpandedPOs(prev => {
      const current = prev[poId] !== undefined ? prev[poId] : defaultOpen;
      return {
        ...prev,
        [poId]: !current
      };
    });
  };

  const isPOExpanded = (poId: string, defaultOpen = false) => {
    return expandedPOs[poId] !== undefined ? expandedPOs[poId] : defaultOpen;
  };

  const toggleShowCompletedLines = (poId: string) => {
    setShowCompletedLinesInCard(prev => ({
      ...prev,
      [poId]: !prev[poId]
    }));
  };

  // Helper to check if prerequisite stage is completed
  const isPrereqComplete = (line: ProductLine, targetMilestoneKey: string) => {
    const msIndex = (line.milestones || []).findIndex(m => m.key === targetMilestoneKey);
    if (msIndex <= 0) return true;
    const prevMs = line.milestones[msIndex - 1];
    return prevMs?.status === 'Completed' || Boolean(prevMs?.actualEndDate) || prevMs?.completionPct === 100;
  };

  // Group purchase orders and calculate stage rollup data
  const validPOs = purchaseOrders.filter(po => (stageKey === 'pm_baseline' || stageKey === 'baseline_review' || po.status !== 'Baseline Pending') && po.status !== 'Cancelled' && !po.isCancelled);

  const poStageGroups = validPOs.map(po => {
    const linesWithMs = (po.productLines || []).map(line => {
      const milestone = (line.milestones || []).find(m => m.key === stageKey);
      const isPrereqDone = isPrereqComplete(line, stageKey);
      const isDone = milestone?.status === 'Completed' || Boolean(milestone?.actualEndDate) || milestone?.completionPct === 100;
      const isStarted = Boolean(milestone?.actualStartDate) && !isDone;
      const isDelayed = milestone?.status === 'Delayed' || (typeof milestone?.varianceDays === 'number' && milestone.varianceDays > 0);
      const isReadyToStart = isPrereqDone && !isStarted && !isDone;
      const isReadyToComplete = isPrereqDone && isStarted && !isDone;

      return {
        line,
        milestone: milestone as Milestone,
        isPrereqDone,
        isDone,
        isStarted,
        isDelayed,
        isReadyToStart,
        isReadyToComplete
      };
    }).filter(item => item.milestone !== undefined);

    const totalLines = linesWithMs.length;
    const completedLines = linesWithMs.filter(l => l.isDone).length;
    const startedLines = linesWithMs.filter(l => l.isStarted).length;
    const delayedLines = linesWithMs.filter(l => l.isDelayed).length;
    const readyToStartLines = linesWithMs.filter(l => l.isReadyToStart).length;
    const readyToCompleteLines = linesWithMs.filter(l => l.isReadyToComplete).length;
    const lockedLines = linesWithMs.filter(l => !l.isPrereqDone).length;

    const isAllCompleted = totalLines > 0 && completedLines === totalLines;
    const hasActiveWork = readyToStartLines > 0 || readyToCompleteLines > 0 || startedLines > 0;
    const hasDelay = delayedLines > 0;

    return {
      po,
      lines: linesWithMs,
      totalLines,
      completedLines,
      startedLines,
      delayedLines,
      readyToStartLines,
      readyToCompleteLines,
      lockedLines,
      isAllCompleted,
      hasActiveWork,
      hasDelay
    };
  }).filter(group => group.totalLines > 0);

  // Overall KPI statistics (filtered to active orders that have reached and are ready/active on this stage)
  const activePOGroups = poStageGroups.filter(g => !g.isAllCompleted && !g.po.isClosed && g.po.status !== 'Completed' && g.hasActiveWork);
  const completedPOGroups = poStageGroups.filter(g => g.isAllCompleted || g.po.isClosed || g.po.status === 'Completed');

  const totalStagePOs = activePOGroups.length;
  const totalStageLines = activePOGroups.reduce((acc, g) => acc + (g.readyToStartLines + g.startedLines), 0);
  const totalCompletedLines = poStageGroups.reduce((acc, g) => acc + g.completedLines, 0);
  const totalStartedLines = activePOGroups.reduce((acc, g) => acc + g.startedLines, 0);
  const totalDelayedLines = activePOGroups.reduce((acc, g) => acc + g.delayedLines, 0);
  const totalActionReadyLines = activePOGroups.reduce((acc, g) => acc + (g.readyToStartLines + g.readyToCompleteLines), 0);

  // Filtering based on search and tab
  const filteredPOGroups = poStageGroups.filter(group => {
    // Search Term Filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchesPO = group.po.poNumber.toLowerCase().includes(term) ||
                        group.po.customerName.toLowerCase().includes(term);
      const matchesLine = group.lines.some(l => l.line.productName.toLowerCase().includes(term) || l.line.lineNumber.toLowerCase().includes(term));
      if (!matchesPO && !matchesLine) return false;
    }

    // Default 'active': only show active/in-progress orders ready for this role's stage (exclude orders where stage is locked or completed)
    if (filterTab === 'active') {
      return !group.isAllCompleted && !group.po.isClosed && group.po.status !== 'Completed' && group.hasActiveWork;
    }
    if (filterTab === 'ready') {
      return !group.isAllCompleted && (group.readyToStartLines > 0 || group.readyToCompleteLines > 0);
    }
    if (filterTab === 'in_progress') {
      return !group.isAllCompleted && group.startedLines > 0;
    }
    if (filterTab === 'delayed') {
      return !group.isAllCompleted && group.hasDelay && group.hasActiveWork;
    }
    if (filterTab === 'completed') {
      return group.isAllCompleted || group.po.isClosed || group.po.status === 'Completed';
    }

    return true;
  });

  // Start edit for single line (opens custom date form)
  const handleStartEdit = (entryKey: string, milestone: Milestone) => {
    setEditingKey(entryKey);
    setErrorMessage(null);
    setSuccessMessage(null);

    const targetLine = purchaseOrders.flatMap(p => p.productLines).find(l => l.milestones.some(m => m.id === milestone.id));
    const criticalMat = targetLine?.materials?.find(m => m.isCriticalPath) || targetLine?.materials?.[0];
    const plannedStart = milestone.committedBaselineStartDate || milestone.forecastStartDate || todayStr;
    const defOrderDate = criticalMat?.orderedDate || milestone.actualStartDate || plannedStart;
    const defLead = criticalMat?.leadTimeDays || 14;
    const defExpectedDate = criticalMat?.expectedDate || milestone.committedBaselineEndDate || addDays(defOrderDate, Math.max(0, defLead - 1));
    const defReceivedDate = criticalMat?.receivedDate || milestone.actualEndDate || todayStr;
    const defInspection = criticalMat?.inspectionResult || 'Passed';

    setFormData({
      startDate: milestone.actualStartDate || plannedStart,
      endDate: milestone.actualEndDate || milestone.forecastEndDate || milestone.committedBaselineEndDate || todayStr,
      orderedDate: defOrderDate,
      expectedDate: defExpectedDate,
      receivedDate: defReceivedDate,
      inspectionResult: defInspection,
      docRef: milestone.docRef || '',
      particularDetails: (milestone as any).particularDetails || '',
      secondaryRef: (milestone as any).secondaryRef || '',
      status: milestone.status || 'In Progress',
      delayCategory: milestone.delayCategory || '',
      delayReason: milestone.delayReason || '',
      varianceDays: milestone.varianceDays || 0
    });
  };

  // Save single line update from form
  const handleSaveStageUpdate = (poId: string, lineId: string, key: string, markComplete = false) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const targetPO = purchaseOrders.find(p => p.id === poId);
    const targetLine = targetPO?.productLines.find(l => l.id === lineId);
    if (!targetLine || !targetPO) return;

    const msIndex = (targetLine.milestones || []).findIndex(m => m.key === key || m.id === key);
    if (msIndex < 0) return;

    if (markComplete) {
      const effectiveCompDate = (stageKey === 'material_receipt' || key === 'material_receipt')
        ? (formData.receivedDate || formData.endDate || todayStr)
        : (formData.endDate || todayStr);
      const delayReasonToUse = formData.delayReason.trim() || undefined;
      const delayCategoryToUse = formData.delayCategory || undefined;
      
      const compVal = validateEventDate({
        milestones: targetLine.milestones,
        index: msIndex,
        eventType: 'complete',
        eventDate: effectiveCompDate,
        todayStr
      });
      if (!compVal.ok) {
        setErrorMessage(compVal.error || 'Invalid completion date');
        return;
      }

      const compRes = updateMilestoneEvent({
        poId,
        productLineId: lineId,
        milestoneKey: key,
        eventType: 'complete',
        eventDate: effectiveCompDate,
        user: activeRole,
        docRef: formData.docRef || `GRN-${stageOrder}-${Date.now().toString().slice(-4)}`,
        orderedDate: formData.orderedDate,
        expectedDate: formData.expectedDate,
        receivedDate: effectiveCompDate,
        inspectionResult: formData.inspectionResult || 'Passed',
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse
      });

      if (!compRes.success) {
        setErrorMessage(compRes.error || 'Failed to complete stage');
        return;
      }
      setSuccessMessage(`Stage ${stageTitle} marked as Completed for ${targetLine.productName}.`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } else {
      const effectiveStartDate = (stageKey === 'material_receipt' || key === 'material_receipt')
        ? (formData.orderedDate || formData.startDate || todayStr)
        : (formData.startDate || todayStr);
      const delayReasonToUse = formData.delayReason.trim() || undefined;
      const delayCategoryToUse = formData.delayCategory || undefined;

      const startVal = validateEventDate({
        milestones: targetLine.milestones,
        index: msIndex,
        eventType: 'start',
        eventDate: effectiveStartDate,
        todayStr
      });
      if (!startVal.ok) {
        setErrorMessage(startVal.error || 'Invalid start date');
        return;
      }

      const startRes = updateMilestoneEvent({
        poId,
        productLineId: lineId,
        milestoneKey: key,
        eventType: 'start',
        eventDate: effectiveStartDate,
        targetEndDate: formData.expectedDate || formData.endDate || undefined,
        user: activeRole,
        docRef: formData.docRef || `PO-MAT-${stageOrder}-${Date.now().toString().slice(-4)}`,
        orderedDate: effectiveStartDate,
        expectedDate: formData.expectedDate,
        inspectionResult: formData.inspectionResult,
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse
      });

      if (!startRes.success) {
        setErrorMessage(startRes.error || 'Failed to update start date');
        return;
      }
      setSuccessMessage(`Stage ${stageTitle} started for ${targetLine.productName}.`);
    }

    setEditingKey(null);
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // Open action modal for a single product line
  const openLineModal = (po: PurchaseOrder, line: ProductLine, mode: 'start' | 'complete') => {
    const msIndex = (line.milestones || []).findIndex(m => m.key === stageKey);
    const ms = (line.milestones || [])[msIndex];
    const prevMs = msIndex > 0 ? (line.milestones || [])[msIndex - 1] : null;

    const targetMat = line.materials?.find(m => m.isCriticalPath) || line.materials?.[0];
    const msDur = ms?.committedDurationDays || targetMat?.leadTimeDays || 14;
    const plannedStart = ms?.committedBaselineStartDate || ms?.forecastStartDate || todayStr;
    const chainedStart = prevMs?.actualEndDate ? addDays(prevMs.actualEndDate, 1) : undefined;
    const effectivePlannedStart = (chainedStart && plannedStart && chainedStart > plannedStart) ? chainedStart : plannedStart;
    const defOrder = targetMat?.orderedDate || (mode === 'start' ? (ms?.actualStartDate || effectivePlannedStart) : (ms?.actualStartDate || plannedStart));
    const defExpected = targetMat?.expectedDate || addDays(defOrder, Math.max(0, msDur - 1));
    const defRec = (mode === 'complete')
      ? (ms?.actualEndDate || targetMat?.receivedDate || todayStr)
      : (targetMat?.receivedDate || '');
    const defInsp = targetMat?.inspectionResult || 'Passed';

    // Initial date: auto-fill planned/forecast start date
    const defaultDate = mode === 'start'
      ? (stageKey === 'material_receipt' ? defOrder : (ms?.actualStartDate || effectivePlannedStart))
      : (stageKey === 'material_receipt' ? defRec : (ms?.actualEndDate || ms?.forecastEndDate || ms?.committedBaselineEndDate || todayStr));

    setBatchModal({
      isOpen: true,
      po,
      mode,
      selectedLineIds: [line.id],
      date: defaultDate,
      orderedDate: defOrder,
      expectedDate: defExpected,
      receivedDate: defRec,
      inspectionResult: defInsp,
      docRef: `${mode === 'start' ? 'START' : 'COMP'}-${stageOrder}-${Date.now().toString().slice(-4)}`,
      delayCategory: '',
      delayReason: ''
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Open batch modal
  const openBatchModal = (group: typeof poStageGroups[0], mode: 'start' | 'complete') => {
    const readyLines = mode === 'start'
      ? group.lines.filter(l => l.isReadyToStart).map(l => l.line.id)
      : group.lines.filter(l => l.isPrereqDone && !l.isDone).map(l => l.line.id);

    const initialLineIds = readyLines.length > 0 ? readyLines : group.lines.filter(l => l.isPrereqDone && !l.isDone).map(l => l.line.id);

    let defaultBatchDate = '';
    initialLineIds.forEach(id => {
      const l = group.po.productLines.find(x => x.id === id);
      const idx = (l?.milestones || []).findIndex(m => m.key === stageKey);
      const prev = idx > 0 ? (l?.milestones || [])[idx - 1] : null;
      const targetMs = (l?.milestones || [])[idx];
      const plannedStart = targetMs?.committedBaselineStartDate || targetMs?.forecastStartDate || todayStr;
      const chainedStart = prev?.actualEndDate ? addDays(prev.actualEndDate, 1) : undefined;
      const effectivePlannedStart = (chainedStart && plannedStart && chainedStart > plannedStart) ? chainedStart : plannedStart;
      const targetDate = mode === 'start'
        ? (targetMs?.actualStartDate || effectivePlannedStart)
        : (targetMs?.actualEndDate || targetMs?.forecastEndDate || targetMs?.committedBaselineEndDate);
      if (targetDate && (!defaultBatchDate || targetDate > defaultBatchDate)) {
        defaultBatchDate = targetDate;
      }
    });
    if (!defaultBatchDate) defaultBatchDate = todayStr;

    const initialLine = (initialLineIds.length > 0
      ? group.po.productLines.find(x => initialLineIds.includes(x.id))
      : null) || group.po.productLines[0];
    const sampleMat = initialLine?.materials?.find(m => m.isCriticalPath) || initialLine?.materials?.[0];
    const sampleMs = initialLine?.milestones?.find(m => m.key === stageKey);
    const matDuration = (sampleMat && typeof sampleMat.leadTimeDays === 'number' && sampleMat.leadTimeDays > 0)
      ? sampleMat.leadTimeDays
      : (sampleMs?.committedDurationDays || sampleMs?.defaultDurationDays || 14);
    const defOrder = sampleMat?.orderedDate || (mode === 'start' ? defaultBatchDate : (sampleMs?.actualStartDate || defaultBatchDate));
    const defExpected = sampleMat?.expectedDate || addDays(defOrder, matDuration);
    const defReceived = (mode === 'complete')
      ? (sampleMat?.receivedDate || defaultBatchDate)
      : (sampleMat?.receivedDate || '');

    const initialDate = stageKey === 'material_receipt'
      ? (mode === 'start' ? defOrder : defReceived)
      : defaultBatchDate;

    setBatchModal({
      isOpen: true,
      po: group.po,
      mode,
      selectedLineIds: initialLineIds,
      date: initialDate,
      orderedDate: defOrder,
      expectedDate: defExpected,
      receivedDate: defReceived,
      inspectionResult: 'Passed',
      docRef: `BATCH-${stageOrder}-${Date.now().toString().slice(-4)}`,
      delayCategory: '',
      delayReason: ''
    });
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Execute batch update across selected lines
  const handleExecuteBatch = () => {
    if (!batchModal.po || batchModal.selectedLineIds.length === 0) return;

    setErrorMessage(null);
    const targetPO = batchModal.po;
    const isMaterialReceipt = stageKey === 'material_receipt';
    const eventType = batchModal.mode;
    const eventDate = isMaterialReceipt
      ? (eventType === 'complete' ? (batchModal.receivedDate || batchModal.date) : (batchModal.orderedDate || batchModal.date))
      : batchModal.date;

    const itemsToUpdate: Array<{
      poId: string;
      productLineId: string;
      milestoneKey: string;
      eventType: 'start' | 'complete';
      eventDate: string;
      user: string;
      docRef: string;
      delayCategory?: DelayCategory;
      delayReason?: string;
      orderedDate?: string;
      expectedDate?: string;
      receivedDate?: string;
      inspectionResult?: 'Passed' | 'Rejected' | 'Pending';
    }> = [];

    const errors: string[] = [];

    for (const lineId of batchModal.selectedLineIds) {
      const line = targetPO.productLines.find(l => l.id === lineId);
      if (!line) continue;
      const msIndex = (line.milestones || []).findIndex(m => m.key === stageKey);
      if (msIndex < 0) continue;

      const targetMs = line.milestones[msIndex];
      const prevMs = msIndex > 0 ? line.milestones[msIndex - 1] : null;
      const prevEnd = prevMs?.actualEndDate || prevMs?.forecastEndDate;

      if (prevEnd && eventType === 'start' && eventDate < prevEnd) {
        errors.push(`${line.productName}: Start date (${eventDate}) cannot be earlier than previous stage completion (${prevEnd}).`);
        continue;
      }
      const effectiveStartFloor = targetMs.actualStartDate || prevEnd;
      if (effectiveStartFloor && eventType === 'complete' && eventDate < effectiveStartFloor) {
        errors.push(`${line.productName}: Completion date (${eventDate}) cannot be earlier than stage start date (${effectiveStartFloor}).`);
        continue;
      }

      const baselineStart = targetMs.committedBaselineStartDate || targetPO.poDate;
      const baselineEnd = targetMs.committedBaselineEndDate || targetPO.committedDeliveryDate;
      const plannedDuration = targetMs.committedDurationDays || (baselineStart && baselineEnd ? getDaysDifference(baselineStart, baselineEnd) : 1);

      let newDelayFormed = 0;

      if (stageKey === 'material_receipt') {
        const mat = line.materials?.find(m => m.isCriticalPath) || line.materials?.[0];
        const lineLead = (mat && typeof mat.leadTimeDays === 'number' && mat.leadTimeDays > 0)
          ? mat.leadTimeDays
          : (targetMs.committedDurationDays || 14);

        const chainedEarliest = prevEnd ? addDays(prevEnd, 1) : undefined;
        const targetStart = (chainedEarliest && baselineStart && chainedEarliest > baselineStart)
          ? chainedEarliest
          : (targetMs.forecastStartDate || baselineStart || chainedEarliest || '');
        const targetDelivery = targetStart ? addDays(targetStart, Math.max(0, lineLead - 1)) : (targetMs.forecastEndDate || baselineEnd);
        const crossingLine = batchModal.expectedDate || targetDelivery || baselineEnd;

        if (eventType === 'start') {
          const orderDate = batchModal.orderedDate || eventDate;
          newDelayFormed = (orderDate && targetStart && orderDate > targetStart)
            ? getDaysDifference(targetStart, orderDate)
            : 0;
        } else {
          // Expected Delivery Date is the crossing line for Stage 7 delay calculation
          const recDate = batchModal.receivedDate || eventDate;
          newDelayFormed = (recDate && crossingLine && recDate > crossingLine)
            ? getDaysDifference(crossingLine, recDate)
            : 0;
        }
      } else if (eventType === 'start') {
        const chainedEarliest = prevEnd ? addDays(prevEnd, 1) : undefined;
        const targetStart = (chainedEarliest && baselineStart && chainedEarliest > baselineStart)
          ? chainedEarliest
          : (targetMs.forecastStartDate || baselineStart || chainedEarliest || '');
        newDelayFormed = (targetStart && eventDate && eventDate > targetStart)
          ? getDaysDifference(targetStart, eventDate)
          : 0;
      } else {
        const chainedEarliest = prevEnd ? addDays(prevEnd, 1) : undefined;
        const effectiveStart = targetMs.actualStartDate || ((chainedEarliest && baselineStart && chainedEarliest > baselineStart) ? chainedEarliest : baselineStart);
        const targetEnd = targetMs.forecastEndDate || (effectiveStart ? addDays(effectiveStart, Math.max(1, plannedDuration) - 1) : baselineEnd);
        newDelayFormed = (targetEnd && eventDate && eventDate > targetEnd)
          ? getDaysDifference(targetEnd, eventDate)
          : 0;
      }

      if (newDelayFormed > 0 && batchModal.selectedLineIds.length > 1) {
        setErrorMessage("When recording a delay, you must update the product lines individually.");
        return;
      }
      if (newDelayFormed > 0 && !batchModal.delayReason.trim()) {
        setErrorMessage("A delay reason is required.");
        return;
      }

      const delayReasonToUse = newDelayFormed > 0 ? batchModal.delayReason.trim() : undefined;
      const delayCategoryToUse = newDelayFormed > 0 ? (batchModal.delayCategory || undefined) : undefined;

      // Validate event date
      const val = validateEventDate({
        milestones: line.milestones,
        index: msIndex,
        eventType,
        eventDate,
        todayStr
      });

      if (!val.ok) {
        errors.push(`${line.productName}: ${val.error}`);
        continue;
      }

      // Auto-accept if not yet accepted
      if (!targetMs.acceptedAt) {
        acceptMilestone({ poId: targetPO.id, productLineId: line.id, milestoneKey: stageKey, user: activeRole });
      }

      itemsToUpdate.push({
        poId: targetPO.id,
        productLineId: line.id,
        milestoneKey: stageKey,
        eventType,
        eventDate,
        user: activeRole,
        docRef: batchModal.docRef || `BATCH-${stageOrder}-${Date.now().toString().slice(-4)}`,
        delayCategory: delayCategoryToUse,
        delayReason: delayReasonToUse,
        orderedDate: batchModal.orderedDate,
        expectedDate: batchModal.expectedDate,
        receivedDate: eventType === 'complete' ? (batchModal.receivedDate || eventDate) : batchModal.receivedDate,
        inspectionResult: batchModal.inspectionResult
      });
    }

    if (itemsToUpdate.length > 0) {
      const res = batchUpdateMilestoneEvents(itemsToUpdate);
      if (!res.success) {
        errors.push(res.error || 'Batch update failed');
      }
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join('; '));
    } else {
      setSuccessMessage(`Successfully ${eventType === 'start' ? 'started' : 'completed'} stage ${stageTitle} for all ${itemsToUpdate.length} product lines in ${targetPO.poNumber}!`);
      setTimeout(() => setSuccessMessage(null), 5000);
      setBatchModal(prev => ({ ...prev, isOpen: false }));
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STAGE {stageOrder} OF 14
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              {responsibleRole}
            </span>
            {!canManageStage && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                VIEW ONLY
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight">{stageTitle}</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">{description}</p>
        </div>

        {/* View Mode Switcher & Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 self-stretch sm:self-auto">
          <div className="flex bg-black/30 p-1 rounded-xl border border-white/10 shadow-inner">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> PO Groups &amp; Batch
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Stage Matrix Grid
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search PO, Customer, Product..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8.5 pr-3.5 py-1.5 rounded-xl text-xs bg-black/30 text-white placeholder-slate-400 border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 font-mono w-full sm:w-56 transition-all"
            />
          </div>
        </div>
      </div>

      {/* KPI Counters Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-400">Active Work Orders</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{totalStagePOs}</div>
          <div className="text-[10px] text-slate-500">{totalStageLines} active lines</div>
        </div>

        <div className="bg-white border border-emerald-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-emerald-800">Action Ready</div>
          <div className="text-xl font-black text-emerald-700 mt-0.5">{totalActionReadyLines}</div>
          <div className="text-[10px] text-emerald-600 font-medium">Ready for input</div>
        </div>

        <div className="bg-white border border-blue-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-blue-700">In Execution</div>
          <div className="text-xl font-black text-blue-800 mt-0.5">{totalStartedLines}</div>
          <div className="text-[10px] text-blue-600">Active on stage</div>
        </div>

        <div className="bg-white border border-rose-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-rose-700">Delayed / Variance</div>
          <div className="text-xl font-black text-rose-800 mt-0.5">{totalDelayedLines}</div>
          <div className="text-[10px] text-rose-600 font-medium">Schedule variance</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-500">Stage Completed</div>
          <div className="text-xl font-black text-emerald-800 mt-0.5">{totalCompletedLines}</div>
          <div className="text-[10px] text-slate-500">{completedPOGroups.length} POs passed</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] uppercase font-mono font-bold text-slate-400">Assigned Role</div>
          <div className="text-xs font-bold text-slate-800 line-clamp-1">{responsibleRole}</div>
          <div className="text-[10px] font-mono text-emerald-700 font-semibold">{canManageStage ? 'Authorized' : 'Read-Only'}</div>
        </div>
      </div>

      {/* Actionable Feedback Banners */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-xs flex items-center gap-3 font-semibold shadow-2xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs flex items-center gap-3 font-semibold shadow-2xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Filter Tabs - Defaults to Clean Active Work Queue */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterTab('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              filterTab === 'active'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            Active Orders ({activePOGroups.length})
          </button>

          <button
            onClick={() => setFilterTab('ready')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'ready'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            Ready for Action ({activePOGroups.filter(g => g.readyToStartLines > 0 || g.readyToCompleteLines > 0).length})
          </button>

          <button
            onClick={() => setFilterTab('in_progress')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              filterTab === 'in_progress'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'bg-white text-blue-800 hover:bg-blue-50 border border-blue-200'
            }`}
          >
            In Execution ({activePOGroups.filter(g => g.startedLines > 0).length})
          </button>

          <button
            onClick={() => setFilterTab('delayed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'delayed'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'bg-white text-rose-800 hover:bg-rose-50 border border-rose-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            Delayed ({activePOGroups.filter(g => g.hasDelay).length})
          </button>

          <button
            onClick={() => setFilterTab('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterTab === 'completed'
                ? 'bg-emerald-900 text-white shadow-xs'
                : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-slate-400" />
            Completed Archive ({completedPOGroups.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-mono">
          Showing {filteredPOGroups.length} PO(s)
        </div>
      </div>

      {/* VIEW MODE 1: PO-GROUPED CARDS WITH BATCH ACTIONS */}
      {viewMode === 'cards' && (
        <div className="space-y-5">
          {filteredPOGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
              {filterTab === 'completed' 
                ? `No completed orders found for stage ${stageTitle}.`
                : `No active orders currently pending action for stage ${stageTitle}. All active work is up to date!`
              }
            </div>
          ) : (
            filteredPOGroups.map(group => {
              const po = group.po;
              const defaultOpen = false;
              const isExpanded = isPOExpanded(po.id, defaultOpen);
              const showCompletedLines = Boolean(showCompletedLinesInCard[po.id]);
              const hasDelayedProducts = group.delayedLines > 0;
              const delayedProductNames = group.lines.filter(l => l.isDelayed).map(l => `${l.line.productName} (+${l.milestone.varianceDays || 0}d)`);

              // Separate active lines and completed lines to avoid clumsy congestion (only show unlocked ready lines in active view)
              const activeLines = group.lines.filter(l => !l.isDone && l.isPrereqDone);
              const completedLines = group.lines.filter(l => l.isDone);
              const linesToDisplay = showCompletedLines ? group.lines : (activeLines.length > 0 ? activeLines : (filterTab === 'completed' ? completedLines : group.lines));

              return (
                <div
                  key={po.id}
                  className={`bg-white border rounded-2xl shadow-xs transition-all overflow-hidden ${
                    group.isAllCompleted
                      ? 'border-emerald-200 bg-emerald-50/10'
                      : hasDelayedProducts
                      ? 'border-rose-200/80'
                      : group.startedLines > 0
                      ? 'border-blue-200/80'
                      : 'border-slate-200'
                  }`}
                >
                  {/* PO Accordion Header */}
                  <div className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    
                    {/* Left: PO & Customer Info */}
                    <div className="flex items-start sm:items-center gap-3">
                      <button
                        onClick={() => togglePOExpand(po.id, defaultOpen)}
                        className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 cursor-pointer mt-0.5 sm:mt-0 transition-colors"
                        title={isExpanded ? 'Collapse Product Lines' : 'Expand Product Lines'}
                      >
                        {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-700" /> : <ChevronRight className="w-5 h-5 text-slate-700" />}
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-black text-sm text-emerald-900 bg-emerald-100/70 px-2.5 py-0.5 rounded-lg border border-emerald-300">
                            {po.poNumber}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="font-bold text-slate-900 text-sm sm:text-base">{po.customerName}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-700 border border-slate-300">
                            {group.totalLines} Product Line{group.totalLines > 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1 font-mono">
                          <span>PO Date: <strong className="text-slate-700">{po.poDate}</strong></span>
                          <span>Delivery Due: <strong className="text-emerald-800">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong></span>
                          <span>Stage Progress: <strong className={group.isAllCompleted ? 'text-emerald-700' : hasDelayedProducts ? 'text-rose-700' : 'text-slate-800'}>
                            {group.completedLines}/{group.totalLines} Lines Passed
                          </strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Rollup Progress & Batch Action Controls */}
                    <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-center">
                      
                      {/* Rollup Badges */}
                      <div className="flex items-center gap-1.5">
                        {group.completedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            {group.completedLines}/{group.totalLines} Done
                          </span>
                        )}
                        {group.startedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-100 text-blue-800 border border-blue-300">
                            {group.startedLines} In Execution
                          </span>
                        )}
                        {hasDelayedProducts && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                            Delayed
                          </span>
                        )}
                        {group.lockedLines > 0 && (
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                            <Lock className="w-3 h-3 text-amber-700" />
                            {group.lockedLines} Locked
                          </span>
                        )}
                      </div>

                      {/* CLOSE ORDER BUTTON FOR FINISHED MULTI-PRODUCT ORDERS (PM / PM Baseline only) */}
                      {(activeRole === 'Project Management' || activeRole === 'Project Manager (PM Baseline)') && po.productLines.length > 0 && po.productLines.every(l => l.milestones.every(m => m.status === 'Completed' || Boolean(m.actualEndDate) || m.completionPct === 100)) && !po.isClosed && (
                        <button
                          onClick={() => setClosingPO(po)}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-md flex items-center gap-1.5 animate-pulse"
                          title="All stages finished across all product lines. Close and archive order."
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          Close Order (100% Done)
                        </button>
                      )}

                      {/* BATCH ACTION BUTTONS FOR AUTHORIZED ROLE */}
                      {canManageStage && !group.isAllCompleted && (
                        <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                          {group.readyToStartLines > 0 && (
                            <button
                              onClick={() => openBatchModal(group, 'start')}
                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
                              title="Start this stage for all ready product lines in one click"
                            >
                              <Play className="w-3 h-3 fill-current text-emerald-400" />
                              Batch Start ({group.readyToStartLines})
                            </button>
                          )}

                          {group.lines.some(l => l.isPrereqDone && !l.isDone) && (
                            <button
                              onClick={() => openBatchModal(group, 'complete')}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1.5"
                              title="Complete this stage for all ready lines in one click"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Batch Complete ({group.lines.filter(l => l.isPrereqDone && !l.isDone).length})
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Isolated Bottleneck Notice for Multi-Product Clarity */}
                  {hasDelayedProducts && group.lines.length > 1 && (
                    <div className="px-5 py-2.5 bg-rose-50/80 border-b border-rose-200/80 text-rose-950 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>
                          <strong className="font-bold text-rose-900">Multi-Product Delay:</strong> <strong className="text-rose-900 underline">{delayedProductNames.join(', ')}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Product Lines List inside PO Accordion */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 space-y-4 bg-white">
                      
                      {/* Bold Root Cause Delay & Multi-Stage Waterfall Breakdown */}
                      <DelayAnalysisFlow po={po} className="shadow-sm" />
                      
                      {/* Sub-header inside card: Toggle between Active Lines only vs All Lines */}
                      {group.completedLines > 0 && activeLines.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-slate-500 pb-1 border-b border-slate-100">
                          <span className="font-semibold text-slate-700">
                            Showing {activeLines.length} active line(s) awaiting this stage
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleShowCompletedLines(po.id)}
                            className="text-[11px] font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 cursor-pointer"
                          >
                            {showCompletedLines ? (
                              <>
                                <EyeOff className="w-3.5 h-3.5 text-slate-400" /> Hide {completedLines.length} Completed Line(s)
                              </>
                            ) : (
                              <>
                                <Eye className="w-3.5 h-3.5 text-emerald-600" /> View {completedLines.length} Completed Line(s)
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {linesToDisplay.map(({ line, milestone, isPrereqDone, isDone, isStarted }, lineIdx) => {
                        const entryKey = `${po.id}-${line.id}-${milestone.id}`;
                        const isEditing = editingKey === entryKey;

                        const msIndex = (line.milestones || []).findIndex(m => m.id === milestone.id || m.key === milestone.key);
                        const prevMilestone = msIndex > 0 ? (line.milestones || [])[msIndex - 1] : null;

                        const currVar = Math.max(0, typeof milestone.varianceDays === 'number' ? milestone.varianceDays : 0);
                        const prevVar = prevMilestone ? Math.max(0, typeof prevMilestone.varianceDays === 'number' ? prevMilestone.varianceDays : 0) : 0;
                        const stageDelta = Math.max(0, currVar - prevVar);
                        const isUnstarted = !isDone && !isStarted;
                        const isNewDelayHere = !isUnstarted && stageDelta > 0;
                        const hasInheritedShift = currVar > 0 && !isNewDelayHere;
                        const recoveredDays = isDone ? Math.max(0, prevVar - currVar) : 0;

                        const bStart = milestone.committedBaselineStartDate || po.poDate;
                        const bEnd = milestone.committedBaselineEndDate || po.committedDeliveryDate;
                        const isStartLate = Boolean(formData.startDate && formData.startDate > bStart);
                        const isEndLate = Boolean(formData.endDate && formData.endDate > bEnd);

                        const prevEffectiveEnd = prevMilestone ? (prevMilestone.actualEndDate || prevMilestone.forecastEndDate) : undefined;
                        const prevBaselineEnd = prevMilestone?.committedBaselineEndDate;
                        const activeInheritedDelay = (prevEffectiveEnd && prevBaselineEnd && prevEffectiveEnd > prevBaselineEnd)
                          ? getDaysDifference(prevBaselineEnd, prevEffectiveEnd)
                          : 0;

                        const isCardDelayed = isEditing && (
                          isEndLate ||
                          (!formData.endDate && isStartLate)
                        );
                        const cardDelayDays = isCardDelayed
                          ? (isEndLate
                              ? getDaysDifference(bEnd, formData.endDate)
                              : getDaysDifference(bStart, formData.startDate))
                          : 0;

                        return (
                          <div
                            key={entryKey}
                            className={`p-4 rounded-xl border transition-all ${
                              isDone
                                ? 'bg-emerald-50/20 border-emerald-200'
                                : !isPrereqDone
                                ? 'bg-amber-50/15 border-amber-200/70'
                                : isStarted
                                ? 'bg-blue-50/20 border-blue-200'
                                : isNewDelayHere
                                ? 'bg-rose-50/20 border-rose-200'
                                : 'bg-slate-50/50 border-slate-200'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                              
                              {/* Product Line Details */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-xs text-slate-500">#{lineIdx + 1}</span>
                                  <span className="font-bold text-slate-900 text-sm">{line.productName}</span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-50 text-purple-800 border border-purple-200">
                                    {line.designType}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                    Qty: {line.qty} Pcs
                                  </span>
                                </div>

                                {(() => {
                                  const {
                                    revisedStart: lineRevStart,
                                    revisedEnd: lineRevEnd,
                                    shiftDays: lineShiftDays,
                                    baselineStart: linePlanStart,
                                    baselineEnd: linePlanEnd,
                                    baselineDuration: linePlanDuration
                                  } = getMilestoneRevisedDates(milestone, prevMilestone, po.poDate, po.committedDeliveryDate);

                                  return (
                                    <div className="space-y-1 text-xs font-mono mt-1">
                                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
                                        <span>Planned Baseline: <strong className="text-slate-800">{linePlanStart} &rarr; {linePlanEnd}</strong> ({linePlanDuration}d planned)</span>
                                        {lineShiftDays > 0 ? (
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded border bg-amber-50 text-amber-800 border-amber-200">
                                            {isNewDelayHere && prevVar > 0
                                              ? `+${prevVar}d shift from Stage ${prevMilestone?.stageOrder || 'previous'} delay (+${stageDelta}d added here)`
                                              : isNewDelayHere
                                              ? `+${stageDelta}d delay added at this stage`
                                              : `+${lineShiftDays}d shift from Stage ${prevMilestone?.stageOrder || 'previous'} delay`}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                                            On original baseline
                                          </span>
                                        )}
                                      </div>
                                      {lineShiftDays > 0 && (
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-amber-900">
                                          <span className="text-amber-800">Revised Target: <strong className="text-amber-950">{lineRevStart} &rarr; {lineRevEnd}</strong></span>
                                          <span className="text-[10px] text-amber-700 font-medium">Shifted by schedule variance</span>
                                        </div>
                                      )}
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                                        {milestone.actualStartDate && (
                                          <span className="text-blue-700">Actual Start: <strong className="text-blue-900">{milestone.actualStartDate}</strong></span>
                                        )}
                                        {milestone.actualEndDate && (
                                          <span className="text-emerald-700">Actual End: <strong className="text-emerald-900">{milestone.actualEndDate}</strong></span>
                                        )}
                                        {milestone.docRef && (
                                          <span className="text-slate-600">Doc: <strong>{milestone.docRef}</strong></span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Status Badge & Single Line Action Buttons */}
                              <div className="flex items-center gap-2 shrink-0">
                                {!isPrereqDone ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                    <Lock className="w-3 h-3 text-amber-700" />
                                    Pending Stage {prevMilestone?.stageOrder}
                                  </span>
                                ) : isDone ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    {isNewDelayHere 
                                      ? `Completed (+${stageDelta}d delay added)` 
                                      : currVar > 0 
                                      ? (recoveredDays > 0 
                                          ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved, Previous: +${currVar}d)` 
                                          : `Completed (Previous: +${currVar}d)`)
                                      : recoveredDays > 0 
                                      ? `Completed (${recoveredDays === 1 ? '1 day' : `${recoveredDays} days`} delay resolved)` 
                                      : 'Completed'}
                                  </span>
                                ) : isStarted ? (
                                  <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                                    isNewDelayHere ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-blue-100 text-blue-800 border-blue-300'
                                  }`}>
                                    {isNewDelayHere ? `In Execution (+${stageDelta}d delay added)` : hasInheritedShift ? `In Execution (Previous: +${currVar}d)` : 'In Execution'}
                                  </span>
                                ) : isNewDelayHere ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                    Delay (+{stageDelta}d)
                                  </span>
                                ) : hasInheritedShift ? (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                    Previous (+{currVar}d)
                                  </span>
                                ) : (
                                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                    Ready to Start
                                  </span>
                                )}

                                {/* WORKING ACTION BUTTONS */}
                                {canManageStage && isPrereqDone && !isDone && (
                                  <div className="flex items-center gap-1.5">
                                    {!milestone.actualStartDate ? (
                                      <>
                                        <button
                                          onClick={() => openLineModal(po, line, 'start')}
                                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1"
                                          title="Select start date & begin stage"
                                        >
                                          <Play className="w-3.5 h-3.5 fill-current text-emerald-400" /> Start Stage...
                                        </button>
                                        <button
                                          onClick={() => openLineModal(po, line, 'complete')}
                                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                                          title="Select completion date & record finish directly"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete...
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => openLineModal(po, line, 'start')}
                                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1"
                                          title="Edit recorded start date"
                                        >
                                          <Edit3 className="w-3 h-3 text-slate-500" /> Edit Start
                                        </button>
                                        <button
                                          onClick={() => openLineModal(po, line, 'complete')}
                                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs flex items-center gap-1.5"
                                          title="Select completion date & record finish"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete...
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}

                                {canManageStage && isDone && !isEditing && (
                                  <button
                                    onClick={() => handleStartEdit(entryKey, milestone)}
                                    className="px-2.5 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Review or edit recorded dates"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Edit
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Delay Reason Tag - only shown for genuine delays originating at this stage, never for inherited/cascaded shifts */}
                            {isNewDelayHere && milestone.delayReason && !milestone.delayReason.startsWith('Cascaded') && !milestone.delayReason.startsWith('Inherited') && (
                              <div className="mt-2.5 p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-1.5 font-medium">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span><strong>Delay Reason:</strong> {milestone.delayReason}</span>
                              </div>
                            )}

                            {/* Inline Edit Form for Single Line */}
                            {isEditing && (() => {
                              const canonical = getMilestoneRevisedDates(milestone, prevMilestone, po.poDate, po.committedDeliveryDate);
                              const msPlanStart = canonical.baselineStart;
                              const msPlanEnd = canonical.baselineEnd;
                              const msPlanDuration = canonical.baselineDuration;

                              let msRevStart = canonical.revisedStart;
                              let msRevEnd = canonical.revisedEnd;

                              if (stageKey === 'material_receipt') {
                                if (formData.orderedDate) {
                                  msRevStart = formData.orderedDate;
                                  msRevEnd = formData.expectedDate || (msRevStart ? addDays(msRevStart, Math.max(0, msPlanDuration - 1)) : canonical.revisedEnd);
                                }
                                if (formData.endDate) {
                                  msRevEnd = formData.endDate;
                                }
                              } else {
                                if (formData.startDate) {
                                  msRevStart = formData.startDate;
                                  msRevEnd = formData.endDate || (msRevStart ? addDays(msRevStart, Math.max(1, msPlanDuration) - 1) : canonical.revisedEnd);
                                }
                                if (formData.endDate) {
                                  msRevEnd = formData.endDate;
                                }
                              }

                              const startShift = (msPlanStart && msRevStart && msRevStart > msPlanStart) ? getDaysDifference(msPlanStart, msRevStart) : 0;
                              const endShift = (msPlanEnd && msRevEnd && msRevEnd > msPlanEnd) ? getDaysDifference(msPlanEnd, msRevEnd) : 0;
                              const msStartShift = Math.max(startShift, endShift);

                              return (
                                <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                                      Update Stage Dates for {line.productName}
                                    </div>
                                    <span className="font-mono text-[10px] font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                                      {msPlanDuration} days planned
                                    </span>
                                  </div>

                                  <div className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1 text-xs font-mono">
                                    <div className="flex items-center justify-between text-slate-600 text-[11px]">
                                      <span>Planned Baseline: <strong className="text-slate-800">{msPlanStart} &rarr; {msPlanEnd}</strong></span>
                                      <span className="text-[10px] text-slate-500 font-semibold">{msPlanDuration} days planned</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                                      <span className={msStartShift > 0 ? "text-amber-800" : "text-emerald-700"}>
                                        Revised Target: <strong className={msStartShift > 0 ? "text-amber-950" : "text-emerald-900"}>{msRevStart} &rarr; {msRevEnd}</strong>
                                      </span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                        msStartShift > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      }`}>
                                        {msStartShift > 0 ? `+${msStartShift}d shift` : 'On original baseline'}
                                      </span>
                                    </div>
                                  </div>

                                  {stageKey === 'material_receipt' ? (
                                    <div className="p-3 bg-emerald-50/70 border border-emerald-200/90 rounded-xl space-y-3">
                                      <div className="flex items-center justify-between text-xs font-bold text-emerald-950 uppercase tracking-wider font-mono">
                                        <span className="flex items-center gap-1.5">
                                          <PackageCheck className="w-4 h-4 text-emerald-700" />
                                          Raw Material Procurement & Goods Receipt (GRN)
                                        </span>
                                        <span className="text-[10px] text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                                          Stage 7 GRN
                                        </span>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                          <div className="flex items-center justify-between mb-1">
                                            <label className="block text-[11px] font-bold text-slate-700">
                                              Material Order Date <span className="text-rose-600">*</span>
                                            </label>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const lead = line.materials?.[0]?.leadTimeDays || 14;
                                                const minD = stageOrder > 1 ? (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate) : null;
                                                const orderDate = (minD && todayStr < minD) ? minD : todayStr;
                                                setFormData(prev => ({
                                                  ...prev,
                                                  orderedDate: orderDate,
                                                  startDate: orderDate,
                                                  expectedDate: addDays(orderDate, lead)
                                                }));
                                              }}
                                              className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer"
                                            >
                                              Today
                                            </button>
                                          </div>
                                          <input
                                            type="date"
                                            min={stageOrder > 1 ? (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined) : undefined}
                                            value={formData.orderedDate || formData.startDate}
                                            onChange={e => {
                                              const val = e.target.value;
                                              const minD = stageOrder > 1 ? (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate) : null;
                                              const newOrder = (minD && val && val < minD) ? minD : val;
                                              const lead = line.materials?.[0]?.leadTimeDays || 14;
                                              const newExp = newOrder ? addDays(newOrder, lead) : formData.expectedDate;
                                              setFormData(prev => ({
                                                ...prev,
                                                orderedDate: newOrder,
                                                startDate: newOrder,
                                                expectedDate: newExp || prev.expectedDate
                                              }));
                                            }}
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                          />
                                          <p className="text-[10px] text-slate-500 mt-0.5">PO issued to supplier</p>
                                        </div>

                                        <div>
                                          <div className="flex items-center justify-between mb-1">
                                            <label className="block text-[11px] font-bold text-slate-700">
                                              Expected Delivery Date <span className="text-rose-600">*</span>
                                            </label>
                                            <span className="text-[10px] font-mono text-slate-500">+{line.materials?.[0]?.leadTimeDays || 14}d Lead</span>
                                          </div>
                                          <input
                                            type="date"
                                            value={formData.expectedDate || formData.endDate}
                                            onChange={e => setFormData(prev => ({ ...prev, expectedDate: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                          />
                                          <p className="text-[10px] text-slate-500 mt-0.5">Baseline target arrival</p>
                                        </div>

                                        <div>
                                          <div className="flex items-center justify-between mb-1">
                                            <label className="block text-[11px] font-bold text-slate-700">
                                              Actual Received Date (GRN) <span className="text-rose-600">*</span>
                                            </label>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setFormData(prev => ({
                                                  ...prev,
                                                  receivedDate: todayStr,
                                                  endDate: todayStr
                                                }));
                                              }}
                                              className="text-[10px] text-emerald-700 font-bold hover:underline cursor-pointer"
                                            >
                                              Today
                                            </button>
                                          </div>
                                          <input
                                            type="date"
                                            value={formData.receivedDate || formData.endDate}
                                            onChange={e => {
                                              const newRec = e.target.value;
                                              setFormData(prev => ({
                                                ...prev,
                                                receivedDate: newRec,
                                                endDate: newRec
                                              }));
                                            }}
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                          />
                                          <p className="text-[10px] text-slate-500 mt-0.5">Goods receipt note (GRN)</p>
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-200/60">
                                        <div>
                                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                            Incoming Quality Inspection Clearance <span className="text-rose-600">*</span>
                                          </label>
                                          <select
                                            value={formData.inspectionResult || 'Passed'}
                                            onChange={e => setFormData(prev => ({ ...prev, inspectionResult: e.target.value as any }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-semibold"
                                          >
                                            <option value="Passed">Passed (Approved for Machining)</option>
                                            <option value="Pending">Pending (Inspection in progress)</option>
                                            <option value="Rejected">Rejected (Non-conformance raised)</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                            GRN / Inspection Reference Document
                                          </label>
                                          <input
                                            type="text"
                                            placeholder="e.g. GRN-2026-9041 / MTC-001"
                                            value={formData.docRef}
                                            onChange={e => setFormData(prev => ({ ...prev, docRef: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div>
                                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                          Stage Start Date {milestone.actualStartDate ? '(Actual)' : '(Target / Actual)'}
                                        </label>
                                        <input
                                          type="date"
                                          min={stageOrder === 1 ? addDays(todayStr, -7) : (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined)}
                                          value={formData.startDate}
                                          onChange={e => {
                                            const minD = stageOrder === 1 ? addDays(todayStr, -7) : (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate);
                                            const val = e.target.value;
                                            const enforcedVal = (minD && val && val < minD) ? minD : val;
                                            setFormData(prev => ({ ...prev, startDate: enforcedVal }));
                                          }}
                                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                        />
                                      </div>

                                      <div>
                                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                          Stage End Date (Target / Actual)
                                        </label>
                                        <input
                                          type="date"
                                          min={formData.startDate || prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate || undefined}
                                          value={formData.endDate}
                                          onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                                        />
                                      </div>
                                    </div>
                                  )}

                                {isCardDelayed && (
                                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-2.5 text-xs">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                                        <span>Schedule Delay Detected (+{cardDelayDays}d late vs baseline target)</span>
                                      </div>
                                      {(() => {
                                        const netInheritedDelay = activeInheritedDelay;
                                        if (netInheritedDelay <= 0) return null;

                                        const prevMilestones = (line.milestones || []).slice(0, msIndex);
                                        const prevLineDelays = prevMilestones
                                          .map(m => {
                                            let days = 0;
                                            if (m.actualEndDate && m.committedBaselineEndDate) {
                                              days = Math.max(0, getDaysDifference(m.committedBaselineEndDate, m.actualEndDate));
                                            } else if (typeof m.varianceDays === 'number' && m.varianceDays > 0) {
                                              days = m.varianceDays;
                                            }
                                            return { ...m, calculatedDelayDays: days };
                                          })
                                          .filter(m => m.calculatedDelayDays > 0);

                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const breakdown = prevLineDelays.map(d => `Stage ${d.stageOrder}: +${d.calculatedDelayDays}d`).join(', ');
                                              const summaryText = `Inherited delay: +${netInheritedDelay}d${breakdown ? ` (${breakdown})` : ''}`;
                                              setFormData(prev => ({
                                                ...prev,
                                                delayReason: mergeDelayReason(prev.delayReason, summaryText),
                                                delayCategory: prev.delayCategory || prevLineDelays[prevLineDelays.length - 1]?.delayCategory || ''
                                              }));
                                            }}
                                            className="text-[10px] text-emerald-900 bg-white hover:bg-emerald-50 border border-emerald-300 font-bold px-2 py-0.5 rounded cursor-pointer transition-colors shadow-2xs"
                                          >
                                            Append Previous Delays (+{netInheritedDelay}d)
                                          </button>
                                        );
                                      })()}
                                    </div>

                                    {(() => {
                                      if (activeInheritedDelay <= 0) return null;
                                      const prevMilestones = (line.milestones || []).slice(0, msIndex);
                                      const prevLineDelays = prevMilestones
                                        .map((m, mIdx) => {
                                          const prevM = mIdx > 0 ? prevMilestones[mIdx - 1] : null;
                                          const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                                          const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                                          const stageDelta = currVar - prevVar;
                                          return { ...m, calculatedDelayDays: stageDelta };
                                        })
                                        .filter(m => m.calculatedDelayDays > 0);

                                      if (prevLineDelays.length === 0) return null;

                                      return (
                                        <div className="p-2 bg-amber-100/60 border border-amber-200/80 rounded-lg space-y-0.5 text-[10px] font-mono text-amber-900">
                                          <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                                          {prevLineDelays.map((d, i) => (
                                            <div key={i} className="truncate">
                                              • Stage {d.stageOrder}: {d.name.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.calculatedDelayDays}d Delay Added</strong>
                                              {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                                            </div>
                                          ))}
                                          <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                                            <span>Total Cumulative Delay:</span>
                                            <span className="text-rose-700">+{activeInheritedDelay}d</span>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-[10px] font-bold text-amber-900 mb-1">
                                          Delay Category <span className="text-slate-400 font-normal">(Optional)</span>
                                        </label>
                                        <select
                                          value={formData.delayCategory}
                                          onChange={e => setFormData(prev => ({ ...prev, delayCategory: e.target.value as DelayCategory }))}
                                          className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs bg-white"
                                        >
                                          <option value="">Select Category (Optional)...</option>
                                          {prevMilestone && <option value="Internal">Preceding Stage Delay ({prevMilestone.name})</option>}
                                          <option value="Customer">Customer Dependency</option>
                                          <option value="Supplier">Supplier Delay</option>
                                          <option value="Internal">Internal Resource Deficit</option>
                                          <option value="Design">Technical / Design Complexity</option>
                                          <option value="Production">Production / Inspection Hold</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-amber-900 mb-1">
                                          Delay Reason <span className="text-slate-400 font-normal">(Optional)</span>
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="Enter delay justification (Optional)..."
                                          value={formData.delayReason}
                                          onChange={e => setFormData(prev => ({ ...prev, delayReason: e.target.value }))}
                                          className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs bg-white"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {(() => {
                                  const prevFloor = stageOrder > 1 ? (prevMilestone?.actualEndDate || prevMilestone?.forecastEndDate) : null;
                                  const isStartInvalid = Boolean(
                                    stageOrder > 1 && prevFloor && (
                                      (formData.startDate && formData.startDate < prevFloor) ||
                                      (formData.orderedDate && formData.orderedDate < prevFloor)
                                    )
                                  );

                                  return (
                                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                                      <button
                                        type="button"
                                        onClick={() => setEditingKey(null)}
                                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                      {!milestone.actualStartDate ? (
                                        <button
                                          type="button"
                                          disabled={isStartInvalid}
                                          onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                                          className={`px-3.5 py-1.5 text-white text-xs font-bold rounded-lg flex items-center gap-1 shadow-2xs ${
                                            !isStartInvalid ? 'bg-slate-800 hover:bg-slate-900 cursor-pointer' : 'bg-slate-400 cursor-not-allowed'
                                          }`}
                                        >
                                          <Play className="w-3 h-3 fill-current" /> Save & Start Stage
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={isStartInvalid}
                                          onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, false)}
                                          className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 ${
                                            !isStartInvalid ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                          }`}
                                        >
                                          <Edit3 className="w-3.5 h-3.5" /> Save Start Date
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleSaveStageUpdate(po.id, line.id, milestone.key, true)}
                                        className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer shadow-xs flex items-center gap-1"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Record Complete
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}

                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW MODE 2: HIGH-DENSITY STAGE MATRIX GRID */}
      {viewMode === 'matrix' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900">Multi-Product Manufacturing Matrix</h2>
              <p className="text-xs text-slate-500 mt-0.5">High-density grid view of all 14 stages across every product line. Spotlighted on <strong className="text-emerald-800">{stageTitle}</strong>.</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Completed</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> In Progress</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Delayed</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span> Pending</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] font-mono">
                  <th className="py-3 px-3 min-w-44 sticky left-0 bg-slate-100/95 z-10">PO & Customer</th>
                  <th className="py-3 px-3 min-w-44">Product Line</th>
                  <th className="py-3 px-2 text-center">Qty</th>
                  {ALL_14_STAGES.map((st) => {
                    const isCurrentStageCol = st.key === stageKey;
                    return (
                      <th
                        key={st.key}
                        className={`py-3 px-2 text-center text-[10px] whitespace-nowrap ${
                          isCurrentStageCol ? 'bg-emerald-100 text-emerald-950 font-black border-x border-emerald-300' : ''
                        }`}
                      >
                        {st.label}
                      </th>
                    );
                  })}
                  <th className="py-3 px-3 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredPOGroups.flatMap(group =>
                  group.lines.map(({ line, milestone, isPrereqDone, isDone }) => {
                    const po = group.po;
                    const entryKey = `${po.id}-${line.id}-${milestone.id}`;

                    return (
                      <tr key={entryKey} className="hover:bg-slate-50 transition-colors">
                        {/* PO & Customer Column */}
                        <td className="py-2.5 px-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-100">
                          <div className="font-mono font-bold text-xs text-emerald-800">{po.poNumber}</div>
                          <div className="text-[11px] text-slate-600 truncate max-w-40" title={po.customerName}>{po.customerName}</div>
                        </td>

                        {/* Product Line */}
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          <div className="truncate max-w-44" title={line.productName}>{line.productName}</div>
                          <div className="text-[10px] font-mono text-slate-400">{line.designType}</div>
                        </td>

                        {/* Qty */}
                        <td className="py-2.5 px-2 text-center font-mono text-slate-600 font-bold">
                          {line.qty}
                        </td>

                        {/* 14 Stages Chips */}
                        {ALL_14_STAGES.map((st, sIdx) => {
                          const ms = (line.milestones || []).find(m => m.key === st.key);
                          const isStageDone = ms?.status === 'Completed' || Boolean(ms?.actualEndDate);
                          const isStageStarted = Boolean(ms?.actualStartDate) && !isStageDone;
                          const isStageDelayed = ms?.status === 'Delayed' || (typeof ms?.varianceDays === 'number' && ms.varianceDays > 0);
                          const isCurrentStageCol = st.key === stageKey;

                          return (
                            <td
                              key={st.key}
                              className={`py-2 px-1 text-center ${
                                isCurrentStageCol ? 'bg-emerald-50/50 border-x border-emerald-200' : ''
                              }`}
                            >
                              <span
                                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold transition-transform hover:scale-110 cursor-pointer ${
                                  isStageDone
                                    ? 'bg-emerald-600 text-white shadow-2xs'
                                    : isStageStarted
                                    ? isStageDelayed
                                      ? 'bg-blue-600 text-white ring-2 ring-rose-400'
                                      : 'bg-blue-600 text-white ring-2 ring-blue-300'
                                    : isStageDelayed
                                    ? 'bg-rose-500 text-white ring-1 ring-rose-300'
                                    : 'bg-slate-200 text-slate-500'
                                }`}
                                title={`${st.label}: ${ms?.status || 'Pending'} (${ms?.actualEndDate || ms?.forecastEndDate || 'Planned'})`}
                              >
                                {isStageDone ? 'Done' : isStageStarted ? 'In Prog' : isStageDelayed ? 'Delay' : sIdx + 1}
                              </span>
                            </td>
                          );
                        })}

                        {/* Quick Action Button */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {canManageStage && isPrereqDone && !isDone && (
                            <div className="flex items-center justify-end gap-1">
                              {!milestone.actualStartDate ? (
                                <button
                                  onClick={() => openLineModal(po, line, 'start')}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg cursor-pointer shadow-2xs flex items-center gap-1"
                                >
                                  <Play className="w-2.5 h-2.5 fill-current" /> Start
                                </button>
                              ) : (
                                <button
                                  onClick={() => openLineModal(po, line, 'complete')}
                                  className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg cursor-pointer shadow-2xs flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Complete
                                </button>
                              )}
                            </div>
                          )}
                          {isDone && (
                            <span className="text-[11px] font-mono font-bold text-emerald-700">Done</span>
                          )}
                          {!isPrereqDone && (
                            <span className="text-[11px] font-mono text-amber-700">Locked</span>
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
      )}

      {/* ACTION & DATE PROMPT MODAL */}
      {batchModal.isOpen && batchModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-800">
            
            {/* Modal Header */}
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between shrink-0">
              <div>
                <div className="text-[10px] font-mono font-bold uppercase text-emerald-400 tracking-wider">
                  STAGE EXECUTION • STAGE {stageOrder} OF 14 ({stageTitle})
                </div>
                <h3 className="text-lg font-black mt-0.5">
                  {batchModal.selectedLineIds.length === 1 ? (
                    batchModal.mode === 'start' ? 'Record Actual Start Date' : 'Record Actual Completion Date'
                  ) : (
                    batchModal.mode === 'start' ? 'Batch Record Start Date' : 'Batch Record Stage Completion'
                  )}
                </h3>
                <p className="text-xs text-slate-300">
                  {batchModal.po.poNumber} — {batchModal.po.customerName}
                </p>
              </div>

              <button
                onClick={() => setBatchModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-4 text-xs flex-1 overflow-y-auto min-h-0">
              
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Product Lines Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                    {batchModal.selectedLineIds.length === 1 
                      ? 'Target Product Line' 
                      : `Select Product Lines to Apply (${batchModal.selectedLineIds.length}/${batchModal.po.productLines.length})`
                    }
                  </label>
                  {batchModal.po.productLines.length > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBatchModal(prev => ({
                          ...prev,
                          selectedLineIds: batchModal.po?.productLines.filter(l => isPrereqComplete(l, stageKey)).map(l => l.id) || []
                        }))}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer"
                      >
                        Select All Ready
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => setBatchModal(prev => ({ ...prev, selectedLineIds: [] }))}
                        className="text-[10px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-3 bg-slate-50">
                  {batchModal.po.productLines.map((line, idx) => {
                    const isPrereqDone = isPrereqComplete(line, stageKey);
                    const ms = line.milestones.find(m => m.key === stageKey);
                    const isDone = ms?.status === 'Completed' || Boolean(ms?.actualEndDate);
                    const isChecked = batchModal.selectedLineIds.includes(line.id);

                    return (
                      <label
                        key={line.id}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                          !isPrereqDone ? 'opacity-50 bg-slate-100 border-slate-200 cursor-not-allowed' :
                          isChecked ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold' :
                          'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            disabled={!isPrereqDone}
                            checked={isChecked}
                            onChange={e => {
                              const isNowChecked = e.target.checked;
                              const nextSelectedIds = isNowChecked
                                ? [...batchModal.selectedLineIds, line.id]
                                : batchModal.selectedLineIds.filter(id => id !== line.id);

                              const activeLine = isNowChecked
                                ? line
                                : (batchModal.po?.productLines.find(l => nextSelectedIds.includes(l.id)) || batchModal.po?.productLines[0]);
                              const activeMat = activeLine?.materials?.find(m => m.isCriticalPath) || activeLine?.materials?.[0];
                              const activeMs = activeLine?.milestones?.find(m => m.key === stageKey);
                              const activeLead = (activeMat && typeof activeMat.leadTimeDays === 'number' && activeMat.leadTimeDays > 0)
                                ? activeMat.leadTimeDays
                                : (activeMs?.committedDurationDays || activeMs?.defaultDurationDays || 14);

                              const orderBase = batchModal.orderedDate || batchModal.date;
                              const newExpected = (orderBase && activeLead) ? addDays(orderBase, activeLead) : batchModal.expectedDate;

                              setBatchModal(prev => ({
                                ...prev,
                                selectedLineIds: nextSelectedIds,
                                expectedDate: stageKey === 'material_receipt' ? newExpected : prev.expectedDate
                              }));
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                          <span>#{idx + 1} {line.productName} ({line.designType}) — Qty: {line.qty}</span>
                        </div>

                        <span className="text-[10px] font-mono">
                          {!isPrereqDone ? 'Locked' : isDone ? 'Completed' : ms?.actualStartDate ? 'In Progress' : 'Ready'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Date Inputs & Schedule Context */}
              {(() => {
                const selectedLine = (batchModal.selectedLineIds.length > 0 
                  ? batchModal.po.productLines.find(l => batchModal.selectedLineIds.includes(l.id))
                  : null) || batchModal.po.productLines[0];

                const selectedMat = selectedLine?.materials?.find(m => m.isCriticalPath) || selectedLine?.materials?.[0];
                const selectedMs = selectedLine?.milestones.find(m => m.key === stageKey);

                const selectedLeadTime = (selectedMat && typeof selectedMat.leadTimeDays === 'number' && selectedMat.leadTimeDays > 0)
                  ? selectedMat.leadTimeDays
                  : (selectedMs?.committedDurationDays || selectedMs?.defaultDurationDays || (selectedMs?.committedBaselineStartDate && selectedMs?.committedBaselineEndDate ? (getDaysDifference(selectedMs.committedBaselineStartDate, selectedMs.committedBaselineEndDate) + 1) : 14));

                const msPlanStart = selectedMs?.committedBaselineStartDate || batchModal.po.poDate;
                const msPlanEnd = selectedMs?.committedBaselineEndDate || batchModal.po.committedDeliveryDate;
                const msPlanDuration = stageKey === 'material_receipt'
                  ? selectedLeadTime
                  : (selectedMs?.committedDurationDays || (msPlanStart && msPlanEnd ? (getDaysDifference(msPlanStart, msPlanEnd) + 1) : 1));

                const sampleMsIdx = selectedLine ? selectedLine.milestones.findIndex(m => m.key === stageKey) : -1;
                const samplePrevMs = sampleMsIdx > 0 ? selectedLine.milestones[sampleMsIdx - 1] : null;
                const samplePrevEnd = samplePrevMs?.actualEndDate || samplePrevMs?.forecastEndDate;
                const chainedEarliestStart = samplePrevEnd ? addDays(samplePrevEnd, 1) : undefined;
                const defaultRevStart = (chainedEarliestStart && msPlanStart && chainedEarliestStart > msPlanStart)
                  ? chainedEarliestStart
                  : (selectedMs?.forecastStartDate || selectedMs?.actualStartDate || msPlanStart || '');

                // Canonical stable target benchmark — does not mutate until confirmed
                const canonicalDates = selectedMs
                  ? getMilestoneRevisedDates(selectedMs, samplePrevMs, batchModal.po.poDate, batchModal.po.committedDeliveryDate)
                  : {
                      revisedStart: defaultRevStart,
                      revisedEnd: msPlanEnd,
                      shiftDays: (chainedEarliestStart && msPlanStart && chainedEarliestStart > msPlanStart) ? getDaysDifference(msPlanStart, chainedEarliestStart) : 0
                    };

                const msRevStart = canonicalDates.revisedStart || defaultRevStart;
                const msRevEnd = canonicalDates.revisedEnd || msPlanEnd;
                const sampleShiftDays = canonicalDates.shiftDays;

                const livePO = purchaseOrders.find(p => p.id === batchModal.po?.id) || batchModal.po;
                const selectedLinesForBatch = livePO
                  ? livePO.productLines.filter(l => batchModal.selectedLineIds.includes(l.id))
                  : [];
                let authoritativePrevEnd = '';
                selectedLinesForBatch.forEach(l => {
                  const mIdx = (l.milestones || []).findIndex(ms => ms.key === stageKey);
                  if (mIdx > 0) {
                    const prev = l.milestones[mIdx - 1];
                    const prevEndCandidate = prev?.actualEndDate || prev?.forecastEndDate;
                    if (prevEndCandidate && (!authoritativePrevEnd || prevEndCandidate > authoritativePrevEnd)) {
                      authoritativePrevEnd = prevEndCandidate;
                    }
                  }
                });
                if (!authoritativePrevEnd) {
                  authoritativePrevEnd = samplePrevEnd || '';
                }

                const batchMinDate = batchModal.mode === 'start'
                  ? (authoritativePrevEnd || selectedMs?.committedBaselineStartDate || livePO?.poDate)
                  : (selectedMs?.actualStartDate || authoritativePrevEnd || selectedMs?.committedBaselineStartDate || livePO?.poDate);

                return (
                  <div>
                    {stageKey === 'material_receipt' ? (
                      <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3 mb-3">
                        <div className="text-xs font-bold text-emerald-950 uppercase tracking-wider font-mono flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <PackageCheck className="w-4 h-4 text-emerald-700" />
                            Stores Raw Material Receipt & GRN Verification
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                              Stage 7 (GRN)
                            </span>
                            <span className="text-[10px] text-blue-800 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded font-mono font-bold">
                              Lead Time: {selectedLeadTime}d ({selectedLine?.productName})
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-bold text-slate-700">
                                Material Order Date <span className="text-rose-600">*</span>
                              </label>
                              <span className="text-[10px] font-mono text-slate-500">
                                Plan: <strong className="text-slate-700">{msPlanStart}</strong>
                              </span>
                            </div>
                            <input
                              type="date"
                              min={authoritativePrevEnd || samplePrevEnd || selectedMs?.committedBaselineStartDate || livePO?.poDate}
                              value={batchModal.orderedDate || batchModal.date}
                              onChange={e => {
                                const val = e.target.value;
                                const minFloor = authoritativePrevEnd || samplePrevEnd || selectedMs?.committedBaselineStartDate;
                                const enforcedVal = (minFloor && val && val < minFloor) ? minFloor : val;
                                const newExp = enforcedVal ? addDays(enforcedVal, selectedLeadTime) : batchModal.expectedDate;
                                setBatchModal(prev => ({
                                  ...prev,
                                  orderedDate: enforcedVal,
                                  date: prev.mode === 'start' ? enforcedVal : prev.date,
                                  expectedDate: newExp || prev.expectedDate
                                }));
                              }}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                            />
                            <div className="flex items-center justify-between text-[10px] mt-0.5 font-mono">
                              <span className="text-slate-500">PO issued to supplier</span>
                              <span className={sampleShiftDays > 0 ? "text-amber-800 font-bold" : "text-emerald-700 font-bold"}>
                                Rev: {msRevStart}
                              </span>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-bold text-slate-700">
                                Expected Delivery Date <span className="text-rose-600">*</span>
                              </label>
                              <span className="text-[10px] font-mono text-slate-500">
                                Plan: <strong className="text-slate-700">{msPlanEnd}</strong>
                              </span>
                            </div>
                            <input
                              type="date"
                              min={batchModal.orderedDate || batchMinDate}
                              value={batchModal.expectedDate || batchModal.date}
                              onChange={e => setBatchModal(prev => ({ ...prev, expectedDate: e.target.value }))}
                              className="w-full px-2.5 py-1.5 border border-emerald-400 bg-white rounded-lg text-xs font-mono font-bold text-emerald-950 focus:ring-1 focus:ring-emerald-500"
                            />
                            <div className="flex items-center justify-between text-[10px] mt-0.5 font-mono">
                              <span className="text-emerald-800 font-bold bg-emerald-100/70 px-1 rounded">Crossing Line</span>
                              <span className={sampleShiftDays > 0 ? "text-amber-800 font-bold" : "text-emerald-700 font-bold"}>
                                Rev: {msRevEnd}
                              </span>
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-bold text-slate-700">
                                Actual Received Date (GRN) {batchModal.mode === 'complete' && <span className="text-rose-600">*</span>}
                              </label>
                              <span className="text-[10px] font-mono text-slate-600">
                                Target: <strong className="text-emerald-800">{batchModal.expectedDate || msRevEnd}</strong>
                              </span>
                            </div>
                            <input
                              type="date"
                              min={batchModal.orderedDate || batchMinDate}
                              value={batchModal.receivedDate || (batchModal.mode === 'complete' ? batchModal.date : '')}
                              onChange={e => setBatchModal(prev => ({
                                ...prev,
                                receivedDate: e.target.value,
                                date: prev.mode === 'complete' ? e.target.value : prev.date
                              }))}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono font-bold text-slate-800"
                            />
                            <div className="flex items-center justify-between text-[10px] mt-0.5 font-mono">
                              <span className="text-slate-500">Receipt at Stores</span>
                              <span className="text-slate-600">
                                {batchModal.receivedDate && batchModal.expectedDate && batchModal.receivedDate > batchModal.expectedDate
                                  ? `+${getDaysDifference(batchModal.expectedDate, batchModal.receivedDate)}d beyond target`
                                  : 'Within expected delivery'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-200/60">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Incoming Quality Inspection Clearance
                            </label>
                            <select
                              value={batchModal.inspectionResult || 'Passed'}
                              onChange={e => setBatchModal(prev => ({ ...prev, inspectionResult: e.target.value as any }))}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-semibold"
                            >
                              <option value="Passed">Passed (Approved for Machining)</option>
                              <option value="Pending">Pending (Inspection in progress)</option>
                              <option value="Rejected">Rejected (Non-conformance raised)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              GRN / Verification Document Ref
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. GRN-2026-8801"
                              value={batchModal.docRef}
                              onChange={e => setBatchModal(prev => ({ ...prev, docRef: e.target.value }))}
                              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-[11px] font-bold text-slate-700">
                            {batchModal.mode === 'start' ? 'Actual Start Date' : 'Actual Completion Date'} <span className="text-rose-600">*</span>
                          </label>
                          <div className="flex items-center gap-2 text-[10px] font-mono">
                            <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              Planned: <strong>{batchModal.mode === 'start' ? msPlanStart : msPlanEnd}</strong>
                            </span>
                            <span className={sampleShiftDays > 0 ? "text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold" : "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold"}>
                              Revised Target: <strong>{batchModal.mode === 'start' ? msRevStart : msRevEnd}</strong>
                            </span>
                          </div>
                        </div>
                        <input
                          type="date"
                          min={batchMinDate}
                          value={batchModal.date}
                          onChange={e => {
                            const val = e.target.value;
                            const enforcedVal = (batchModal.mode === 'start' && batchMinDate && val && val < batchMinDate)
                              ? batchMinDate
                              : val;
                            setBatchModal(prev => ({ ...prev, date: enforcedVal }));
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white font-mono font-bold text-slate-800 focus:border-emerald-600"
                        />
                        {Boolean(batchMinDate && batchModal.date && batchModal.date < batchMinDate) && (
                          <p className="text-[11px] text-rose-600 font-bold mt-1 flex items-center gap-1 font-mono">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {batchModal.mode === 'start'
                              ? `Start date cannot be earlier than previous milestone completion (${batchMinDate}).`
                              : `Completion date cannot be earlier than start date (${batchMinDate}).`}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Planned Baseline: <strong className="text-slate-800">{msPlanStart} &rarr; {msPlanEnd}</strong></span>
                        <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {msPlanDuration} days planned
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                        <span className={sampleShiftDays > 0 ? "text-amber-800" : "text-emerald-700"}>
                          Revised Target: <strong className={sampleShiftDays > 0 ? "text-amber-950" : "text-emerald-900"}>{msRevStart} &rarr; {msRevEnd}</strong>
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                          sampleShiftDays > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                        }`}>
                          {sampleShiftDays > 0 ? `+${sampleShiftDays}d shift` : 'On original baseline'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Delay Reason & Previous Delays Section */}
              {(() => {
                const livePO = purchaseOrders.find(p => p.id === batchModal.po?.id) || batchModal.po;
                const selectedLines = livePO ? livePO.productLines.filter(l => batchModal.selectedLineIds.includes(l.id)) : [];
                
                const allPreviousDelays = selectedLines.flatMap(l => {
                  const idx = (l.milestones || []).findIndex(m => m.key === stageKey);
                  const preceding = (l.milestones || []).slice(0, idx);
                  return preceding.map((m, mIdx) => {
                    const prevM = mIdx > 0 ? preceding[mIdx - 1] : null;
                    const currVar = Math.max(0, typeof m.varianceDays === 'number' ? m.varianceDays : 0);
                    const prevVar = prevM ? Math.max(0, typeof prevM.varianceDays === 'number' ? prevM.varianceDays : 0) : 0;
                    const stageDelta = currVar - prevVar;
                    return {
                      lineName: l.productName,
                      stageOrder: m.stageOrder,
                      stageName: m.name,
                      addedDelayDays: stageDelta,
                      delayReason: m.delayReason
                    };
                  }).filter(m => m.addedDelayDays > 0);
                });

                const stageMap = new Map<number, { stageOrder: number; stageName: string; addedDelay: number; delayReason?: string }>();
                allPreviousDelays.forEach(d => {
                  const existing = stageMap.get(d.stageOrder);
                  if (!existing) {
                    stageMap.set(d.stageOrder, {
                      stageOrder: d.stageOrder,
                      stageName: d.stageName,
                      addedDelay: d.addedDelayDays,
                      delayReason: d.delayReason
                    });
                  } else {
                    existing.addedDelay = Math.max(existing.addedDelay, d.addedDelayDays);
                  }
                });

                let maxTotalDelay = 0;
                let maxNetInheritedDelay = 0;
                let maxNewDelayFormed = 0;
                let maxResolvedDelay = 0;
                let maxNetRemainingDelay = 0;

                selectedLines.forEach(l => {
                  const mIdx = (l.milestones || []).findIndex(ms => ms.key === stageKey);
                  const ms = l.milestones[mIdx];
                  if (!ms) return;
                  const prevM = mIdx > 0 ? l.milestones[mIdx - 1] : null;
                  const prevEnd = prevM?.actualEndDate || prevM?.forecastEndDate;

                  const baselineStart = ms.committedBaselineStartDate || livePO?.poDate;
                  const baselineEnd = ms.committedBaselineEndDate || livePO?.committedDeliveryDate;

                  const plannedDuration = ms.committedDurationDays || (baselineStart && baselineEnd ? (getDaysDifference(baselineStart, baselineEnd) + 1) : 1);

                  // Canonical target dates
                  const canonical = getMilestoneRevisedDates(ms, prevM, livePO?.poDate, livePO?.committedDeliveryDate);
                  const canonicalTargetStart = canonical.revisedStart || (prevEnd ? addDays(prevEnd, 1) : baselineStart) || '';
                  const canonicalTargetEnd = canonical.revisedEnd || (canonicalTargetStart ? addDays(canonicalTargetStart, Math.max(1, plannedDuration) - 1) : baselineEnd) || '';
                  const inheritedShift = canonical.shiftDays;

                  let newDelay = 0;
                  let inheritedDelay = inheritedShift;
                  let resolvedDelay = 0;
                  let netRemainingDelay = 0;

                  if (stageKey === 'material_receipt') {
                    const mat = l.materials?.find(m => m.isCriticalPath) || l.materials?.[0];
                    const lineLead = (mat && typeof mat.leadTimeDays === 'number' && mat.leadTimeDays > 0)
                      ? mat.leadTimeDays
                      : (ms.committedDurationDays || 14);

                    const chainedEarliest = prevEnd ? addDays(prevEnd, 1) : undefined;
                    const targetStart = (chainedEarliest && baselineStart && chainedEarliest > baselineStart)
                      ? chainedEarliest
                      : (canonicalTargetStart || baselineStart || '');
                    const targetDelivery = targetStart ? addDays(targetStart, Math.max(0, lineLead - 1)) : (canonicalTargetEnd || baselineEnd);
                    const crossingLine = batchModal.expectedDate || targetDelivery || baselineEnd;

                    if (batchModal.mode === 'start') {
                      const orderDate = batchModal.orderedDate || batchModal.date;
                      if (orderDate && targetStart && orderDate > targetStart) {
                        newDelay = getDaysDifference(targetStart, orderDate);
                        netRemainingDelay = inheritedDelay + newDelay;
                      } else if (orderDate && targetStart && orderDate <= targetStart) {
                        newDelay = 0;
                        if (baselineStart && orderDate > baselineStart) {
                          netRemainingDelay = getDaysDifference(baselineStart, orderDate);
                          resolvedDelay = Math.max(0, inheritedDelay - netRemainingDelay);
                        } else {
                          netRemainingDelay = 0;
                          resolvedDelay = inheritedDelay;
                        }
                      } else {
                        netRemainingDelay = inheritedDelay;
                      }
                    } else {
                      const recDate = batchModal.receivedDate || batchModal.date;
                      if (recDate && crossingLine && recDate > crossingLine) {
                        newDelay = getDaysDifference(crossingLine, recDate);
                        netRemainingDelay = inheritedDelay + newDelay;
                      } else if (recDate && crossingLine && recDate <= crossingLine) {
                        newDelay = 0;
                        if (baselineEnd && recDate > baselineEnd) {
                          netRemainingDelay = getDaysDifference(baselineEnd, recDate);
                          resolvedDelay = Math.max(0, inheritedDelay - netRemainingDelay);
                        } else {
                          netRemainingDelay = 0;
                          resolvedDelay = inheritedDelay;
                        }
                      } else {
                        netRemainingDelay = inheritedDelay;
                      }
                    }
                  } else if (batchModal.mode === 'start') {
                    const chainedEarliest = prevEnd ? addDays(prevEnd, 1) : undefined;
                    const targetStart = (chainedEarliest && baselineStart && chainedEarliest > baselineStart)
                      ? chainedEarliest
                      : (canonicalTargetStart || baselineStart || '');
                    const startDate = batchModal.date;
                    if (targetStart && startDate && startDate > targetStart) {
                      newDelay = getDaysDifference(targetStart, startDate);
                      netRemainingDelay = inheritedDelay + newDelay;
                    } else if (targetStart && startDate && startDate <= targetStart) {
                      newDelay = 0;
                      if (baselineStart && startDate > baselineStart) {
                        netRemainingDelay = getDaysDifference(baselineStart, startDate);
                        resolvedDelay = Math.max(0, inheritedDelay - netRemainingDelay);
                      } else {
                        netRemainingDelay = 0;
                        resolvedDelay = inheritedDelay;
                      }
                    } else {
                      netRemainingDelay = inheritedDelay;
                    }
                  } else {
                    const effectiveStart = ms.actualStartDate || (prevEnd ? addDays(prevEnd, 1) : baselineStart);
                    const targetEnd = canonicalTargetEnd || ms.forecastEndDate || (effectiveStart ? addDays(effectiveStart, Math.max(1, plannedDuration) - 1) : baselineEnd);
                    const compDate = batchModal.date;

                    if (targetEnd && compDate && compDate > targetEnd) {
                      newDelay = getDaysDifference(targetEnd, compDate);
                      netRemainingDelay = inheritedDelay + newDelay;
                    } else if (targetEnd && compDate && compDate <= targetEnd) {
                      newDelay = 0;
                      if (baselineEnd && compDate > baselineEnd) {
                        netRemainingDelay = getDaysDifference(baselineEnd, compDate);
                        resolvedDelay = Math.max(0, inheritedDelay - netRemainingDelay);
                      } else {
                        netRemainingDelay = 0;
                        resolvedDelay = inheritedDelay;
                      }
                    } else {
                      netRemainingDelay = inheritedDelay;
                    }
                  }

                  if (netRemainingDelay > maxNetRemainingDelay) maxNetRemainingDelay = netRemainingDelay;
                  if (inheritedDelay > maxNetInheritedDelay) maxNetInheritedDelay = inheritedDelay;
                  if (newDelay > maxNewDelayFormed) maxNewDelayFormed = newDelay;
                  if (resolvedDelay > maxResolvedDelay) maxResolvedDelay = resolvedDelay;
                });

                maxTotalDelay = maxNetRemainingDelay;

                // Preceding delay sources are ONLY shown if this stage actually inherited a delay!
                const consolidatedPreviousDelays = maxNetInheritedDelay > 0
                  ? Array.from(stageMap.values()).sort((a, b) => a.stageOrder - b.stageOrder)
                  : [];

                // 1. ALL DELAYS RESOLVED / ON BASELINE SCHEDULE (0d net delay)
                if (maxTotalDelay <= 0) {
                  return (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-emerald-950 text-[11px]">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            {maxNetInheritedDelay > 0 
                              ? `Schedule Fully Recovered: All prior delay resolved! (+${maxNetInheritedDelay}d recovered at Stage ${stageOrder})`
                              : `Schedule Status: On Track — Selected date is within planned schedule.`}
                          </span>
                        </div>
                        <span className="font-mono font-bold text-emerald-700 text-[10px] bg-white px-2 py-0.5 rounded border border-emerald-300">
                          0d Delay
                        </span>
                      </div>

                      {maxNetInheritedDelay > 0 && consolidatedPreviousDelays.length > 0 && (
                        <div className="p-2 bg-emerald-100/60 border border-emerald-200 rounded-lg space-y-1 text-[10px] font-mono text-emerald-900">
                          <div className="font-bold text-emerald-950">Prior Delay Resolution:</div>
                          {consolidatedPreviousDelays.map((d, i) => (
                            <div key={i} className="truncate">
                              • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <span className="line-through text-slate-500">+{d.addedDelay}d</span> <strong className="text-emerald-700">Resolved</strong>
                            </div>
                          ))}
                          <div className="pt-0.5 font-bold text-emerald-950 border-t border-emerald-300/60 flex justify-between">
                            <span>Net Cumulative Delay:</span>
                            <span className="text-emerald-700 font-bold">0d (On Time)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // 2. PARTIAL DELAY RESOLUTION / SCHEDULE ACCELERATED (Resolved some inherited delay)
                if (maxResolvedDelay > 0 && maxNetRemainingDelay > 0) {
                  return (
                    <div className="p-3.5 bg-teal-50/90 border border-teal-300 rounded-xl space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-teal-950 text-[11px] flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                          <span>
                            Schedule Accelerated: <strong className="text-teal-700 font-mono">+{maxResolvedDelay}d Delay Resolved</strong> (Net delay reduced from +{maxNetInheritedDelay}d to +{maxNetRemainingDelay}d)
                          </span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-teal-900 bg-white px-2 py-0.5 rounded border border-teal-300">
                          Net Delay: +{maxNetRemainingDelay}d
                        </span>
                      </div>

                      {consolidatedPreviousDelays.length > 0 && (
                        <div className="p-2 bg-teal-100/50 border border-teal-200 rounded-lg space-y-1 text-[10px] font-mono text-teal-900">
                          <div className="font-bold text-teal-950">Preceding Delay Sources & Resolution:</div>
                          {consolidatedPreviousDelays.map((d, i) => (
                            <div key={i} className="truncate">
                              • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.addedDelay}d Delay Added</strong>
                              {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                            </div>
                          ))}
                          <div className="truncate text-teal-800 font-semibold">
                            • Stage {stageOrder}: {stageTitle.replace(/^\d+\.\s*/, '')}: <strong className="text-emerald-700">-{maxResolvedDelay}d Delay Resolved</strong> (Ahead of revised target)
                          </div>
                          <div className="pt-0.5 font-bold text-teal-950 border-t border-teal-200 flex justify-between">
                            <span>Net Cumulative Delay:</span>
                            <span className="text-amber-800 font-bold">+{maxNetRemainingDelay}d</span>
                          </div>
                        </div>
                      )}

                      <div className="pt-1">
                        <input
                          type="text"
                          placeholder="Optional remarks or notes (e.g. Completed early to recover schedule)..."
                          value={batchModal.delayReason}
                          onChange={e => setBatchModal(prev => ({ ...prev, delayReason: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-teal-300 rounded-lg text-xs bg-white font-medium placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  );
                }

                // 3. INHERITED DELAY ONLY (No new delay formed, completed on target)
                if (maxNewDelayFormed <= 0 && maxNetInheritedDelay > 0) {
                  return (
                    <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-blue-950 text-[11px] flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-blue-600" />
                          <span>Preceding Delay: <strong className="text-rose-700 font-mono">+{maxNetInheritedDelay}d Inherited</strong> (No new delay formed at Stage {stageOrder})</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-300">
                          Total Delay: +{maxTotalDelay}d
                        </span>
                      </div>

                      {consolidatedPreviousDelays.length > 0 && (
                        <div className="p-2 bg-blue-100/60 border border-blue-200/80 rounded-lg space-y-1 text-[10px] font-mono text-blue-900">
                          <div className="font-bold text-blue-950">Preceding Delay Sources:</div>
                          {consolidatedPreviousDelays.map((d, i) => (
                            <div key={i} className="truncate">
                              • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.addedDelay}d Delay Added</strong>
                              {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                            </div>
                          ))}
                          <div className="pt-0.5 font-bold text-blue-950 border-t border-blue-200/60 flex justify-between">
                            <span>Total Cumulative Delay:</span>
                            <span className="text-rose-700 font-bold">+{maxTotalDelay}d</span>
                          </div>
                        </div>
                      )}

                      <div className="pt-1">
                        <input
                          type="text"
                          placeholder="Optional remarks or notes..."
                          value={batchModal.delayReason}
                          onChange={e => setBatchModal(prev => ({ ...prev, delayReason: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs bg-white font-medium placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  );
                }

                // 3. NEW DELAY FORMED AT THIS STAGE (Exceeded planned target)
                return (
                  <div className="p-3.5 bg-rose-50/90 border border-rose-300 rounded-xl space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-rose-950 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>New Delay Formed at Stage {stageOrder}: <strong className="text-rose-700 font-mono">+{maxNewDelayFormed}d Added</strong></span>
                      </div>
                      {maxNetInheritedDelay > 0 && (
                        <span className="text-[10px] font-mono text-slate-500">
                          (+{maxNetInheritedDelay}d prior inherited)
                        </span>
                      )}
                    </div>

                    {consolidatedPreviousDelays.length > 0 && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-[10px] font-mono text-amber-900">
                        <div className="font-bold text-amber-950">Preceding Delay Sources:</div>
                        {consolidatedPreviousDelays.map((d, i) => (
                          <div key={i} className="truncate">
                            • Stage {d.stageOrder}: {d.stageName.replace(/^\d+\.\s*/, '')}: <strong className="text-rose-700">+{d.addedDelay}d Delay Added</strong>
                            {d.delayReason && <span className="text-slate-600 font-normal"> — {d.delayReason}</span>}
                          </div>
                        ))}
                        <div className="pt-0.5 font-bold text-amber-950 border-t border-amber-200/60 flex justify-between">
                          <span>Total Cumulative Delay:</span>
                          <span className="text-rose-700 font-bold">+{maxTotalDelay}d</span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        value={batchModal.delayCategory}
                        onChange={e => setBatchModal(prev => ({ ...prev, delayCategory: e.target.value as DelayCategory }))}
                        className="w-full px-2.5 py-1.5 border border-rose-300 rounded-lg text-xs bg-white font-medium"
                      >
                        <option value="">Select Delay Category (Optional)</option>
                        <option value="Customer">Customer Dependency</option>
                        <option value="Supplier">Supplier Delay</option>
                        <option value="Internal">Internal Resource Deficit</option>
                        <option value="Design">Technical / Design Complexity</option>
                        <option value="Production">Production / Inspection Hold</option>
                      </select>

                      <input
                        type="text"
                        placeholder={`Reason for +${maxNewDelayFormed}d delay on Stage ${stageOrder} *`}
                        value={batchModal.delayReason}
                        onChange={e => setBatchModal(prev => ({ ...prev, delayReason: e.target.value }))}
                        className="w-full px-2.5 py-1.5 border border-rose-300 rounded-lg text-xs bg-white font-bold text-slate-800 focus:border-rose-600 placeholder:font-normal placeholder:text-rose-400"
                        required
                      />
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-[11px] font-mono text-slate-500">
                Applying to {batchModal.selectedLineIds.length} line(s)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                {(() => {
                  const livePO = purchaseOrders.find(p => p.id === batchModal.po?.id) || batchModal.po;
                  const selectedLines = livePO ? livePO.productLines.filter(l => batchModal.selectedLineIds.includes(l.id)) : [];
                  let highestPrevEnd = '';
                  selectedLines.forEach(l => {
                    const mIdx = (l.milestones || []).findIndex(ms => ms.key === stageKey);
                    if (mIdx > 0) {
                      const p = l.milestones[mIdx - 1];
                      const pEnd = p?.actualEndDate || p?.forecastEndDate;
                      if (pEnd && (!highestPrevEnd || pEnd > highestPrevEnd)) {
                        highestPrevEnd = pEnd;
                      }
                    }
                  });
                  const targetMs = selectedLines[0]?.milestones.find(m => m.key === stageKey);
                  const activeMinFloor = batchModal.mode === 'start'
                    ? (highestPrevEnd || targetMs?.committedBaselineStartDate || livePO?.poDate)
                    : (targetMs?.actualStartDate || highestPrevEnd || livePO?.poDate);
                  const isDateInvalid = Boolean(activeMinFloor && batchModal.date && batchModal.date < activeMinFloor);
                  const isDisabled = batchModal.selectedLineIds.length === 0 || !batchModal.date || isDateInvalid;

                  return (
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={handleExecuteBatch}
                      className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 ${
                        !isDisabled
                          ? 'bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer'
                          : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {batchModal.selectedLineIds.length === 1 
                        ? `Confirm & Record ${batchModal.mode === 'start' ? 'Start' : 'Complete'}`
                        : `Apply to ${batchModal.selectedLineIds.length} Product Line(s)`
                      }
                    </button>
                  );
                })()}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Close Order Modal */}
      {closingPO && (
        <CloseOrderModal
          isOpen={Boolean(closingPO)}
          onClose={() => setClosingPO(null)}
          po={closingPO}
        />
      )}

    </div>
  );
};
