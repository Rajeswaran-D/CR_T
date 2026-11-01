import type { PurchaseOrder, CategoryTemplate, AuditLogEntry, RectificationAction, SystemConfig } from '../types';

export const INITIAL_TEMPLATES: CategoryTemplate[] = [
  {
    id: 'tmpl-existing',
    categoryName: 'Standard Flow Valves & Systems',
    designType: 'Existing Design',
    milestoneDurations: [
      { milestoneKey: 'po_from_customer', milestoneName: '1. Customer Purchase Order (PO)', durationDays: 1 },
      { milestoneKey: 'pm_baseline', milestoneName: '2. Baseline Review & Planning', durationDays: 3 },
      { milestoneKey: 'corb_release', milestoneName: '3. CORB Release', durationDays: 2 },
      { milestoneKey: 'bom_release', milestoneName: '4. BOM Release', durationDays: 3 },
      { milestoneKey: 'wo_release', milestoneName: '5. Work Order Release', durationDays: 2 },
      { milestoneKey: 'sub_supplier_po', milestoneName: '6. Sub-Supplier PO', durationDays: 3 },
      { milestoneKey: 'material_receipt', milestoneName: '7. Material Receipt (GRN)', durationDays: 14 },
      { milestoneKey: 'machining', milestoneName: '8. Machining', durationDays: 14 },
      { milestoneKey: 'assembly', milestoneName: '9. Assembly', durationDays: 5 },
      { milestoneKey: 'fg', milestoneName: '10. FG', durationDays: 2 },
      { milestoneKey: 'customer_inspection', milestoneName: '11. Customer Inspection', durationDays: 2 },
      { milestoneKey: 'painting', milestoneName: '12. Painting', durationDays: 2 },
      { milestoneKey: 'trn', milestoneName: '13. TRN', durationDays: 1 },
      { milestoneKey: 'shipment', milestoneName: '14. Final Shipment & Dispatch', durationDays: 5 }
    ]
  },
  {
    id: 'tmpl-new',
    categoryName: 'Standard Flow Valves & Systems',
    designType: 'New Design',
    milestoneDurations: [
      { milestoneKey: 'po_from_customer', milestoneName: '1. Customer Purchase Order (PO)', durationDays: 1 },
      { milestoneKey: 'pm_baseline', milestoneName: '2. Baseline Review & Planning', durationDays: 5 },
      { milestoneKey: 'corb_release', milestoneName: '3. CORB Release', durationDays: 4 },
      { milestoneKey: 'bom_release', milestoneName: '4. BOM Release', durationDays: 7 },
      { milestoneKey: 'wo_release', milestoneName: '5. Work Order Release', durationDays: 3 },
      { milestoneKey: 'sub_supplier_po', milestoneName: '6. Sub-Supplier PO', durationDays: 5 },
      { milestoneKey: 'material_receipt', milestoneName: '7. Material Receipt (GRN)', durationDays: 30 },
      { milestoneKey: 'machining', milestoneName: '8. Machining', durationDays: 22 },
      { milestoneKey: 'assembly', milestoneName: '9. Assembly', durationDays: 8 },
      { milestoneKey: 'fg', milestoneName: '10. FG', durationDays: 3 },
      { milestoneKey: 'customer_inspection', milestoneName: '11. Customer Inspection', durationDays: 3 },
      { milestoneKey: 'painting', milestoneName: '12. Painting', durationDays: 3 },
      { milestoneKey: 'trn', milestoneName: '13. TRN', durationDays: 1 },
      { milestoneKey: 'shipment', milestoneName: '14. Final Shipment & Dispatch', durationDays: 7 }
    ]
  }
];

export const INITIAL_PURCHASE_ORDERS: PurchaseOrder[] = [];

export const INITIAL_RECTIFICATIONS: RectificationAction[] = [];

export const INITIAL_AUDIT_LOG: AuditLogEntry[] = [];

export const INITIAL_PRODUCTS: any[] = [
  {
    id: 'prd-101',
    productCode: 'CFT-HV-100',
    productName: 'CFT-HV-100 Gate Valve 2 inch 600#',
    category: 'High-Pressure Control Valves',
    designType: 'Existing Design',
    totalLeadTimeDays: 42,
    description: 'Class 600 High Pressure Carbon Steel Gate Valve for refinery gas applications.',
    defaultMaterials: [
      { itemCode: 'MAT-CS-600-BODY', description: 'ASTM A216 WCB Cast Body', supplierName: 'Sandvik Precision Castings', leadTimeDays: 18, isCriticalPath: true },
      { itemCode: 'MAT-STEM-316', description: 'SS 316 L Valve Stem Rod', supplierName: 'Flowserve Materials', leadTimeDays: 10, isCriticalPath: false }
    ],
    createdAt: '2026-08-01T00:00:00Z'
  },
  {
    id: 'prd-102',
    productCode: 'CFT-HV-200',
    productName: 'CFT-HV-200 Gate Valve 3 inch 900#',
    category: 'High-Pressure Control Valves',
    designType: 'Existing Design',
    totalLeadTimeDays: 42,
    description: 'Class 900 Alloy Steel Gate Valve for high pressure steam injection.',
    defaultMaterials: [
      { itemCode: 'MAT-ALLOY-900', description: 'ASTM A217 WC9 Alloy Body', supplierName: 'Vallourec Forgings', leadTimeDays: 20, isCriticalPath: true }
    ],
    createdAt: '2026-08-01T00:00:00Z'
  },
  {
    id: 'prd-103',
    productCode: 'CFT-HV-300',
    productName: 'CFT-HV-300 Gate Valve 4 inch 1500#',
    category: 'High-Pressure Control Valves',
    designType: 'Existing Design',
    totalLeadTimeDays: 49,
    description: 'Class 1500 Duplex Stainless Steel Gate Valve for subsea offshore lines.',
    defaultMaterials: [
      { itemCode: 'MAT-DSS-316L-CAST', description: 'Duplex 2205 Stainless Steel Cast Body', supplierName: 'Sandvik Precision Castings', leadTimeDays: 25, isCriticalPath: true }
    ],
    createdAt: '2026-08-01T00:00:00Z'
  },
  {
    id: 'prd-104',
    productCode: 'CFT-EMF-100',
    productName: 'CFT-EMF-100 Electromagnetic Flowmeter DN50',
    category: 'Electromagnetic Flowmeters',
    designType: 'Existing Design',
    totalLeadTimeDays: 32,
    description: 'DN50 Smart Magmeter with PTFE liner and Hastelloy C electrodes.',
    defaultMaterials: [
      { itemCode: 'MAT-SENSOR-COIL-DN50', description: 'Hastelloy C Electrodes & Coil Assembly', supplierName: 'Endress+Hauser Sensor Tech', leadTimeDays: 14, isCriticalPath: true }
    ],
    createdAt: '2026-08-01T00:00:00Z'
  },
  {
    id: 'prd-105',
    productCode: 'CFT-EMF-200',
    productName: 'CFT-EMF-200 Electromagnetic Flowmeter DN80',
    category: 'Electromagnetic Flowmeters',
    designType: 'Existing Design',
    totalLeadTimeDays: 32,
    description: 'DN80 High Accuracy Electromagnetic Flowmeter for chemical transfer.',
    defaultMaterials: [
      { itemCode: 'MAT-SENSOR-COIL-DN80', description: 'Hastelloy C Electrodes & Coil Assembly', supplierName: 'Endress+Hauser Sensor Tech', leadTimeDays: 14, isCriticalPath: true }
    ],
    createdAt: '2026-08-01T00:00:00Z'
  }
];

export const INITIAL_CONFIG: SystemConfig = {
  atRiskThresholdDays: 3,
  delayedThresholdDays: 7,
  offlineSyncQueue: [],
  enablePushNotifications: true
};
