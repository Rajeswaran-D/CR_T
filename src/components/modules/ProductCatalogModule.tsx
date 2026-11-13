import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Package, 
  Plus, 
  Search, 
  CheckCircle2, 
  X,
  Save,
  AlertCircle,
  HelpCircle,
  Edit3,
  Trash2,
  Lock,
  Calculator,
  RefreshCw,
  Clock,
  Check
} from 'lucide-react';
import type { ProductMasterItem, DesignType } from '../../types';

interface MaterialFormItem {
  id: string;
  itemCode: string;
  description: string;
  supplierName: string;
  qty: number;
  unit: string;
  leadTimeValue: number;
  leadTimeUnit: 'Days' | 'Weeks';
  isCriticalPath: boolean;
}

export const ProductCatalogModule: React.FC = () => {
  const { products, createProduct, updateProduct, deleteProduct, activeRole } = useApp();

  const isAdmin = activeRole === 'Project Management';

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductMasterItem | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Form state for adding/editing product
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('High-Pressure Control Valves');
  const [customCategory, setCustomCategory] = useState('');
  const [isCustomCat, setIsCustomCat] = useState(false);
  const [designType, setDesignType] = useState<DesignType>('Existing Design');
  
  // Manufacturing / Shop-Floor Processing Duration (days)
  const [manufacturingDays, setManufacturingDays] = useState(24);

  // Auto-calculation toggle state
  const [isAutoCalc, setIsAutoCalc] = useState(true);

  // Total lead time state with Days/Weeks unit support
  const [leadTimeValue, setLeadTimeValue] = useState(6);
  const [leadTimeUnit, setLeadTimeUnit] = useState<'Days' | 'Weeks'>('Weeks');

  const [description, setDescription] = useState('');
  
  // Multi-raw material list state
  const [materials, setMaterials] = useState<MaterialFormItem[]>([
    {
      id: 'mat-1',
      itemCode: '',
      description: '',
      supplierName: '',
      qty: 1,
      unit: 'Pcs',
      leadTimeValue: 3,
      leadTimeUnit: 'Weeks',
      isCriticalPath: true
    }
  ]);

  const standardCategories = [
    'High-Pressure Control Valves',
    'Electromagnetic Flowmeters',
    'Actuators & Controls',
    'Standard Flow Valves & Systems'
  ];

  const categories = ['All', ...standardCategories];

  const formatLeadTime = (days: number): string => {
    if (days >= 7 && days % 7 === 0) {
      const w = days / 7;
      return `${w} ${w === 1 ? 'Week' : 'Weeks'} (${days} Days)`;
    }
    if (days >= 7) {
      const w = (days / 7).toFixed(1);
      return `${w} Weeks (${days} Days)`;
    }
    return `${days} Days`;
  };

  // Convert material lead time to days
  const getMaterialDays = (m: MaterialFormItem): number => {
    const val = Number(m.leadTimeValue) || 1;
    return m.leadTimeUnit === 'Weeks' ? val * 7 : val;
  };

  // Dynamic calculation of critical path material lead time
  const maxMatLeadDays = materials.length > 0
    ? Math.max(...materials.map(getMaterialDays), 1)
    : 14;

  // Total calculated days = Critical Material Lead Time + Manufacturing/Assembly Lead Time
  const calculatedTotalDays = Math.max(1, maxMatLeadDays + Math.max(0, Number(manufacturingDays) || 0));

  // Auto-sync total lead time when materials or manufacturing duration changes
  useEffect(() => {
    if (!isAutoCalc) return;
    if (leadTimeUnit === 'Weeks') {
      const w = Number((calculatedTotalDays / 7).toFixed(1));
      setLeadTimeValue(w);
    } else {
      setLeadTimeValue(calculatedTotalDays);
    }
  }, [calculatedTotalDays, isAutoCalc, leadTimeUnit]);

  // When designType changes, adjust default manufacturing processing days if untouched
  const handleDesignTypeChange = (newType: DesignType) => {
    setDesignType(newType);
    if (newType === 'New Design' && manufacturingDays === 24) {
      setManufacturingDays(45);
    } else if (newType === 'Existing Design' && manufacturingDays === 45) {
      setManufacturingDays(24);
    }
  };

  const filteredProducts = products.filter(p => {
    const pName = (p.productName || (p as any).name || '').toLowerCase();
    const pCode = (p.productCode || (p as any).code || '').toLowerCase();
    const pDesc = (p.description || '').toLowerCase();
    const search = (searchTerm || '').toLowerCase();
    const matchesSearch = pName.includes(search) || 
                          pCode.includes(search) ||
                          pDesc.includes(search) ||
                          (p.defaultMaterials && p.defaultMaterials.some(m => (m.itemCode || '').toLowerCase().includes(search) || (m.description || '').toLowerCase().includes(search)));
    const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const resetForm = () => {
    setProductCode('');
    setProductName('');
    setCategory('High-Pressure Control Valves');
    setCustomCategory('');
    setIsCustomCat(false);
    setDesignType('Existing Design');
    setManufacturingDays(24);
    setIsAutoCalc(true);
    setLeadTimeValue(6);
    setLeadTimeUnit('Weeks');
    setDescription('');
    setMaterials([
      {
        id: `mat-${Date.now()}`,
        itemCode: '',
        description: '',
        supplierName: '',
        qty: 1,
        unit: 'Pcs',
        leadTimeValue: 3,
        leadTimeUnit: 'Weeks',
        isCriticalPath: true
      }
    ]);
    setErrorMsg('');
  };

  const syncCriticalPathFlag = (updated: MaterialFormItem[]) => {
    const maxDays = Math.max(...updated.map(getMaterialDays), 1);
    return updated.map(m => ({
      ...m,
      isCriticalPath: getMaterialDays(m) === maxDays
    }));
  };

  const handleAddMaterial = () => {
    setMaterials(prev => {
      const next: MaterialFormItem[] = [
        ...prev,
        {
          id: `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          itemCode: '',
          description: '',
          supplierName: '',
          qty: 1,
          unit: 'Pcs',
          leadTimeValue: 14,
          leadTimeUnit: 'Days',
          isCriticalPath: false
        }
      ];
      return syncCriticalPathFlag(next);
    });
  };

  const handleRemoveMaterial = (id: string) => {
    if (materials.length <= 1) {
      setMaterials([
        {
          id: `mat-${Date.now()}`,
          itemCode: '',
          description: '',
          supplierName: '',
          qty: 1,
          unit: 'Pcs',
          leadTimeValue: 14,
          leadTimeUnit: 'Days',
          isCriticalPath: true
        }
      ]);
      return;
    }
    setMaterials(prev => syncCriticalPathFlag(prev.filter(m => m.id !== id)));
  };

  const handleMaterialChange = (id: string, field: keyof MaterialFormItem, value: any) => {
    setMaterials(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, [field]: value } : m);
      if (field === 'leadTimeValue' || field === 'leadTimeUnit') {
        return syncCriticalPathFlag(updated);
      }
      return updated;
    });
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (prd: ProductMasterItem) => {
    resetForm();
    setEditingProduct(prd);
    setProductCode(prd.productCode);
    setProductName(prd.productName);
    
    if (standardCategories.includes(prd.category)) {
      setCategory(prd.category);
      setIsCustomCat(false);
    } else {
      setCategory('CUSTOM');
      setCustomCategory(prd.category);
      setIsCustomCat(true);
    }

    setDesignType(prd.designType || 'Existing Design');
    
    // Set materials list
    let mats: MaterialFormItem[] = [];
    if (prd.defaultMaterials && prd.defaultMaterials.length > 0) {
      mats = prd.defaultMaterials.map((m, idx) => ({
        id: `mat-${idx}-${Date.now()}`,
        itemCode: m.itemCode,
        description: m.description,
        supplierName: m.supplierName,
        qty: m.qty || 1,
        unit: m.unit || 'Pcs',
        leadTimeValue: m.leadTimeDays % 7 === 0 ? m.leadTimeDays / 7 : m.leadTimeDays,
        leadTimeUnit: m.leadTimeDays % 7 === 0 ? 'Weeks' : 'Days',
        isCriticalPath: Boolean(m.isCriticalPath)
      }));
    } else {
      mats = [{
        id: `mat-${Date.now()}`,
        itemCode: '',
        description: '',
        supplierName: '',
        qty: 1,
        unit: 'Pcs',
        leadTimeValue: 3,
        leadTimeUnit: 'Weeks',
        isCriticalPath: true
      }];
    }
    setMaterials(mats);

    // Calculate or restore manufacturing duration
    const matMaxDays = Math.max(...mats.map(m => m.leadTimeUnit === 'Weeks' ? m.leadTimeValue * 7 : m.leadTimeValue), 14);
    const restoredMfg = typeof prd.manufacturingLeadTimeDays === 'number'
      ? prd.manufacturingLeadTimeDays
      : Math.max(1, prd.totalLeadTimeDays - matMaxDays);
    setManufacturingDays(restoredMfg);

    // Set lead time
    if (prd.totalLeadTimeDays % 7 === 0) {
      setLeadTimeValue(prd.totalLeadTimeDays / 7);
      setLeadTimeUnit('Weeks');
    } else {
      setLeadTimeValue(prd.totalLeadTimeDays);
      setLeadTimeUnit('Days');
    }

    setDescription(prd.description || '');
    setIsAutoCalc(true);
  };

  const buildMaterialsPayload = () => {
    const valid = materials.filter(m => m.itemCode.trim());
    const mapped = valid.map(m => {
      const days = m.leadTimeUnit === 'Weeks' ? Number(m.leadTimeValue || 1) * 7 : Number(m.leadTimeValue || 1);
      return {
        itemCode: m.itemCode.trim(),
        description: m.description.trim() || `${productName.trim()} Raw Part`,
        supplierName: m.supplierName.trim() || 'Approved Supplier',
        qty: Math.max(1, Number(m.qty) || 1),
        unit: m.unit || 'Pcs',
        leadTimeDays: Math.max(1, days),
        isCriticalPath: m.isCriticalPath
      };
    });

    // If there are materials and none is marked critical, mark the longest one
    if (mapped.length > 0 && !mapped.some(m => m.isCriticalPath)) {
      let maxLead = -1;
      let maxIdx = 0;
      mapped.forEach((m, idx) => {
        if (m.leadTimeDays > maxLead) {
          maxLead = m.leadTimeDays;
          maxIdx = idx;
        }
      });
      mapped[maxIdx].isCriticalPath = true;
    }

    return mapped;
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) {
      setErrorMsg('Product Name is required.');
      return;
    }
    if (!productCode.trim()) {
      setErrorMsg('Product Code is required.');
      return;
    }

    const effectiveCategory = isCustomCat ? customCategory.trim() : category;
    if (!effectiveCategory) {
      setErrorMsg('Product Category is required.');
      return;
    }

    // Check duplicate code
    if (products.some(p => p.productCode.toLowerCase() === productCode.trim().toLowerCase())) {
      setErrorMsg(`Product code '${productCode.trim()}' already exists in catalog.`);
      return;
    }

    setErrorMsg('');
    const totalDays = leadTimeUnit === 'Weeks' ? Number(leadTimeValue) * 7 : Number(leadTimeValue);
    const defaultMaterials = buildMaterialsPayload();

    const res = createProduct({
      productCode: productCode.trim(),
      productName: productName.trim(),
      category: effectiveCategory,
      designType,
      totalLeadTimeDays: Math.round(totalDays) || 42,
      manufacturingLeadTimeDays: Number(manufacturingDays) || 24,
      description: description.trim(),
      defaultMaterials
    });

    if (res.success) {
      setSuccessMsg(`Product '${productName}' with ${defaultMaterials.length} raw material(s) and ${Math.round(totalDays)}d lead time registered successfully!`);
      setShowAddModal(false);
      resetForm();
      setTimeout(() => setSuccessMsg(''), 5000);
    }
  };

  const handleUpdateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    if (!productName.trim()) {
      setErrorMsg('Product Name is required.');
      return;
    }
    if (!productCode.trim()) {
      setErrorMsg('Product Code is required.');
      return;
    }

    const effectiveCategory = isCustomCat ? customCategory.trim() : category;
    if (!effectiveCategory) {
      setErrorMsg('Product Category is required.');
      return;
    }

    // Check duplicate code against other products
    if (products.some(p => p.id !== editingProduct.id && p.productCode.toLowerCase() === productCode.trim().toLowerCase())) {
      setErrorMsg(`Product code '${productCode.trim()}' already exists on another product.`);
      return;
    }

    setErrorMsg('');
    const totalDays = leadTimeUnit === 'Weeks' ? Number(leadTimeValue) * 7 : Number(leadTimeValue);
    const defaultMaterials = buildMaterialsPayload();

    const res = updateProduct(editingProduct.id, {
      productCode: productCode.trim(),
      productName: productName.trim(),
      category: effectiveCategory,
      designType,
      totalLeadTimeDays: Math.round(totalDays) || 42,
      manufacturingLeadTimeDays: Number(manufacturingDays) || 24,
      description: description.trim(),
      defaultMaterials
    });

    if (res.success) {
      setSuccessMsg(`Product '${productName}' updated with ${defaultMaterials.length} raw material(s) and ${Math.round(totalDays)}d lead time successfully!`);
      setEditingProduct(null);
      resetForm();
      setTimeout(() => setSuccessMsg(''), 5000);
    } else {
      setErrorMsg(res.error || 'Failed to update product.');
    }
  };

  const handleDeleteProduct = (prd: ProductMasterItem) => {
    const confirmed = window.confirm(`Are you sure you want to delete product "${prd.productName}" (${prd.productCode}) from the catalog? This action cannot be undone.`);
    if (!confirmed) return;

    const res = deleteProduct(prd.id);
    if (res.success) {
      setSuccessMsg(`Product '${prd.productName}' deleted from catalog.`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } else {
      alert(res.error || 'Failed to delete product.');
    }
  };

  // Shared Raw Material Fields Component for Add & Edit Modals
  const renderMaterialFields = () => (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
            <Package className="w-4 h-4 text-emerald-700" /> Raw Materials Bill of Materials ({materials.length})
          </h4>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Define item codes, descriptions, suppliers, required quantities, units, and supplier procurement lead times.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddMaterial}
          className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1 border border-emerald-300 transition-colors shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5" /> + Add Another Raw Material
        </button>
      </div>

      <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg text-[11px] text-emerald-950 flex items-start gap-2">
        <HelpCircle className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Critical Path Rule:</span> The raw material item with the longest procurement lead time governs the shop-floor start date. Adding or changing a material's lead time automatically recalculates the product's total lead time.
        </div>
      </div>

      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {materials.map((mat, idx) => (
          <div key={mat.id} className={`p-3.5 bg-white border rounded-xl space-y-2.5 shadow-2xs transition-colors ${mat.isCriticalPath ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-800 text-xs font-mono">Raw Material #{idx + 1}</span>
                {mat.isCriticalPath ? (
                  <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 font-mono text-[9px] font-bold border border-rose-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse"></span>
                    CRITICAL PATH ({getMaterialDays(mat)} Days)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[9px]">
                    Sub-component ({getMaterialDays(mat)} Days)
                  </span>
                )}
              </div>
              {materials.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveMaterial(mat.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded cursor-pointer transition-colors"
                  title="Remove this raw material"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Item Code *</label>
                <input
                  type="text"
                  placeholder="e.g. MAT-CS-600-BODY"
                  value={mat.itemCode}
                  onChange={(e) => handleMaterialChange(mat.id, 'itemCode', e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold"
                />
              </div>

              <div className="col-span-5">
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Supplier Name</label>
                <input
                  type="text"
                  placeholder="e.g. Sandvik Precision Castings"
                  value={mat.supplierName}
                  onChange={(e) => handleMaterialChange(mat.id, 'supplierName', e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="col-span-3">
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Qty & Unit</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    value={mat.qty}
                    onChange={(e) => handleMaterialChange(mat.id, 'qty', Number(e.target.value) || 1)}
                    className="w-14 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-center"
                  />
                  <select
                    value={mat.unit}
                    onChange={(e) => handleMaterialChange(mat.id, 'unit', e.target.value)}
                    className="flex-1 px-1.5 py-1.5 bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-700"
                  >
                    <option value="Pcs">Pcs</option>
                    <option value="Kg">Kg</option>
                    <option value="Mtr">Mtr</option>
                    <option value="Set">Set</option>
                    <option value="Nos">Nos</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Material Description</label>
                <input
                  type="text"
                  placeholder="e.g. ASTM A216 WCB Cast Body"
                  value={mat.description}
                  onChange={(e) => handleMaterialChange(mat.id, 'description', e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="col-span-6">
                <label className="text-[10px] font-bold text-slate-600 block mb-0.5">Procurement Lead Time</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={mat.leadTimeValue}
                    onChange={(e) => handleMaterialChange(mat.id, 'leadTimeValue', Number(e.target.value) || 1)}
                    className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-center"
                  />
                  <select
                    value={mat.leadTimeUnit}
                    onChange={(e) => handleMaterialChange(mat.id, 'leadTimeUnit', e.target.value as 'Days' | 'Weeks')}
                    className="px-2 py-1.5 bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="Days">Days</option>
                    <option value="Weeks">Weeks</option>
                  </select>

                  <label className={`flex items-center gap-1 text-[11px] font-bold shrink-0 cursor-pointer ml-auto px-2 py-1 rounded border transition-colors ${mat.isCriticalPath ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    <input
                      type="checkbox"
                      checked={mat.isCriticalPath}
                      onChange={(e) => handleMaterialChange(mat.id, 'isCriticalPath', e.target.checked)}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                    />
                    Critical Path
                  </label>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Live Lead Time Dynamic Calculation Breakdown Box
  const renderCalculationBreakdown = () => (
    <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-xl space-y-2.5 shadow-2xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-emerald-700" />
          <h4 className="font-extrabold text-xs text-slate-900 uppercase tracking-wide">
            Dynamic Lead Time Calculation
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsAutoCalc(true);
              if (leadTimeUnit === 'Weeks') {
                setLeadTimeValue(Number((calculatedTotalDays / 7).toFixed(1)));
              } else {
                setLeadTimeValue(calculatedTotalDays);
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
              isAutoCalc 
                ? 'bg-emerald-700 text-white shadow-2xs' 
                : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
            }`}
          >
            {isAutoCalc ? <Check className="w-3 h-3 text-emerald-200" /> : <RefreshCw className="w-3 h-3 text-slate-500" />}
            {isAutoCalc ? 'Auto-Calculated from BOM' : 'Re-sync with BOM'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-1 text-center font-mono">
        <div className="bg-white/80 border border-rose-200 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Critical Material Lead Time</div>
          <div className="text-sm font-black text-rose-700 mt-0.5">{maxMatLeadDays} Days</div>
          <div className="text-[10px] text-slate-400">({(maxMatLeadDays / 7).toFixed(1)} Weeks)</div>
        </div>

        <div className="bg-white/80 border border-blue-200 rounded-lg p-2.5">
          <div className="text-[10px] text-slate-500 font-bold uppercase">Manufacturing & Testing</div>
          <div className="text-sm font-black text-blue-700 mt-0.5">{manufacturingDays} Days</div>
          <div className="text-[10px] text-slate-400">({(manufacturingDays / 7).toFixed(1)} Weeks)</div>
        </div>

        <div className="bg-white/90 border border-emerald-300 rounded-lg p-2.5 ring-1 ring-emerald-300">
          <div className="text-[10px] text-emerald-800 font-bold uppercase">Calculated Product Lead Time</div>
          <div className="text-sm font-black text-emerald-800 mt-0.5">{calculatedTotalDays} Days</div>
          <div className="text-[10px] text-emerald-600">({(calculatedTotalDays / 7).toFixed(1)} Weeks)</div>
        </div>
      </div>
      <p className="text-[10px] text-slate-600">
        Formula: <span className="font-semibold text-rose-800">{maxMatLeadDays}d (Material GRN)</span> + <span className="font-semibold text-blue-800">{manufacturingDays}d (Machining, Assembly, QC, Painting, IRN, Dispatch)</span> = <span className="font-bold text-emerald-900">{calculatedTotalDays} Days</span> baseline duration.
      </p>
    </div>
  );

  return (
    <div className="p-8 space-y-8 bg-slate-50 min-h-full text-slate-800">
      
      {/* Module Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              CATALOG GOVERNANCE
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-slate-200 border border-white/20">
              {activeRole}
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">Product Master Catalog</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Manage factory product lines, multi-part raw material BOMs, standard lead times (in Weeks/Days), and dynamic critical path procurement schedules.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openAddModal}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer group shrink-0"
          >
            <Plus className="w-4 h-4 text-emerald-200 group-hover:scale-110 transition-transform" />
            <span>+ Add New Product</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold shadow-xs animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
        <div className="relative flex-1 w-full sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by product name, item code, or raw materials..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <span className="text-slate-500 font-semibold">Category:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer text-xs ${
                selectedCategory === cat
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Catalog List */}
      <div className="space-y-3">
        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-xs">
            No products found matching your search. Click "+ Add New Product" to register one.
          </div>
        ) : (
          filteredProducts.map((prd) => (
            <div key={prd.id} className="bg-white border border-slate-200 rounded-2xl px-6 py-4 shadow-xs hover:border-emerald-300 transition-all group">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs">
                
                {/* Product Core Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-emerald-800 text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {prd.productCode}
                    </span>
                    <h3 className="font-extrabold text-slate-900 text-sm">{prd.productName}</h3>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px]">
                      {prd.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                      prd.designType === 'New Design'
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                      {prd.designType || 'Existing Design'}
                    </span>
                  </div>
                  <p className="text-slate-600 text-xs mt-1 line-clamp-1" title={prd.description || 'No description provided'}>
                    {prd.description || 'Standard valve manufacturing line.'}
                  </p>
                </div>

                {/* Lead Time & Multi-Part Raw Material Badges */}
                <div className="flex items-center gap-6 shrink-0 font-mono">
                  <div className="text-left sm:text-right">
                    <div className="font-bold text-slate-900 text-xs">{formatLeadTime(prd.totalLeadTimeDays)}</div>
                    <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>Mfg: {prd.manufacturingLeadTimeDays ?? 24}d</span>
                    </div>
                  </div>

                  <div className="text-left sm:text-right max-w-[320px]">
                    <div className="flex items-center gap-1.5 flex-wrap justify-start sm:justify-end">
                      {prd.defaultMaterials && prd.defaultMaterials.length > 0 ? (
                        prd.defaultMaterials.map((mat, mIdx) => (
                          <span 
                            key={mIdx}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                              mat.isCriticalPath 
                                ? 'bg-rose-50 border-rose-200 text-rose-800 font-bold' 
                                : 'bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                            title={`${mat.description} (${mat.supplierName}) - Qty: ${mat.qty || 1} ${mat.unit || 'Pcs'} - Lead: ${mat.leadTimeDays}d`}
                          >
                            {mat.itemCode} ({mat.leadTimeDays}d)
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 text-[10px]">Standard Billet</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{prd.defaultMaterials?.length || 0} Raw Material(s) BOM</div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                  {isAdmin ? (
                    <>
                      <button
                        onClick={() => openEditModal(prd)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                        title="Edit product details, lead times, and materials"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                        <span>Edit</span>
                      </button>

                      <button
                        onClick={() => handleDeleteProduct(prd)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                        title="Delete product from catalog"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>Delete</span>
                      </button>
                    </>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-500 font-mono text-[10px] flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" /> Catalog Locked
                    </span>
                  )}
                </div>

              </div>
            </div>
          ))
        )}
      </div>

      {/* ADD NEW PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-base">Add Product to Catalog</h2>
                  <p className="text-xs text-slate-500">Register a new product design with fully connected BOM specifications and dynamic lead time calculation.</p>
                </div>
              </div>

              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" /> {errorMsg}
                </div>
              )}

              {/* Product Code & Product Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">Product Code *</label>
                  <input
                    type="text"
                    placeholder="e.g. CFT-HV-400"
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">Product Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. CFT-HV-400 Gate Valve 4 inch 1500#"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-medium"
                  />
                </div>
              </div>

              {/* Category & Design Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">Category *</label>
                  <select
                    value={isCustomCat ? 'CUSTOM' : category}
                    onChange={(e) => {
                      if (e.target.value === 'CUSTOM') {
                        setIsCustomCat(true);
                      } else {
                        setIsCustomCat(false);
                        setCategory(e.target.value);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    {standardCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="CUSTOM">+ Custom Category...</option>
                  </select>
                  {isCustomCat && (
                    <input
                      type="text"
                      placeholder="Enter custom category name..."
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="mt-2 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                    />
                  )}
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">Design Type *</label>
                  <select
                    value={designType}
                    onChange={(e) => handleDesignTypeChange(e.target.value as DesignType)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer font-medium"
                  >
                    <option value="Existing Design">Existing Design (Standard Flow & Certified)</option>
                    <option value="New Design">New Design (Requires Engineering & CORB/BOM Stage)</option>
                  </select>
                </div>
              </div>

              {/* Manufacturing Duration & Standard Lead Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">
                    Shop-Floor Manufacturing Duration (Days)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={manufacturingDays}
                      onChange={(e) => setManufacturingDays(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-mono font-bold"
                    />
                    <span className="text-slate-500 font-bold text-xs shrink-0">Days</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Machining, Assembly, QC, Painting, IRN & Dispatch time after raw material receipt.
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">
                    Total Product Lead Time
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={leadTimeValue}
                      onChange={(e) => {
                        setIsAutoCalc(false);
                        setLeadTimeValue(Number(e.target.value));
                      }}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-xs font-mono font-bold ${
                        isAutoCalc ? 'bg-emerald-50/50 border-emerald-300 text-emerald-900' : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                    <select
                      value={leadTimeUnit}
                      onChange={(e) => setLeadTimeUnit(e.target.value as 'Days' | 'Weeks')}
                      className="px-3 py-2.5 bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      <option value="Weeks">Weeks</option>
                      <option value="Days">Days</option>
                    </select>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Equivalent to: {leadTimeUnit === 'Weeks' ? `${Math.round(leadTimeValue * 7)} Days` : `${(leadTimeValue / 7).toFixed(1)} Weeks`}
                  </div>
                </div>
              </div>

              {/* Dynamic Calculation Breakdown */}
              {renderCalculationBreakdown()}

              {/* Description */}
              <div>
                <label className="font-bold text-slate-900 block mb-1">Product Description / Engineering Specifications</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Duplex 2205 Castings, Class 1500, High Pressure Hydro tested."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Multi-Raw Material Section */}
              {renderMaterialFields()}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-200" />
                  <span>Save to Product Catalog</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* EDIT PRODUCT MODAL */}
      {editingProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="bg-slate-50 p-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900 text-base">Edit Product Catalog Item</h2>
                  <p className="text-xs text-slate-500">Update specifications, multi-part raw materials, and dynamic lead times.</p>
                </div>
              </div>

              <button onClick={() => setEditingProduct(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateProduct} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" /> {errorMsg}
                </div>
              )}

              {/* Product Code & Product Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">Product Code *</label>
                  <input
                    type="text"
                    value={productCode}
                    onChange={(e) => setProductCode(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">Product Name *</label>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-medium"
                  />
                </div>
              </div>

              {/* Category & Design Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">Category *</label>
                  <select
                    value={isCustomCat ? 'CUSTOM' : category}
                    onChange={(e) => {
                      if (e.target.value === 'CUSTOM') {
                        setIsCustomCat(true);
                      } else {
                        setIsCustomCat(false);
                        setCategory(e.target.value);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    {standardCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                    <option value="CUSTOM">+ Custom Category...</option>
                  </select>
                  {isCustomCat && (
                    <input
                      type="text"
                      placeholder="Enter custom category name..."
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      className="mt-2 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                    />
                  )}
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">Design Type *</label>
                  <select
                    value={designType}
                    onChange={(e) => handleDesignTypeChange(e.target.value as DesignType)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer font-medium"
                  >
                    <option value="Existing Design">Existing Design (Standard Flow & Certified)</option>
                    <option value="New Design">New Design (Requires Engineering & CORB/BOM Stage)</option>
                  </select>
                </div>
              </div>

              {/* Manufacturing Duration & Standard Lead Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-slate-900 block mb-1">
                    Shop-Floor Manufacturing Duration (Days)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={manufacturingDays}
                      onChange={(e) => setManufacturingDays(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600 font-mono font-bold"
                    />
                    <span className="text-slate-500 font-bold text-xs shrink-0">Days</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Machining, Assembly, QC, Painting, IRN & Dispatch time after raw material receipt.
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-900 block mb-1">
                    Total Product Lead Time
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={leadTimeValue}
                      onChange={(e) => {
                        setIsAutoCalc(false);
                        setLeadTimeValue(Number(e.target.value));
                      }}
                      className={`w-full px-3.5 py-2.5 border rounded-xl text-xs font-mono font-bold ${
                        isAutoCalc ? 'bg-emerald-50/50 border-emerald-300 text-emerald-900' : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                    <select
                      value={leadTimeUnit}
                      onChange={(e) => setLeadTimeUnit(e.target.value as 'Days' | 'Weeks')}
                      className="px-3 py-2.5 bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      <option value="Weeks">Weeks</option>
                      <option value="Days">Days</option>
                    </select>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Equivalent to: {leadTimeUnit === 'Weeks' ? `${Math.round(leadTimeValue * 7)} Days` : `${(leadTimeValue / 7).toFixed(1)} Weeks`}
                  </div>
                </div>
              </div>

              {/* Dynamic Calculation Breakdown */}
              {renderCalculationBreakdown()}

              {/* Description */}
              <div>
                <label className="font-bold text-slate-900 block mb-1">Product Description / Engineering Specifications</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Multi-Raw Material Section */}
              {renderMaterialFields()}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-bold shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-200" />
                  <span>Update Product Details</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
