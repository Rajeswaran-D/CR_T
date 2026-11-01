import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import {
  downloadCsvTemplate,
  parseAndValidateCsv,
  type ImportPreviewResult
} from '../../services/csvImportService';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  RefreshCw,
  Eye,
  Info,
  ShieldAlert,
  DollarSign
} from 'lucide-react';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { purchaseOrders, templates, products, activeRole, importPurchaseOrders } = useApp();

  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalBookedValue = useMemo(() => {
    return previewResult
      ? previewResult.previewPOs.reduce((acc, po) => acc + (typeof po.bookedAmount === 'number' && !isNaN(po.bookedAmount) ? po.bookedAmount : 0), 0)
      : 0;
  }, [previewResult]);

  if (!isOpen) return null;

  const runValidation = (text: string) => {
    const result = parseAndValidateCsv(text, purchaseOrders, templates, products, activeRole);
    setPreviewResult(result);
    setSuccessMsg(null);
  };

  const processUploadedFile = (file: File) => {
    setFileName(file.name);
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const wb = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd', cellText: false });
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          const text = XLSX.utils.sheet_to_csv(sheet, { dateNF: 'yyyy-mm-dd', blankrows: false });
          setCsvText(text);
          runValidation(text);
        } catch (err: any) {
          alert('Failed to parse Excel file: ' + (err.message || 'Unknown error'));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setCsvText(text);
        runValidation(text);
      };
      reader.readAsText(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processUploadedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processUploadedFile(file);
  };

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setCsvText(text);
    runValidation(text);
  };

  const isAuthorized = activeRole === 'Project Management' || activeRole === 'Sales / AE (Customer PO)';

  const handleImport = () => {
    if (!isAuthorized) {
      alert(`Permission Denied: Your current role (${activeRole}) is not authorized to bulk import orders.`);
      return;
    }

    if (!previewResult || !previewResult.isValid || previewResult.previewPOs.length === 0) return;

    setIsProcessing(true);
    try {
      const res = importPurchaseOrders(previewResult.previewPOs, replaceExisting);
      if (res.success) {
        setSuccessMsg(`Successfully imported ${res.count} purchase order(s) with ${previewResult.totalProductLines} product line(s)!`);
        setTimeout(() => {
          setIsProcessing(false);
          if (onSuccess) onSuccess();
          onClose();
        }, 1200);
      } else {
        alert(res.error || 'Failed to import orders.');
        setIsProcessing(false);
      }
    } catch (err: any) {
      alert(`Import error: ${err.message || 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setCsvText('');
    setFileName(null);
    setPreviewResult(null);
    setSuccessMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pageSize = 25;

  const filteredPreviewRows = previewResult
    ? previewResult.previewRows.filter(
        row =>
          row.poNumber.toLowerCase().includes(searchFilter.toLowerCase()) ||
          row.customerName.toLowerCase().includes(searchFilter.toLowerCase()) ||
          row.productName.toLowerCase().includes(searchFilter.toLowerCase()) ||
          row.designType.toLowerCase().includes(searchFilter.toLowerCase()) ||
          row.lineNumber.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : [];

  const totalPages = Math.max(1, Math.ceil(filteredPreviewRows.length / pageSize));
  const paginatedRows = filteredPreviewRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white flex items-center justify-between border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Bulk Order Import (Excel / CSV)</h2>
              <p className="text-xs text-slate-300">
                Import in-flight orders with completed stage dates or bulk schedule new customer POs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsvTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer border border-emerald-400/40"
              title="Download standardized CSV import template"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV Template
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-slate-800 text-xs">
          {!isAuthorized && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6 text-center text-amber-900 space-y-2">
              <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto" />
              <p className="font-bold text-sm">Bulk Import Restricted</p>
              <p className="text-xs text-amber-800">
                Your current active role (<strong>{activeRole}</strong>) does not have authorization to import purchase orders. Only <strong>Sales / AE (Customer PO)</strong> or <strong>Project Management (Admin)</strong> can perform bulk imports.
              </p>
            </div>
          )}

          {isAuthorized && (
            <>
              {/* Top Instruction Banner */}
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3.5 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="space-y-1 text-blue-900">
                  <p className="font-semibold">How Bulk Import Works:</p>
                  <p className="text-blue-800 leading-relaxed">
                    Provide <strong>PO Number, Customer, Tag/Line, Qty, Booked Amount</strong>, and fill out historical actual completion dates for stages (e.g. <code>S1_CustomerPO_Actual</code> through <code>S14_Shipment_Actual</code>). The engine automatically marks past stages as completed, activates the current milestone, and derives 14-stage baseline matrix schedules without disrupting ongoing system workflows.
                  </p>
                </div>
              </div>

          {/* Mode Switcher */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setInputMode('upload')}
                className={`px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                  inputMode === 'upload'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Upload CSV / Excel File
              </button>
              <button
                onClick={() => setInputMode('paste')}
                className={`px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                  inputMode === 'paste'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Paste CSV / Excel Text
              </button>
            </div>

            {csvText && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Clear & Reset
              </button>
            )}
          </div>

          {/* Input Area */}
          {inputMode === 'upload' ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                fileName
                  ? 'border-emerald-500 bg-emerald-50/30'
                  : 'border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/10'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv, .xlsx, .xls, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/plain"
                className="hidden"
              />
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="p-3 bg-white shadow-xs rounded-full border border-slate-200 text-emerald-600">
                  <UploadCloud className="w-8 h-8" />
                </div>
                {fileName ? (
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{fileName}</p>
                    <p className="text-slate-500 text-xs mt-0.5">Click or drag a new file to replace</p>
                  </div>
                ) : (
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Drag & drop your Excel (.xlsx) or CSV file here, or click to browse</p>
                    <p className="text-slate-500 text-xs mt-0.5">Supported formats: Excel (.xlsx, .xls) and CSV (.csv)</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700">Paste Raw CSV / Spreadsheet Rows:</label>
              <textarea
                rows={6}
                value={csvText}
                onChange={handlePasteChange}
                placeholder="PO Number,Customer Name,Customer PO Ref,Customer PO Date,Contractual Delivery Date,Product Name,Design Type,Quantity,S1_CustomerPO_Actual,S2_PMBaseline_Actual..."
                className="w-full font-mono text-[11px] p-3 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-600 bg-slate-50"
              />
            </div>
          )}

          {/* Validation & Preview Section */}
          {previewResult && (
            <div className="space-y-4 pt-2 border-t border-slate-200">
              
              {/* Summary Metrics */}
              <div className={`grid grid-cols-2 ${totalBookedValue > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3`}>
                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 font-medium">Detected POs</span>
                  <p className="text-lg font-black text-slate-900 mt-0.5">{previewResult.totalPOs}</p>
                </div>
                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 font-medium">Total Product Lines</span>
                  <p className="text-lg font-black text-slate-900 mt-0.5">{previewResult.totalProductLines}</p>
                </div>
                {totalBookedValue > 0 && (
                  <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-emerald-900">
                    <span className="text-emerald-700 font-medium flex items-center gap-1 text-xs">
                      <DollarSign className="w-3.5 h-3.5" /> Booked Value
                    </span>
                    <p className="text-lg font-black text-emerald-950 font-mono mt-0.5">
                      ${totalBookedValue.toLocaleString()}
                    </p>
                  </div>
                )}
                <div className={`p-3 rounded-xl border ${previewResult.errors.length > 0 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                  <span className="font-medium">Validation Status</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {previewResult.isValid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="font-bold text-emerald-700">Ready to Import</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-rose-600" />
                        <span className="font-bold text-rose-700">{previewResult.errors.length} Error(s)</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-amber-900">
                  <span className="font-medium">Warnings / Notices</span>
                  <p className="text-lg font-black mt-0.5">{previewResult.warnings.length}</p>
                </div>
              </div>

              {/* Errors Display */}
              {previewResult.errors.length > 0 && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5 text-rose-900">
                  <div className="flex items-center gap-1.5 font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Import Blocked - Please fix the following errors in your CSV:</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-[11px] text-rose-800">
                    {previewResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings Display */}
              {previewResult.warnings.length > 0 && (
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-1 text-amber-900">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Notices & Auto-Adjustments ({previewResult.warnings.length}):</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-amber-800 max-h-24 overflow-y-auto">
                    {previewResult.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview Table Header & Search */}
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-slate-500" />
                    <h3 className="font-bold text-slate-800">Parsed Order Schedule Preview</h3>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                      {filteredPreviewRows.length} total line(s)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Filter by PO, customer, product..."
                      value={searchFilter}
                      onChange={(e) => {
                        setSearchFilter(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 w-56"
                    />
                  </div>
                </div>

                {/* Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs max-h-64 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="py-2 px-3">PO Number</th>
                        <th className="py-2 px-3">Customer</th>
                        <th className="py-2 px-3">Line Item & Product</th>
                        <th className="py-2 px-3">Design Type</th>
                        <th className="py-2 px-3">Qty</th>
                        <th className="py-2 px-3 text-right">Booked Amount</th>
                        <th className="py-2 px-3">PO Date</th>
                        <th className="py-2 px-3">Completed Stages</th>
                        <th className="py-2 px-3">Active Stage</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {paginatedRows.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-6 text-center text-slate-400">
                            No matching preview rows found.
                          </td>
                        </tr>
                      ) : (
                        paginatedRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2 px-3 font-mono font-bold text-slate-900">{row.poNumber}</td>
                            <td className="py-2 px-3 font-medium text-slate-800">{row.customerName}</td>
                            <td className="py-2 px-3 text-slate-700">
                              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px] text-slate-700 font-bold mr-1">{row.lineNumber}</span>
                              {row.productName}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                row.designType === 'New Design'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}>
                                {row.designType}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-bold font-mono text-slate-900">{row.qty} pcs</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-800">
                              {typeof row.bookedAmount === 'number' && !isNaN(row.bookedAmount) && row.bookedAmount > 0
                                ? `$${row.bookedAmount.toLocaleString()}`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">{row.customerPoDate}</td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                                  <div
                                    className={`h-full rounded-full ${
                                      row.completedStagesCount === 14 ? 'bg-emerald-500' : 'bg-blue-500'
                                    }`}
                                    style={{ width: `${(row.completedStagesCount / 14) * 100}%` }}
                                  />
                                </div>
                                <span className="font-bold text-slate-700 text-[10px]">
                                  {row.completedStagesCount}/14
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-800">
                              {row.currentActiveStageName}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  row.status === 'Completed'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : row.status === 'In Progress'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
                    <div>
                      Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredPreviewRows.length)} of {filteredPreviewRows.length} rows
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-700 font-bold cursor-pointer"
                      >
                        Prev
                      </button>
                      <span className="font-mono px-2 py-0.5 bg-slate-50 border border-slate-200 rounded font-bold">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded text-slate-700 font-bold cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Overwrite Option */}
              <div className="flex items-center gap-2 pt-1 text-slate-700">
                <input
                  type="checkbox"
                  id="replaceExisting"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 border-slate-300 cursor-pointer"
                />
                <label htmlFor="replaceExisting" className="cursor-pointer select-none font-medium">
                  Overwrite existing Purchase Orders if matching PO Number is found (uncheck to auto-append suffix)
                </label>
              </div>
            </div>
          )}
          </>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-3 text-emerald-900 font-bold">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition-all cursor-pointer"
          >
            Cancel
          </button>

          {isAuthorized && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!previewResult || !previewResult.isValid || isProcessing || previewResult.previewPOs.length === 0}
                onClick={handleImport}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer ${
                  previewResult && previewResult.isValid && !isProcessing && previewResult.previewPOs.length > 0
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Importing & Generating Schedules...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    Import {previewResult ? previewResult.totalPOs : 0} Orders ({previewResult ? previewResult.totalProductLines : 0} Product Lines)
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
