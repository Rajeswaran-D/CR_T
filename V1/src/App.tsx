import React, { useState, useRef } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import type { ModuleType } from "./components/layout/Sidebar";
import { SystemBlueprintModal } from "./components/layout/SystemBlueprintModal";
import { SystemTestRunner } from "./components/common/SystemTestRunner";
import { ManualInputModal } from "./components/modals/ManualInputModal";
import { PODetailDrawer } from "./components/modals/PODetailDrawer";
import { CancelOrderModal } from "./components/modals/CancelOrderModal";

import { DashboardModule } from "./components/modules/DashboardModule";
import { OrderIntakeModule } from "./components/modules/OrderIntakeModule";
import { ProductCatalogModule } from "./components/modules/ProductCatalogModule";
import { MilestoneModuleView } from "./components/modules/MilestoneModuleView";
import { BaselinePlanningModule } from "./components/modules/BaselinePlanningModule";
import { AdministrationModule } from "./components/modules/AdministrationModule";
import { getPOManufacturingStatus } from "./utils/statusUtils";

import type { PurchaseOrder, ProductLine, Milestone, Role } from "./types";

const MainAppContent: React.FC = () => {
  const { purchaseOrders, showBlueprintModal, setShowBlueprintModal, activeRole } = useApp();

  const [activeModule, setActiveModule] = useState<ModuleType>(() => {
    try {
      const saved = sessionStorage.getItem('cft_active_module') || localStorage.getItem('cft_active_module');
      if (saved) return saved as ModuleType;
    } catch {}
    return "Dashboard";
  });

  const [showTestRunnerModal, setShowTestRunnerModal] = useState<boolean>(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [cancelModalPO, setCancelModalPO] = useState<PurchaseOrder | null>(null);

  const prevRoleRef = useRef<Role>(activeRole);

  const handleSelectModule = (mod: ModuleType) => {
    setActiveModule(mod);
    try {
      sessionStorage.setItem('cft_active_module', mod);
      localStorage.setItem('cft_active_module', mod);
    } catch {}
  };

  React.useEffect(() => {
    // Only auto-switch module if user explicitly changed their active role
    if (prevRoleRef.current !== activeRole) {
      prevRoleRef.current = activeRole;
      if (activeModule === 'Dashboard') return;

      const ROLE_MODULE_MAP: Record<Role, ModuleType> = {
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
        'Stores (Shipment)':            '14. Final Shipment & Dispatch',
        'Project Management':           'Administration & Governance'
      };

      const allowedModule = ROLE_MODULE_MAP[activeRole];
      if (allowedModule && activeModule !== allowedModule) {
        handleSelectModule(allowedModule);
      }
    }
  }, [activeRole, activeModule]);

  const [manualInputState, setManualInputState] = useState<{
    isOpen: boolean;
    po: PurchaseOrder | null;
    productLine: ProductLine | null;
    milestone: Milestone | null;
    eventType: "start" | "complete";
  }>({ isOpen: false, po: null, productLine: null, milestone: null, eventType: "start" });

  const handleOpenManualInput = (po: PurchaseOrder, line: ProductLine, ms: Milestone, type: "start" | "complete") => {
    setManualInputState({ isOpen: true, po, productLine: line, milestone: ms, eventType: type });
  };

  const handleCloseManualInput = () => {
    setManualInputState({ isOpen: false, po: null, productLine: null, milestone: null, eventType: "start" });
  };

  const delayedOrders = purchaseOrders
    .map(po => ({ po, summary: getPOManufacturingStatus(po) }))
    .filter(({ summary }) => summary.isDelayed);
  const delayedCount = delayedOrders.length;
  const atRiskCount = purchaseOrders.filter(p => p.status === "At Risk").length;
  const delayedSummary = delayedOrders.length > 0
    ? delayedOrders.map(({ po, summary }) => `${po.poNumber}: ${summary.delayedStageName || summary.currentStageName} +${summary.delayDays}d`).join(' | ')
    : undefined;
  const selectedPO = selectedPOId ? purchaseOrders.find(po => po.id === selectedPOId) || null : null;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 font-sans text-slate-800 overflow-hidden select-none">
      <Header onOpenTestsModal={() => setShowTestRunnerModal(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} setActiveModule={handleSelectModule} delayedCount={delayedCount} atRiskCount={atRiskCount} delayedSummary={delayedSummary} />
        <main className="flex-1 bg-slate-50 overflow-y-auto">
          {activeModule === "Dashboard" && (
            <DashboardModule 
              onSelectPO={(po) => setSelectedPOId(po.id)} 
              onNavigateModule={(mod) => handleSelectModule(mod as any)} 
              onOpenCancelModal={(po) => setCancelModalPO(po)}
            />
          )}
          {activeModule === "Administration & Governance" && (
            <AdministrationModule onSelectPO={(po) => setSelectedPOId(po.id)} />
          )}
          {activeModule === "1. Customer Purchase Order (PO)" && <OrderIntakeModule />}
          {activeModule === "2. Baseline Review & Planning" && (
            <BaselinePlanningModule />
          )}
          {activeModule === "3. CORB Release" && (
            <MilestoneModuleView stageKey="corb_release" stageTitle="3. CORB Release" stageOrder={3} responsibleRole="AE (CORB Release)" description="Verify Change Order / Review Board documentation, sign off specifications, and assign milestone dates." />
          )}
          {activeModule === "4. BOM Release" && (
            <MilestoneModuleView stageKey="bom_release" stageTitle="4. BOM Release" stageOrder={4} responsibleRole="DE (BOM Release)" description="Verify Bill of Materials structure, engineering drawing revisions, and release design packages." />
          )}
          {activeModule === "5. Work Order (WO) Release" && (
            <MilestoneModuleView stageKey="wo_release" stageTitle="5. Work Order (WO) Release" stageOrder={5} responsibleRole="Planner (WO Release)" description="Issue Work Orders, define shop-floor routing, planned quantities, and start/end dates." />
          )}
          {activeModule === "6. Sub-Supplier PO" && (
            <MilestoneModuleView stageKey="sub_supplier_po" stageTitle="6. Sub-Supplier PO" stageOrder={6} responsibleRole="SCM (Sub-Supplier PO)" description="Issue sub-supplier purchase orders for specialized forging, casting, and raw material procurement." />
          )}
          {activeModule === "7. Material Incoming Receipt" && (
            <MilestoneModuleView 
              stageKey="material_receipt" 
              stageTitle="7. Material Incoming Receipt" 
              stageOrder={7} 
              responsibleRole="Stores (Material Receipt)" 
              description="Record goods receipt notes (GRN), track raw material delivery dates, verify quality inspection clearance, and complete stage milestones." 
            />
          )}
          {activeModule === "8. Machining & Fabrication" && (
            <MilestoneModuleView stageKey="machining" stageTitle="8. Machining & Fabrication" stageOrder={8} responsibleRole="SCM / Planner (Machining)" description="Manage shop-floor machining operations, CNC tool routing, part completion, and fabrication schedules." />
          )}
          {activeModule === "9. Assembly" && (
            <MilestoneModuleView stageKey="assembly" stageTitle="9. Assembly" stageOrder={9} responsibleRole="Planner (Assembly)" description="Manage mechanical valve assembly, hydrostatic pressure testing setup, and fitting verification." />
          )}
          {activeModule === "10. Finished Goods (FG)" && (
            <MilestoneModuleView stageKey="fg" stageTitle="10. Finished Goods (FG)" stageOrder={10} responsibleRole="QC (FG)" description="Verify finished goods inspection, dimensional compliance, and hydro-testing sign-offs." />
          )}
          {activeModule === "11. Customer Inspection" && (
            <MilestoneModuleView stageKey="customer_inspection" stageTitle="11. Customer Inspection" stageOrder={11} responsibleRole="QC (Customer Inspection)" description="Coordinate client/third-party witness inspection, customer hold-point witness tests, and sign-offs." />
          )}
          {activeModule === "12. Painting" && (
            <MilestoneModuleView stageKey="painting" stageTitle="12. Painting" stageOrder={12} responsibleRole="QC (Painting)" description="Perform industrial coating, surface finish thickness checks (DFT), and painting quality approval." />
          )}
          {activeModule === "13. TRN" && (
            <MilestoneModuleView stageKey="trn" stageTitle="13. TRN" stageOrder={13} responsibleRole="QC (TRN)" description="Issue Test & Release Note (TRN), QA final release dossier, and shipping clearance certificates." />
          )}
          {activeModule === "14. Final Shipment & Dispatch" && (
            <MilestoneModuleView 
              stageKey="shipment" 
              stageTitle="14. Final Shipment & Dispatch" 
              stageOrder={14} 
              responsibleRole="Stores (Shipment)" 
              description="Track packing clearance, customs dispatch, site delivery confirmation, and complete order shipments." 
            />
          )}
          {activeModule === "Product Catalog" && <ProductCatalogModule />}
        </main>
      </div>
      <SystemBlueprintModal isOpen={showBlueprintModal} onClose={() => setShowBlueprintModal(false)} />
      <SystemTestRunner isOpen={showTestRunnerModal} onClose={() => setShowTestRunnerModal(false)} />
      {manualInputState.isOpen && manualInputState.po && manualInputState.productLine && manualInputState.milestone && (
        <ManualInputModal
          isOpen={manualInputState.isOpen}
          onClose={handleCloseManualInput}
          po={manualInputState.po}
          productLine={manualInputState.productLine}
          milestone={manualInputState.milestone}
          eventType={manualInputState.eventType}
        />
      )}
      <PODetailDrawer 
        po={selectedPO} 
        onClose={() => setSelectedPOId(null)} 
        onOpenManualInput={handleOpenManualInput} 
        onOpenCancelModal={(po) => setCancelModalPO(po)}
      />
      <CancelOrderModal
        isOpen={Boolean(cancelModalPO)}
        onClose={() => setCancelModalPO(null)}
        po={cancelModalPO}
      />
    </div>
  );
};

export function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}

export default App;
