import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import type { DesignType } from "../../types";
import { BaselineRevisionModal } from "../modals/BaselineRevisionModal";
import { BulkImportModal } from "../modals/BulkImportModal";
import { downloadCsvTemplate } from "../../services/csvImportService";
import {
  FilePlus2, CheckCircle2, ChevronDown, ChevronUp,
  Calendar, AlertCircle, ArrowLeft, Clock, ShieldCheck, Plus, Trash2,
  FileSpreadsheet, Download
} from "lucide-react";
import { addDays, todayLocal } from "../../services/calculationEngine";

type Step = "details" | "confirm" | "baseline";

type MaterialInput = {
  id: string;
  itemCode: string;
  description: string;
  qty: number;
  supplierName: string;
  leadTimeDays: number;
  isCriticalPath: boolean;
};

type ProductLineInput = {
  id: string;
  designType: DesignType;
  selectedProduct: string;
  customProductName: string;
  customCategory: string;
  qty: number;
  requirements: string;
  materials: MaterialInput[];
};

const emptyLine = (): ProductLineInput => ({
  id: `line-${Date.now()}-${Math.random()}`,
  designType: "Existing Design",
  selectedProduct: "",
  customProductName: "",
  customCategory: "",
  qty: 1,
  requirements: "",
  materials: [],
});

export const OrderIntakeModule: React.FC = () => {
  const { purchaseOrders, products, createPurchaseOrder, canDo, activeRole } = useApp();
  const canCreatePO = canDo("canCreatePO");

  const [step, setStep] = useState<Step>("details");
  const [customerName, setCustomerName] = useState("");
  const [customPoNumber, setCustomPoNumber] = useState("");
  const [customerPoRef, setCustomerPoRef] = useState("");
  const [bookedAmount, setBookedAmount] = useState("");
  const [lines, setLines] = useState<ProductLineInput[]>([emptyLine()]);
  const [expandedPO, setExpandedPO] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [createdPOId, setCreatedPOId] = useState<string | null>(null);
  const [baselineReviewPOId, setBaselineReviewPOId] = useState<string | null>(null);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);

  const today = todayLocal();
  const [poStartDate, setPoStartDate] = useState(today);
  const [committedDeliveryDate, setCommittedDeliveryDate] = useState("");

  const getDeadline = (): string => {
    let maxLeadTime = 42;
    for (const l of lines) {
      if (l.designType === "Existing Design") {
        const cat = products.find((p) => p.productName === l.selectedProduct);
        if (cat) maxLeadTime = Math.max(maxLeadTime, cat.totalLeadTimeDays);
      } else {
        maxLeadTime = Math.max(maxLeadTime, 90);
      }
    }
    return addDays(poStartDate || today, Math.max(0, maxLeadTime - 1));
  };

  const deadline = getDeadline();
  const pendingBaselineOrders = purchaseOrders.filter((po) => po.status === "Baseline Pending" && !po.isClosed);
  const planningOrders = purchaseOrders.filter((po) => !po.isClosed && po.status !== "Completed" && po.status !== "Baseline Pending");
  const completedOrders = purchaseOrders.filter((po) => po.isClosed || po.status === "Completed");

  const resetForm = () => {
    setStep("details");
    setCustomerName("");
    setCustomPoNumber("");
    setCustomerPoRef("");
    setBookedAmount("");
    setCommittedDeliveryDate("");
    setLines([emptyLine()]);
    setCreatedPOId(null);
    setErrorMsg("");
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => { if (lines.length > 1) setLines((prev) => prev.filter((l) => l.id !== id)); };
  const updateLine = (id: string, updates: Partial<ProductLineInput>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));

  const addMaterial = (lineId: string) =>
    setLines((prev) =>
      prev.map((l) =>
        l.id !== lineId
          ? l
          : {
              ...l,
              materials: [
                ...l.materials,
                { id: `mat-${Date.now()}`, itemCode: "", description: "", qty: 1, supplierName: "", leadTimeDays: 14, isCriticalPath: false },
              ],
            }
      )
    );

  const updateMaterial = (lineId: string, matId: string, updates: Partial<MaterialInput>) =>
    setLines((prev) =>
      prev.map((l) =>
        l.id !== lineId ? l : { ...l, materials: l.materials.map((m) => (m.id === matId ? { ...m, ...updates } : m)) }
      )
    );

  const removeMaterial = (lineId: string, matId: string) =>
    setLines((prev) =>
      prev.map((l) => (l.id !== lineId ? l : { ...l, materials: l.materials.filter((m) => m.id !== matId) }))
    );

  const validate = (): boolean => {
    if (!customPoNumber.trim()) { setErrorMsg("PO Number is required. Please enter a unique PO Number."); return false; }

    // Strict PO Number Uniqueness validation
    const isDuplicate = purchaseOrders.some(
      (p) => p.poNumber.trim().toLowerCase() === customPoNumber.trim().toLowerCase()
    );
    if (isDuplicate) {
      setErrorMsg(`Duplicate PO Number: Purchase order "${customPoNumber.trim()}" already exists. PO numbers must be strictly unique.`);
      return false;
    }

    if (!customerName.trim()) { setErrorMsg("Customer name is required."); return false; }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.designType === "Existing Design" && !l.selectedProduct) { setErrorMsg(`Line ${i + 1}: Please select a product.`); return false; }
      if (l.designType === "New Design" && !l.customProductName.trim()) { setErrorMsg(`Line ${i + 1}: Product description is required.`); return false; }
      for (let j = 0; j < l.materials.length; j++) {
        const m = l.materials[j];
        if (!m.itemCode.trim() || !m.description.trim()) { setErrorMsg(`Line ${i + 1}, Material ${j + 1}: Item code and description are required.`); return false; }
      }
    }
    setErrorMsg("");
    return true;
  };

  const handleCreate = () => {
    if (!validate()) return;
    const cleanAmount = bookedAmount.trim() ? parseFloat(bookedAmount.replace(/[^0-9.-]+/g, '')) : undefined;
    const result = createPurchaseOrder({
      poNumber: customPoNumber.trim(),
      customerName: customerName.trim(),
      customerPoRef: customerPoRef.trim() || `PO-REF-${Date.now()}`,
      poDate: poStartDate || today,
      bookedAmount: cleanAmount !== undefined && !isNaN(cleanAmount) ? cleanAmount : undefined,
      contractReviewRef: `CR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      committedDeliveryDate: committedDeliveryDate.trim() || undefined,
      productLines: lines.map((l) => {
        const catalog = products.find((p) => p.productName === l.selectedProduct);
        return {
          productName: l.designType === "Existing Design" ? l.selectedProduct : l.customProductName.trim(),
          category: l.designType === "Existing Design" ? (catalog?.category || "High-Pressure Control Valves") : (l.customCategory || "Custom Product"),
          qty: l.qty,
          designType: l.designType,
          milestones: [],
          materials: l.materials.map((m) => ({ ...m })),
        } as any;
      }),
    });
    if (result.success && result.poId) {
      setCreatedPOId(result.poId);
      if (activeRole === 'Project Manager (PM Baseline)' || activeRole === 'Project Management') {
        setBaselineReviewPOId(result.poId);
      }
      setStep("baseline");
    } else if (result.error) {
      setErrorMsg(result.error);
    }
  };

  const createdPO = createdPOId ? purchaseOrders.find((p) => p.id === createdPOId) : null;
  const isCreatedPOApproved = createdPO ? createdPO.status !== "Baseline Pending" : false;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Unified Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              STAGE 1 OF 14
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              Sales / AE (Customer PO)
            </span>
            {!canCreatePO && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                VIEW ONLY
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black tracking-tight">1. Customer Purchase Order (PO)</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Create new customer purchase orders, configure multi-product line specifications, and initialize baseline milestone planning.
          </p>
        </div>

        {canCreatePO && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={downloadCsvTemplate}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold border border-white/20 shadow-xs transition-all cursor-pointer"
              title="Download standardized CSV import template"
            >
              <Download className="w-4 h-4 text-emerald-300" />
              Download Template (.csv)
            </button>
            <button
              onClick={() => setShowBulkImportModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer border border-emerald-400/40"
              title="Bulk import orders and milestone dates from Excel/CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-100" />
              Bulk Import (CSV / Excel)
            </button>
          </div>
        )}
      </div>

      {!canCreatePO && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-8 flex flex-col items-center justify-center gap-3 text-center">
          <ShieldCheck className="w-10 h-10 text-slate-300" />
          <p className="font-bold text-slate-700">Order Creation Restricted</p>
          <p className="text-xs text-slate-500 max-w-sm">
            Only the <span className="font-semibold text-emerald-700">Sales / AE</span> role can create new Purchase Orders. You can view orders below.
          </p>
        </div>
      )}

      {canCreatePO && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {/* Step Header */}
          <div className="bg-slate-50/70 border-b border-slate-200 px-6 py-4 flex items-center gap-6">
            {(["details", "confirm", "baseline"] as Step[]).map((s, i) => {
              const labels = ["1. Order Details & Products", "2. Timeline Review", "3. Baseline Approval"];
              const isDone = (step === "confirm" && i === 0) || (step === "baseline" && i <= 1 && isCreatedPOApproved);
              const isCurrent = step === s;
              const canNavigate = i === 0 && step === "confirm";
              return (
                <div key={s} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canNavigate}
                    onClick={() => canNavigate && setStep(s)}
                    className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-all ${canNavigate ? "cursor-pointer hover:ring-2 hover:ring-emerald-400" : "cursor-default"} ${isDone ? "bg-emerald-600 text-white" : isCurrent ? "bg-emerald-700 text-white ring-2 ring-emerald-200" : "bg-slate-200 text-slate-500"}`}
                  >
                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </button>
                  <span className={`text-xs font-semibold ${isCurrent ? "text-emerald-800 font-bold" : isDone ? "text-emerald-700" : "text-slate-400"}`}>{labels[i]}</span>
                  {i < 2 && <span className="text-slate-300 text-xs ml-2">›</span>}
                </div>
              );
            })}
          </div>

          <div className="p-6 space-y-6">
            {/* ── STEP 1: DETAILS ── */}
            {step === "details" && (
              <div className="space-y-6">
                {/* Customer Info & Order Schedule Dates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Customer Name *</label>
                    <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Petrobras Offshore Ltd." className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">PO Number *</label>
                    <div className="relative">
                      <input
                        value={customPoNumber}
                        onChange={(e) => setCustomPoNumber(e.target.value)}
                        placeholder="e.g. PO-2026-001"
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none bg-white font-mono font-bold ${
                          customPoNumber.trim() && purchaseOrders.some(p => p.poNumber.trim().toLowerCase() === customPoNumber.trim().toLowerCase())
                            ? 'border-rose-400 text-rose-800 bg-rose-50/40 focus:border-rose-500'
                            : customPoNumber.trim()
                            ? 'border-emerald-400 text-emerald-900 bg-emerald-50/30 focus:border-emerald-500'
                            : 'border-slate-300 text-slate-800 focus:border-emerald-500'
                        }`}
                      />
                    </div>
                    <div className="text-[10px] mt-1 font-mono">
                      {customPoNumber.trim() ? (
                        purchaseOrders.some(p => p.poNumber.trim().toLowerCase() === customPoNumber.trim().toLowerCase()) ? (
                          <span className="text-rose-600 font-bold flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-600" /> Duplicate: already in use
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Strictly unique PO number
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">Unique PO Identifier required</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Customer PO Reference</label>
                    <input value={customerPoRef} onChange={(e) => setCustomerPoRef(e.target.value)} placeholder="e.g. PO-4500981223" className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Booked Amount ($)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={bookedAmount}
                        onChange={(e) => setBookedAmount(e.target.value)}
                        placeholder="e.g. 150000"
                        className="w-full pl-7 pr-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 bg-white font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">Contract / Order value</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700">PO Start Date *</label>
                      <span className="text-[10px] font-mono text-emerald-800 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">Past 1 Wk &amp; Future</span>
                    </div>
                    <input
                      type="date"
                      min={addDays(today, -7)}
                      value={poStartDate}
                      onChange={(e) => setPoStartDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 bg-white font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">
                      Enabled: Past 1 week ({addDays(today, -7)}), today, &amp; future dates
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Committed Delivery Date</label>
                    <input
                      type="date"
                      min={poStartDate || today}
                      value={committedDeliveryDate}
                      onChange={(e) => setCommittedDeliveryDate(e.target.value)}
                      placeholder={deadline}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 bg-white font-mono"
                    />
                  </div>
                </div>

                {/* Product Lines */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800">Product Lines</h3>
                    <button onClick={addLine} className="text-xs font-bold text-emerald-700 flex items-center gap-1 hover:underline cursor-pointer">
                      <Plus className="w-3.5 h-3.5" /> Add Product Line
                    </button>
                  </div>

                  {lines.map((l, idx) => (
                    <div key={l.id} className="border border-slate-200 rounded-xl bg-slate-50/60 overflow-hidden">
                      {/* Line header */}
                      <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Line {idx + 1}</span>
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(l.id)} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="p-4 space-y-4">
                        {/* Design type + product + qty */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Design Type</label>
                            <select value={l.designType} onChange={(e) => updateLine(l.id, { designType: e.target.value as DesignType, selectedProduct: "", customProductName: "" })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                              <option value="Existing Design">Existing Design</option>
                              <option value="New Design">New Design</option>
                            </select>
                          </div>

                          {l.designType === "Existing Design" ? (
                            <>
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Select Product *</label>
                                <select value={l.selectedProduct} onChange={(e) => updateLine(l.id, { selectedProduct: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                                  <option value="">Select a product</option>
                                  {products.map((p) => (
                                    <option key={p.id} value={p.productName}>{p.productName} ({p.totalLeadTimeDays}d)</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Quantity</label>
                                <input type="number" min={1} value={l.qty} onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Product Description *</label>
                                <input value={l.customProductName} onChange={(e) => updateLine(l.id, { customProductName: e.target.value })} placeholder="e.g. Custom 4″ Gate Valve" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Quantity</label>
                                <input type="number" min={1} value={l.qty} onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
                              </div>
                            </>
                          )}
                        </div>

                        {l.designType === "New Design" && (
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Special Requirements</label>
                            <textarea value={l.requirements} onChange={(e) => updateLine(l.id, { requirements: e.target.value })} rows={2} placeholder="Describe pressure rating, material spec, test standards..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white resize-none" />
                          </div>
                        )}

                        {/* Raw Materials sub-section */}
                        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                          <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                            <div>
                              <span className="text-xs font-bold text-slate-700">Raw Materials</span>
                              <span className="ml-2 text-[10px] text-slate-500">({l.materials.length} custom item{l.materials.length !== 1 ? "s" : ""})</span>
                            </div>
                            <button onClick={() => addMaterial(l.id)} className="text-[11px] font-bold text-emerald-700 flex items-center gap-1 hover:underline cursor-pointer">
                              <Plus className="w-3 h-3" /> Add Material
                            </button>
                          </div>

                          {l.materials.length === 0 ? (
                            <div className="p-3 text-xs text-slate-500 italic">
                              No custom materials added.{l.designType === "Existing Design" && " Default catalog materials will be applied automatically."}
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-100">
                              {/* Column headers */}
                              <div className="px-3 py-1.5 grid grid-cols-12 gap-2 text-[10px] font-bold text-slate-400 uppercase bg-slate-50">
                                <span className="col-span-2">Item Code</span>
                                <span className="col-span-4">Description</span>
                                <span className="col-span-1 text-center">Qty</span>
                                <span className="col-span-2">Supplier</span>
                                <span className="col-span-1 text-center">Lead (d)</span>
                                <span className="col-span-1 text-center">Critical</span>
                                <span className="col-span-1"></span>
                              </div>
                              {l.materials.map((m) => (
                                <div key={m.id} className="px-3 py-2 grid grid-cols-12 gap-2 items-center text-xs">
                                  <input value={m.itemCode} onChange={(e) => updateMaterial(l.id, m.id, { itemCode: e.target.value })} placeholder="RM-001" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-emerald-400" />
                                  <input value={m.description} onChange={(e) => updateMaterial(l.id, m.id, { description: e.target.value })} placeholder="e.g. SS316 Flanged Body" className="col-span-4 px-2 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-emerald-400" />
                                  <input type="number" min={1} value={m.qty} onChange={(e) => updateMaterial(l.id, m.id, { qty: Number(e.target.value) })} className="col-span-1 px-2 py-1.5 border border-slate-300 rounded text-center focus:outline-none focus:border-emerald-400" />
                                  <input value={m.supplierName} onChange={(e) => updateMaterial(l.id, m.id, { supplierName: e.target.value })} placeholder="Supplier" className="col-span-2 px-2 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-emerald-400" />
                                  <input type="number" min={1} value={m.leadTimeDays} onChange={(e) => updateMaterial(l.id, m.id, { leadTimeDays: Number(e.target.value) })} className="col-span-1 px-2 py-1.5 border border-slate-300 rounded text-center focus:outline-none focus:border-emerald-400" />
                                  <div className="col-span-1 flex justify-center">
                                    <input type="checkbox" checked={m.isCriticalPath} onChange={(e) => updateMaterial(l.id, m.id, { isCriticalPath: e.target.checked })} className="w-4 h-4 accent-emerald-700 cursor-pointer" title="Mark as critical path" />
                                  </div>
                                  <button onClick={() => removeMaterial(l.id, m.id)} className="col-span-1 flex justify-center p-1 text-slate-400 hover:text-rose-500 cursor-pointer">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {errorMsg && (
                  <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {errorMsg}
                  </div>
                )}

                <div className="flex justify-end pt-4 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => { if (validate()) setStep("confirm"); }}
                    className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    Review Timeline & Submit
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: CONFIRM ── */}
            {step === "confirm" && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Order Summary</p>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">PO Number</span><span className="font-mono font-bold text-emerald-900">{customPoNumber}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-semibold text-slate-900">{customerName}</span></div>
                      {customerPoRef && <div className="flex justify-between"><span className="text-slate-500">Cust. PO Ref</span><span className="font-mono text-slate-700">{customerPoRef}</span></div>}
                      {bookedAmount && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Booked Amount</span>
                          <span className="font-mono font-bold text-emerald-800">
                            ${Number(bookedAmount.replace(/[^0-9.-]+/g, '')).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between"><span className="text-slate-500">Total Lines</span><span className="font-bold text-slate-900">{lines.length} Product(s)</span></div>
                      <div className="flex justify-between border-t border-slate-200 pt-2.5"><span className="text-slate-500">Order Start Date</span><span className="font-mono text-slate-700 font-bold">{poStartDate || today}</span></div>
                      {committedDeliveryDate && (
                        <div className="flex justify-between"><span className="text-slate-500">Customer Delivery Target</span><span className="font-mono font-bold text-emerald-800">{committedDeliveryDate}</span></div>
                      )}
                      <div className="flex justify-between"><span className="text-slate-700 font-semibold">Max Calculated Deadline</span><span className="font-mono font-bold text-emerald-700 text-sm">{deadline}</span></div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Product Lines</p>
                    <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 space-y-3 overflow-y-auto max-h-44">
                      {lines.map((l, i) => (
                        <div key={l.id} className="text-[11px] border-b border-emerald-100 last:border-0 pb-2 last:pb-0">
                          <div className="font-bold text-emerald-900">Line {i + 1}: {l.designType === "Existing Design" ? l.selectedProduct : l.customProductName}</div>
                          <div className="text-emerald-700 flex justify-between mt-0.5">
                            <span>Qty: {l.qty} &nbsp;|&nbsp; {l.designType}</span>
                            {l.materials.length > 0 && <span className="font-semibold">{l.materials.length} custom material{l.materials.length !== 1 ? "s" : ""}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {lines.some((l) => l.designType === "New Design") && (
                  <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-800">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>New Design orders include a full Design Stage before raw material purchase and production can begin.</span>
                  </div>
                )}

                {errorMsg && (
                  <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {errorMsg}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                  <button type="button" onClick={() => setStep("details")} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
                    <ArrowLeft className="w-4 h-4" /> Back to Order Details
                  </button>
                  <button type="button" onClick={handleCreate} className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-2 shadow-md">
                    <FilePlus2 className="w-4 h-4" /> Create Order & Proceed to Baseline Approval
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: BASELINE ── */}
            {step === "baseline" && createdPO && (
              <div className="space-y-6">
                {isCreatedPOApproved ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-4">
                    <div className="w-12 h-12 bg-emerald-600 text-white rounded-full flex items-center justify-center mx-auto shadow-md">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-emerald-900">Baseline Approved & Order Released!</h3>
                      <p className="text-xs text-emerald-700 mt-1 max-w-md mx-auto">
                        Order <span className="font-mono font-bold">{createdPO.poNumber}</span> has been baseline-approved and is now active across all manufacturing modules.
                      </p>
                    </div>
                    <div className="pt-2">
                      <button onClick={resetForm} className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer">Create Another Order</button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-amber-100 border border-amber-300 text-amber-800 rounded-xl flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-base font-bold text-amber-900">Baseline Approval Pending for {createdPO.poNumber}</h3>
                        <p className="text-xs text-amber-800">
                          This order is created but held in <span className="font-semibold">'Baseline Pending'</span> status. It will <strong>NOT</strong> appear on the shop floor or in downstream modules until baseline schedule dates are verified and approved.
                        </p>
                      </div>
                    </div>
                    <div className="bg-white border border-amber-200 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-xs text-slate-800">{createdPO.poNumber} — {createdPO.customerName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">Planned Delivery: {createdPO.committedDeliveryDate}</div>
                      </div>
                      {activeRole === 'Project Manager (PM Baseline)' || activeRole === 'Project Management' ? (
                        <button onClick={() => setBaselineReviewPOId(createdPO.id)} className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs">
                          <ShieldCheck className="w-4 h-4" /> Review & Approve Baseline Now
                        </button>
                      ) : (
                        <span className="px-4 py-2 bg-slate-100 border border-slate-200 text-slate-500 text-xs font-semibold rounded-xl">Waiting for PM Baseline Review</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <button onClick={() => setStep("details")} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer">
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Edit Details
                      </button>
                      <button onClick={resetForm} className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer">Create Another Order Later</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PENDING BASELINE APPROVAL */}
      {pendingBaselineOrders.length > 0 && (
        <div className="bg-amber-50/60 border border-amber-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-amber-200 flex items-center gap-2.5 bg-amber-100/50">
            <Clock className="w-5 h-5 text-amber-700" />
            <div>
              <h2 className="font-bold text-sm text-amber-950">Orders Awaiting Baseline Approval ({pendingBaselineOrders.length})</h2>
              <p className="text-xs text-amber-800 mt-0.5">These orders are not yet visible to shop floor departments. Approve baseline dates to release them.</p>
            </div>
          </div>
          <div className="divide-y divide-amber-200/60">
            {pendingBaselineOrders.map((po) => (
              <div key={po.id} className="p-5 bg-white flex items-center justify-between hover:bg-amber-50/30 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-amber-900 text-sm">{po.poNumber}</span>
                    <span className="font-semibold text-slate-900 text-sm">{po.customerName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">Baseline Pending</span>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-4">
                    <span>Cust. Ref: <strong className="text-slate-700">{po.customerPoRef || "N/A"}</strong></span>
                    {po.bookedAmount !== undefined && (
                      <span>Booked: <strong className="text-emerald-800 font-mono font-bold">${Number(po.bookedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                    )}
                    <span>Lines: <strong className="text-slate-700">{po.productLines.length}</strong></span>
                    <span>Delivery: <strong className="text-emerald-700 font-mono">{po.committedDeliveryDate}</strong></span>
                  </div>
                </div>
                {activeRole === 'Project Manager (PM Baseline)' || activeRole === 'Project Management' ? (
                  <button onClick={() => setBaselineReviewPOId(po.id)} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs">
                    <ShieldCheck className="w-4 h-4" /> Approve Baseline
                  </button>
                ) : (
                  <span className="px-4 py-2 bg-slate-100 border border-slate-200 text-slate-500 text-xs font-semibold rounded-xl">PM Review Required</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BASELINE MODAL */}
      {baselineReviewPOId && (() => {
        const reviewPO = purchaseOrders.find((po) => po.id === baselineReviewPOId);
        return reviewPO ? (
          <BaselineRevisionModal isOpen onClose={() => setBaselineReviewPOId(null)} po={reviewPO} />
        ) : null;
      })()}

      {/* APPROVED PLANNING ORDERS */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Approved Orders — Active Planning & Design</h2>
            <p className="text-xs text-slate-500 mt-0.5">Orders with approved baseline schedules in active execution.</p>
          </div>
          <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-mono border border-slate-200">{planningOrders.length} active</span>
        </div>
        <div className="divide-y divide-slate-100">
          {planningOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No active planning orders.</div>
          ) : (
            planningOrders.map((po) => {
              const isExpanded = expandedPO === po.id;
              const designPending = po.productLines.some((line) => {
                if (line.designType !== "New Design") return false;
                const designMs = line.milestones.find((m) => m.key === "design_approval");
                return designMs?.status !== "Completed";
              });
              return (
                <div key={po.id}>
                  <button onClick={() => setExpandedPO(isExpanded ? null : po.id)} className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="font-mono font-bold text-emerald-800 text-sm">{po.poNumber}</span>
                      <span className="font-semibold text-slate-900">{po.customerName}</span>
                      <span className="text-xs text-slate-500">{po.productLines.length} line{po.productLines.length !== 1 ? "s" : ""}</span>
                      {po.bookedAmount !== undefined && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-mono font-bold">
                          ${Number(po.bookedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Calendar className="w-3.5 h-3.5" />
                          <span className="font-mono font-bold text-slate-800">{po.committedDeliveryDate}</span>
                        </div>
                        {designPending ? (
                          <span className="text-amber-700 font-semibold text-[11px]">Design Pending</span>
                        ) : (
                          <span className="text-slate-500 font-semibold text-[11px] flex items-center gap-1 justify-end"><CheckCircle2 className="w-3 h-3" /> On Track</span>
                        )}
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-6 pb-5 space-y-4 bg-slate-50/40">
                      {/* Unified Master 14-Stage Schedule Strip */}
                      <div className="border border-slate-200 rounded-xl bg-white p-4 space-y-3 shadow-2xs">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                            Order Master 14-Stage Baseline (All {po.productLines.length} Products)
                          </span>
                          <span className="text-[10px] font-mono text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Delivery: {po.revisedDeliveryDate || po.committedDeliveryDate}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                          {(po.productLines[0]?.milestones || []).map((ms) => (
                            <div key={ms.key} className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px] space-y-0.5">
                              <div className="text-[10px] font-mono text-slate-400 font-bold">Stage {ms.stageOrder}</div>
                              <div className="font-bold text-slate-800 truncate" title={ms.name}>{ms.name}</div>
                              <div className="text-[10px] font-mono text-emerald-700 font-semibold">{ms.committedBaselineEndDate}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Products in this order */}
                      <div className="border border-slate-200 rounded-xl bg-white p-3 space-y-2 shadow-2xs">
                        <div className="text-xs font-bold text-slate-700">Included Product Lines:</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {po.productLines.map((line) => (
                            <div key={line.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs">
                              <div>
                                <div className="font-bold text-slate-800">{line.lineNumber}: {line.productName}</div>
                                <div className="text-[10px] text-slate-500 font-mono">Qty: {line.qty} | {line.designType}</div>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                line.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                                line.status === 'Delayed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-700'
                              }`}>
                                {line.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* COMPLETED & CLOSED ORDERS */}
      {completedOrders.length > 0 && (
        <div className="bg-slate-50/80 border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-100/60 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900">Completed & Closed Orders</h2>
              <p className="text-xs text-slate-500 mt-0.5">Orders that have successfully completed all milestones and were closed.</p>
            </div>
            <span className="px-3 py-1 bg-slate-200 text-slate-700 rounded-full text-xs font-mono border border-slate-300">
              {completedOrders.length} completed
            </span>
          </div>
          <div className="divide-y divide-slate-200/70">
            {completedOrders.map((po) => {
              const isExpanded = expandedPO === po.id;
              return (
                <div key={po.id} className="bg-white/70">
                  <button
                    onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                    className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-mono font-bold text-slate-700 text-sm">{po.poNumber}</span>
                      <span className="font-semibold text-slate-800">{po.customerName}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-200 border border-slate-300 text-slate-700 text-[10px] font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> {po.isClosed ? "Closed" : "Completed"}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs text-slate-500 font-mono">
                        Delivery: <strong className="text-slate-700">{po.revisedDeliveryDate || po.committedDeliveryDate}</strong>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-6 pb-5 space-y-3 bg-slate-50/60">
                      {po.productLines.map((line) => (
                        <div key={line.id} className="border border-slate-200 rounded-xl bg-white p-4">
                          <div className="flex justify-between items-center text-xs font-semibold">
                            <span className="text-slate-800">{line.lineNumber}: {line.productName} (Qty: {line.qty})</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">Completed</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      <BulkImportModal
        isOpen={showBulkImportModal}
        onClose={() => setShowBulkImportModal(false)}
      />
    </div>
  );
};
