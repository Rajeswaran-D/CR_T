import React, { useState } from 'react';
import { X, Layers, Database, ShieldCheck, GitMerge, AlertTriangle } from 'lucide-react';

interface SystemBlueprintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemBlueprintModal: React.FC<SystemBlueprintModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'blueprint' | 'datamodel' | 'roles' | 'flows' | 'assumptions'>('blueprint');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden text-slate-800">
        
        {/* Modal Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-700 text-white shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Delivery Item #1: System Blueprint & Architecture</h2>
              <p className="text-xs text-slate-500">Circor Flow Technologies Project Tracker - Technical & Business Specification</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-slate-100 px-6 border-b border-slate-200 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
          <button
            onClick={() => setActiveTab('blueprint')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'blueprint'
                ? 'border-emerald-600 text-emerald-800 font-bold bg-white'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            Module Map
          </button>
          <button
            onClick={() => setActiveTab('datamodel')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'datamodel'
                ? 'border-emerald-600 text-emerald-800 font-bold bg-white'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4" />
            Data Model & Rules
          </button>
          <button
            onClick={() => setActiveTab('roles')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'roles'
                ? 'border-emerald-600 text-emerald-800 font-bold bg-white'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            User Roles Matrix
          </button>
          <button
            onClick={() => setActiveTab('flows')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'flows'
                ? 'border-emerald-600 text-emerald-800 font-bold bg-white'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <GitMerge className="w-4 h-4" />
            End-to-End Business Flow
          </button>
          <button
            onClick={() => setActiveTab('assumptions')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'assumptions'
                ? 'border-emerald-600 text-emerald-800 font-bold bg-white'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Assumptions for Approval
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-700 bg-white">
          
          {/* TAB 1: MODULE MAP */}
          {activeTab === 'blueprint' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Enterprise ERP Module Structure</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { title: '1. Dashboard', desc: 'KPI summary, high-risk PO alerts, milestone bottleneck charts, critical path rollup.' },
                  { title: '2. Purchase Orders', desc: 'PO list, search/filter, header detail, product line creation, baseline revision log, attachments.' },
                  { title: '3. Projects', desc: 'Product-line schedule table & interactive Gantt timeline (Baseline vs Actual vs Forecast).' },
                  { title: '4. Design', desc: 'Drawing verification (Existing) and Concept -> CAD -> Prototype -> Approval (New Design).' },
                  { title: '5. Procurement', desc: 'Itemized material lead times, critical path tagging, GRN incoming inspection records.' },
                  { title: '6. Production', desc: 'Work order execution, strict dependency validation (Design + Material GRN), shop floor logs.' },
                  { title: '7. Delays and Actions', desc: 'Delay register, mandatory cause & owner tagging, rule-based rectification proposals.' },
                  { title: '8. Reports', desc: 'On-Time Delivery % (OTD), average delay per milestone, supplier lead-time performance.' },
                  { title: '9. Administration', desc: 'Category templates, default durations, user roles, risk thresholds, immutable audit log.' }
                ].map(mod => (
                  <div key={mod.title} className="p-4 bg-slate-50 border border-slate-200 rounded-lg hover:border-emerald-400 transition-colors">
                    <div className="font-bold text-slate-900 mb-1 text-xs">{mod.title}</div>
                    <p className="text-[11px] text-slate-600 leading-normal">{mod.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: DATA MODEL */}
          {activeTab === 'datamodel' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Core Relational Data Schema</h3>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-800 overflow-x-auto shadow-inner">
                <pre>{`
  +-----------------------+           +-----------------------+
  |    PurchaseOrder      | 1       * |      ProductLine      |
  +-----------------------+-----------+-----------------------+
  | poNumber (PK)         |           | id (PK), lineNumber   |
  | customerName          |           | productName           |
  | committedDeliveryDate |           | designType (Exist/New)|
  | revisedDeliveryDate   |           | overallVarianceDays   |
  | isClosed: boolean     |           +-----------+-----------+
  +-----------+-----------+                       |
              | 1                                 | 1
              | *                                 | *
  +-----------v-----------+           +-----------v-----------+
  |   BaselineRevision    |           |       Milestone       |
  +-----------------------+           +-----------------------+
  | revNumber (0,1,2...)  |           | key (po_review, etc)  |
  | requestedBy, approvedBy|          | defaultDurationDays   |
  | reason, docRef        |           | committedBaselineStart|
  | changes: JsonArray    |           | committedBaselineEnd  |
  +-----------------------+           | actualStart, actualEnd|
                                      | forecastStart, End    |
                                      | status, varianceDays  |
                                      +-----------+-----------+
                                                  | 1
                                                  | *
                                      +-----------v-----------+
                                      |     MaterialItem      |
                                      +-----------------------+
                                      | itemCode, description |
                                      | leadTimeDays, isCrit  |
                                      | grnNumber, inspection |
                                      +-----------------------+
                `}</pre>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-slate-800">
                <span className="font-bold text-emerald-900">Calculation Formulas:</span>
                <ul className="list-disc pl-5 mt-1 text-[11px] space-y-1 text-slate-700">
                  <li><strong>Milestone Variance:</strong> <code className="text-emerald-900 font-bold">(Actual End OR Forecast End) - Committed Baseline End</code></li>
                  <li><strong>Forecast Completion:</strong> <code className="text-emerald-900 font-bold">Today + Remaining Durations</code> (respecting upstream dependencies)</li>
                  <li><strong>Critical Path:</strong> Longest-lead material item determines earliest possible incoming inspection & production start.</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 3: ROLES MATRIX */}
          {activeTab === 'roles' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Role-Based Access Control (RBAC) Matrix</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-slate-200 text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                      <th className="p-3 border-r border-slate-200">Role</th>
                      <th className="p-3 border-r border-slate-200">Allowed Actions</th>
                      <th className="p-3 border-r border-slate-200">Restricted Actions</th>
                      <th className="p-3">Primary Responsibility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">Sales</td>
                      <td className="p-3 border-r border-slate-200">Log PO, Create Product Lines, Request Baseline Revision</td>
                      <td className="p-3 border-r border-slate-200">Cannot approve Design or update GRN</td>
                      <td className="p-3">Customer contract alignment & scope changes</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">Design</td>
                      <td className="p-3 border-r border-slate-200">Approve Design stages, upload CAD/Drawing refs & ECNs</td>
                      <td className="p-3 border-r border-slate-200">Cannot start Production or log GRN</td>
                      <td className="p-3">Engineering design release & BOM finalization</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">Purchase</td>
                      <td className="p-3 border-r border-slate-200">Update Material status (Ordered, Expected, Received)</td>
                      <td className="p-3 border-r border-slate-200">Cannot complete QC or revise PO Baseline</td>
                      <td className="p-3">Raw material procurement & supplier tracking</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">Production</td>
                      <td className="p-3 border-r border-slate-200">Record Production Start/Complete (with dependency check)</td>
                      <td className="p-3 border-r border-slate-200">Cannot start if Design/Materials incomplete</td>
                      <td className="p-3">Shop floor machining & component assembly</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">QC</td>
                      <td className="p-3 border-r border-slate-200">Record GRN inspection results & Hydro-test QC certificates</td>
                      <td className="p-3 border-r border-slate-200">Cannot bypass rejected material inspections</td>
                      <td className="p-3">Quality assurance & material test certs</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-bold text-emerald-800 border-r border-slate-200">Management / Admin</td>
                      <td className="p-3 border-r border-slate-200">Approve Baseline Revisions, Accept Rectifications, Close POs</td>
                      <td className="p-3 border-r border-slate-200">Full administrative authorization</td>
                      <td className="p-3">Overall contract governance & baseline control</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: FLOWS */}
          {activeTab === 'flows' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider">End-to-End Business Flow Diagram</h3>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-mono text-[11px] space-y-2">
                <div className="text-emerald-800 font-bold">[1] Sales Logs Customer PO</div>
                <div className="pl-4">└── Select Category & Design Tag (Existing / New) ➔ Default Schedule Auto-Generates from Admin Template</div>
                
                <div className="text-emerald-800 font-bold mt-2">[2] Negotiated Baseline Revision</div>
                <div className="pl-4">└── Enter revised durations + Reason + Doc Ref ➔ Approval by Management ➔ Rev 1 Baseline Locked</div>
                
                <div className="text-emerald-800 font-bold mt-2">[3] Design Stage & BOM Finalization</div>
                <div className="pl-4">└── Design Engineer uploads Drawing Ref & Approval ➔ Unlocks Procurement for New Design</div>
                
                <div className="text-emerald-800 font-bold mt-2">[4] Material Procurement & GRN Inspection</div>
                <div className="pl-4">└── Purchase updates Expected arrival ➔ Longest lead defines Critical Path ➔ QC passes GRN Inspection</div>
                
                <div className="text-emerald-800 font-bold mt-2">[5] Production Execution (Strict Guardrail)</div>
                <div className="pl-4">└── Guardrail Check: [Design Approved AND Critical Materials Passed GRN] ➔ Production Starts</div>
                
                <div className="text-emerald-800 font-bold mt-2">[6] QC, Packing, Dispatch & PO Closure</div>
                <div className="pl-4">└── Pressure Hydro-test ➔ FAT Packaging ➔ Port Dispatch ➔ Site Signoff ➔ PO Closed with Final Variance Report</div>
              </div>
            </div>
          )}

          {/* TAB 5: ASSUMPTIONS */}
          {activeTab === 'assumptions' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wider">Business & Technical Assumptions for User Review</h3>
              
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                <div className="font-bold text-amber-900">1. Calendar Days vs Working Days</div>
                <p className="text-[11px] text-slate-700">
                  Calculations use standard 7-day calendar days for contract baseline compliance. (Configurable to 5-day manufacturing work week if requested).
                </p>

                <div className="font-bold text-amber-900">2. Critical Path Material Rule</div>
                <p className="text-[11px] text-slate-700">
                  The material with the longest lead time is tagged as the Critical Path item. Production forecast start date is dynamically gated by this item's GRN passed inspection date.
                </p>

                <div className="font-bold text-amber-900">3. Immutable Baseline Revision Control</div>
                <p className="text-[11px] text-slate-700">
                  Original agreed customer baseline is NEVER overwritten. Every baseline duration change generates a numbered revision record (<code className="text-emerald-800 font-bold">Rev 0, Rev 1, Rev 2...</code>) with mandatory written reason, document reference, and approver timestamp.
                </p>

                <div className="font-bold text-amber-900">4. Offline Mode Behavior</div>
                <p className="text-[11px] text-slate-700">
                  PWA supports offline entry for manual points. Backdated event entries require a mandatory written justification and record both real-world event timestamp and system entry timestamp.
                </p>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                <span className="text-emerald-800 font-bold">Status: Blueprint Approved & Active in Prototype</span>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors shadow-xs cursor-pointer"
          >
            Close Blueprint
          </button>
        </div>

      </div>
    </div>
  );
};
