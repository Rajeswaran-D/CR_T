import type { Pool, PoolConnection } from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logDbActivity } from './dbLogger';

/**
 * Safely constraints any ID string to <= 36 characters (fits MySQL CHAR(36) and VARCHAR).
 * If the string is already <= 36 characters, returns it unmodified.
 * If longer than 36 characters, returns a deterministic prefix-MD5 hex hash (<= 36 chars).
 */
export function toDbId(id: string | undefined | null, prefix = 'id'): string {
  if (!id) {
    return `${prefix.slice(0, 3)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 36);
  }
  const str = String(id).trim();
  if (str.length <= 36) {
    return str;
  }
  const hash = crypto.createHash('md5').update(str).digest('hex');
  const p = str.includes('-') ? str.split('-')[0].slice(0, 3) : prefix.slice(0, 3);
  return `${p}-${hash}`.slice(0, 36);
}
import type {
  PurchaseOrder,
  ProductLine,
  Milestone,
  MaterialItem,
  ProductMasterItem,
  CategoryTemplate,
  RectificationAction,
  AuditLogEntry,
  SystemConfig,
  CancellationRequest
} from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ORG_ID = 'circor-flow-technologies';

/**
 * Safely formats any database date value (string, Date object, or legacy truncated string)
 * into a canonical YYYY-MM-DD calendar string. Never truncates Date.toString()
 * into broken day-names (e.g. "Wed Oct 14").
 */
export function formatDbDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  // If string has format like "Wed Oct 14" without a 4-digit year:
  if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}$/.test(str)) {
    const currentYear = new Date().getFullYear();
    const withYear = `${str} ${currentYear}`;
    const p = new Date(withYear);
    if (!isNaN(p.getTime())) {
      const m = String(p.getMonth() + 1).padStart(2, '0');
      const d = String(p.getDate()).padStart(2, '0');
      return `${currentYear}-${m}-${d}`;
    }
  }
  const parsed = new Date(val);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str.slice(0, 10);
}

/**
 * Ensures the target organization exists in the organizations table.
 */
export async function ensureOrganization(conn: PoolConnection, orgId: string, orgName?: string): Promise<void> {
  const name = orgName || (orgId === DEFAULT_ORG_ID ? 'CIRCOR Flow Technologies' : orgId);
  await conn.query(
    `INSERT INTO organizations (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [orgId, name]
  );
}

/**
 * Initializes the database schema from database/mysql-schema.sql if needed.
 */
export async function initSchema(pool: Pool): Promise<{ success: boolean; executedCount: number }> {
  const schemaPath = path.join(__dirname, '../database/mysql-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`mysql-schema.sql not found at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = sql
    .split(/;\s*[\r\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('SET '));

  const conn = await pool.getConnection();
  let executedCount = 0;
  try {
    for (const stmt of statements) {
      if (stmt.toUpperCase().startsWith('CREATE TABLE')) {
        // Use CREATE TABLE IF NOT EXISTS to prevent errors on restart
        const safeStmt = stmt.replace(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ');
        await conn.query(safeStmt);
        executedCount++;
      } else {
        try {
          await conn.query(stmt);
          executedCount++;
        } catch {
          // Ignore secondary statements that already exist
        }
      }
    }

    await ensureOrganization(conn, DEFAULT_ORG_ID, 'CIRCOR Flow Technologies');
    await ensureOrganization(conn, 'local-development', 'Local Development Org');

    // Safely widen existing tables from CHAR(36) to VARCHAR(128) to prevent ER_DATA_TOO_LONG
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      const tablesToWiden = [
        ['organizations', ['id']],
        ['users', ['id', 'organization_id']],
        ['purchase_orders', ['id', 'organization_id', 'created_by', 'last_updated_by']],
        ['po_attachments', ['id', 'organization_id', 'purchase_order_id', 'uploaded_by']],
        ['product_lines', ['id', 'organization_id', 'purchase_order_id']],
        ['milestones', ['id', 'organization_id', 'product_line_id', 'last_updated_by']],
        ['materials', ['id', 'organization_id', 'product_line_id', 'updated_by']],
        ['baseline_revisions', ['id', 'organization_id', 'purchase_order_id', 'requested_by', 'approved_by']],
        ['baseline_revision_changes', ['id', 'organization_id', 'baseline_revision_id', 'product_line_id']],
        ['product_catalog', ['id', 'organization_id']],
        ['product_catalog_materials', ['id', 'organization_id', 'product_id']],
        ['category_templates', ['id', 'organization_id']],
        ['category_template_milestones', ['id', 'organization_id', 'template_id']],
        ['rectification_actions', ['id', 'organization_id', 'purchase_order_id', 'product_line_id', 'decision_by']],
        ['system_config', ['organization_id']],
        ['audit_logs', ['id', 'organization_id', 'purchase_order_id', 'user_id']],
        ['subdivisions', ['id', 'organization_id', 'milestone_id', 'owner_user_id']],
        ['po_slot_assignments', ['id', 'organization_id', 'purchase_order_id', 'user_id']],
        ['cancellation_requests', ['id', 'organization_id', 'purchase_order_id']]
      ];
      for (const [table, cols] of tablesToWiden) {
        for (const col of cols as string[]) {
          try {
            await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${col}\` VARCHAR(128)`);
          } catch {}
        }
      }
    } catch {
      // Non-fatal if DB user lacks alter permissions
    } finally {
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch {}
    }

    logDbActivity('SCHEMA', 'mysql_schema', `Applied schema DDL (${executedCount} statements executed)`);
    return { success: true, executedCount };
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Schema VERIFICATION (read-only) — used on startup and by status endpoints.
// Never executes DDL. Schema application (initSchema) is administration and is
// only reachable through the token-protected POST /api/db/init-schema route.
// ---------------------------------------------------------------------------

export async function verifySchema(pool: Pool): Promise<{ expected: string[]; present: string[]; missing: string[] }> {
  const schemaPath = path.join(__dirname, '../database/mysql-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error('mysql-schema.sql not found');
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const expected: string[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (!expected.includes(m[1])) expected.push(m[1]);
  }

  const [rows] = await pool.query<any[]>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()`
  );
  const presentSet = new Set(rows.map(r => String(r.t)));
  const present = expected.filter(t => presentSet.has(t));
  const missing = expected.filter(t => !presentSet.has(t));
  logDbActivity('SCHEMA', 'information_schema', `Verified schema tables (${present.length}/${expected.length} present${missing.length > 0 ? `, missing: ${missing.join(', ')}` : ''})`);
  return { expected, present, missing };
}

// ---------------------------------------------------------------------------
// Purchase Orders & Milestones
// ---------------------------------------------------------------------------

export async function saveOrdersToDb(pool: Pool, orgId: string, orders: PurchaseOrder[]): Promise<void> {
  if (!orders || !Array.isArray(orders)) return;

  const startMs = performance.now();
  const poNumbers = orders.map(o => o.poNumber).filter(Boolean);
  logDbActivity('TX:START', 'purchase_orders', `Begin persist transaction for ${orders.length} order(s) [${poNumbers.join(', ')}]`, { orgId });

  const conn = await pool.getConnection();
  let totalLines = 0;
  let totalMilestones = 0;
  let totalMaterials = 0;
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    const incomingIds = orders
      .filter(po => po.id)
      .map(po => toDbId(po.id, 'po'));
    const existingUpdatedAt = new Map<string, number>();
    if (incomingIds.length > 0) {
      const [existingRows] = await conn.query(
        'SELECT id, updated_at FROM purchase_orders WHERE organization_id = ? AND id IN (?)',
        [orgId, incomingIds]
      );
      for (const row of existingRows as Array<{ id: string; updated_at?: Date | string | null }>) {
        const timestamp = row.updated_at ? new Date(row.updated_at).getTime() : NaN;
        if (Number.isFinite(timestamp)) existingUpdatedAt.set(row.id, timestamp);
      }
    }

    for (const po of orders) {
      if (!po.id || !po.poNumber) continue;
      const poId = toDbId(po.id, 'po');
      const incomingTimestamp = po.lastUpdatedAt ? Date.parse(po.lastUpdatedAt) : NaN;
      const storedTimestamp = existingUpdatedAt.get(poId);
      // Shared-state requests contain complete order snapshots. Ignore an older
      // tab snapshot rather than letting it overwrite a newer backend version.
      if (
        Number.isFinite(incomingTimestamp) &&
        storedTimestamp !== undefined &&
        incomingTimestamp < storedTimestamp
      ) {
        continue;
      }
      totalLines += (po.productLines || []).length;
      totalMilestones += (po.productLines || []).reduce((acc, l) => acc + (l.milestones || []).length, 0);
      totalMaterials += (po.productLines || []).reduce((acc, l) => acc + (l.materials || []).length, 0);

      const poDate = formatDbDate(po.poDate) || new Date().toISOString().slice(0, 10);
      const committedDate = formatDbDate(po.committedDeliveryDate) || poDate;
      const revisedDate = formatDbDate(po.revisedDeliveryDate) || committedDate;
      const actualDeliveryDate = po.actualDeliveryDate ? formatDbDate(po.actualDeliveryDate) : null;
      const bookedAmount = typeof po.bookedAmount === 'number' ? po.bookedAmount : null;

      await conn.query(
        `INSERT INTO purchase_orders (
          id, organization_id, po_number, customer_name, customer_po_ref,
          po_date, booked_amount, contract_review_ref, committed_delivery_date,
          revised_delivery_date, actual_delivery_date, status, is_closed,
          closure_notes, is_cancelled, cancellation_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          customer_name = VALUES(customer_name),
          customer_po_ref = VALUES(customer_po_ref),
          po_date = VALUES(po_date),
          booked_amount = VALUES(booked_amount),
          contract_review_ref = VALUES(contract_review_ref),
          committed_delivery_date = VALUES(committed_delivery_date),
          revised_delivery_date = VALUES(revised_delivery_date),
          actual_delivery_date = VALUES(actual_delivery_date),
          status = VALUES(status),
          is_closed = VALUES(is_closed),
          closure_notes = VALUES(closure_notes),
          is_cancelled = VALUES(is_cancelled),
          cancellation_reason = VALUES(cancellation_reason),
          updated_at = CURRENT_TIMESTAMP`,
        [
          poId,
          orgId,
          po.poNumber,
          po.customerName || '',
          po.customerPoRef || '',
          poDate,
          bookedAmount,
          po.contractReviewRef || '',
          committedDate,
          revisedDate,
          actualDeliveryDate,
          po.status || 'In Progress',
          Boolean(po.isClosed),
          po.closureNotes || null,
          Boolean(po.isCancelled),
          po.cancellationReason || null
        ]
      );

      // Save Attachments (metadata only — no binary payload in current frontend type)
      if (Array.isArray(po.attachments)) {
        for (const att of po.attachments) {
          if (!att.id) continue;
          const attId = toDbId(att.id, 'att');
          await conn.query(
            `INSERT INTO po_attachments (
               id, organization_id, purchase_order_id, file_name, attachment_type, file_size
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               file_name = VALUES(file_name),
               attachment_type = VALUES(attachment_type),
               file_size = VALUES(file_size)`,
            [
              attId,
              orgId,
              poId,
              att.name || 'attachment',
              att.type || 'General',
              att.size || ''
            ]
          );
        }
      }

      // Save Product Lines
      if (Array.isArray(po.productLines)) {
        for (const line of po.productLines) {
          if (!line.id) continue;
          const lineId = toDbId(line.id, 'lin');

          await conn.query(
            `INSERT INTO product_lines (
              id, organization_id, purchase_order_id, line_number, product_name,
              category, quantity, design_type, status, overall_variance_days, delay_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              product_name = VALUES(product_name),
              category = VALUES(category),
              quantity = VALUES(quantity),
              design_type = VALUES(design_type),
              status = VALUES(status),
              overall_variance_days = VALUES(overall_variance_days),
              delay_reason = VALUES(delay_reason)`,
            [
              lineId,
              orgId,
              poId,
              line.lineNumber || 'LINE-01',
              line.productName || '',
              line.category || 'Valves',
              line.qty || 1,
              line.designType || 'Existing Design',
              line.status || 'Not Started',
              line.overallVarianceDays || 0,
              line.delayReason || null
            ]
          );

          // Save Milestones
          if (Array.isArray(line.milestones)) {
            for (const ms of line.milestones) {
              if (!ms.id || !ms.key) continue;
              const msId = toDbId(ms.id || `${lineId}-${ms.key}`, 'ms');

              const bStart = formatDbDate(ms.committedBaselineStartDate) || poDate;
              const bEnd = formatDbDate(ms.committedBaselineEndDate) || committedDate;
              const fStart = formatDbDate(ms.forecastStartDate) || bStart;
              const fEnd = formatDbDate(ms.forecastEndDate) || bEnd;
              const aStart = ms.actualStartDate ? formatDbDate(ms.actualStartDate) : null;
              const aEnd = ms.actualEndDate ? formatDbDate(ms.actualEndDate) : null;

              await conn.query(
                `INSERT INTO milestones (
                  id, organization_id, product_line_id, milestone_key, milestone_name,
                  stage_order, default_duration_days, committed_baseline_start_date,
                  committed_baseline_end_date, committed_duration_days, actual_start_date,
                  actual_end_date, forecast_start_date, forecast_end_date, variance_days,
                  status, completion_pct, approval_reference, drawing_number, ecn_number,
                  delay_category, delay_owner, delay_reason, doc_ref, backdate_reason,
                  accepted_by, assembly_sub_tabs
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  milestone_name = VALUES(milestone_name),
                  stage_order = VALUES(stage_order),
                  default_duration_days = VALUES(default_duration_days),
                  committed_baseline_start_date = VALUES(committed_baseline_start_date),
                  committed_baseline_end_date = VALUES(committed_baseline_end_date),
                  committed_duration_days = VALUES(committed_duration_days),
                  actual_start_date = VALUES(actual_start_date),
                  actual_end_date = VALUES(actual_end_date),
                  forecast_start_date = VALUES(forecast_start_date),
                  forecast_end_date = VALUES(forecast_end_date),
                  variance_days = VALUES(variance_days),
                  status = VALUES(status),
                  completion_pct = VALUES(completion_pct),
                  approval_reference = VALUES(approval_reference),
                  drawing_number = VALUES(drawing_number),
                  ecn_number = VALUES(ecn_number),
                  delay_category = VALUES(delay_category),
                  delay_owner = VALUES(delay_owner),
                  delay_reason = VALUES(delay_reason),
                  doc_ref = VALUES(doc_ref),
                  backdate_reason = VALUES(backdate_reason),
                  accepted_by = VALUES(accepted_by),
                  assembly_sub_tabs = VALUES(assembly_sub_tabs)`,
                [
                  msId,
                  orgId,
                  lineId,
                  ms.key,
                  ms.name || ms.key,
                  ms.stageOrder || 1,
                  ms.defaultDurationDays || 1,
                  bStart,
                  bEnd,
                  ms.committedDurationDays || 1,
                  aStart,
                  aEnd,
                  fStart,
                  fEnd,
                  ms.varianceDays || 0,
                  ms.status || 'Not Started',
                  ms.completionPct || 0,
                  ms.approvalReference || null,
                  ms.drawingNumber || null,
                  ms.ecnNumber || null,
                  ms.delayCategory || null,
                  ms.delayOwner || null,
                  ms.delayReason || null,
                  ms.docRef || null,
                  ms.backdateReason || null,
                  ms.acceptedBy || null,
                  ms.assemblySubTabs ? JSON.stringify(ms.assemblySubTabs) : null
                ]
              );

              // Save Subdivisions
              if (Array.isArray(ms.subdivisions)) {
                for (const sub of ms.subdivisions) {
                  if (!sub.id) continue;
                  const subId = toDbId(sub.id || `${msId}-${sub.title}`, 'sub');
                  await conn.query(
                    `INSERT INTO subdivisions (
                      id, organization_id, milestone_id, title, owner_slot, owner_user_id,
                      owner_label, status, target_start, target_end, actual_start, actual_end,
                      delay_cause, delay_note
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                      title = VALUES(title),
                      owner_slot = VALUES(owner_slot),
                      owner_user_id = VALUES(owner_user_id),
                      owner_label = VALUES(owner_label),
                      status = VALUES(status),
                      target_start = VALUES(target_start),
                      target_end = VALUES(target_end),
                      actual_start = VALUES(actual_start),
                      actual_end = VALUES(actual_end),
                      delay_cause = VALUES(delay_cause),
                      delay_note = VALUES(delay_note)`,
                    [
                      subId,
                      orgId,
                      msId,
                      sub.title || 'Task',
                      sub.ownerSlot || 'PM',
                      sub.ownerUserId || null,
                      sub.ownerLabel || null,
                      sub.status || 'Not Started',
                      sub.targetStart ? formatDbDate(sub.targetStart) : null,
                      sub.targetEnd ? formatDbDate(sub.targetEnd) : null,
                      sub.actualStart ? formatDbDate(sub.actualStart) : null,
                      sub.actualEnd ? formatDbDate(sub.actualEnd) : null,
                      sub.delayCause || null,
                      sub.delayNote || null
                    ]
                  );
                }
              }
            }
          }

          // Save Materials
          if (Array.isArray(line.materials)) {
            for (const mat of line.materials) {
              if (!mat.id) continue;
              const matId = toDbId(mat.id || `${lineId}-${mat.itemCode}`, 'mat');
              await conn.query(
                `INSERT INTO materials (
                  id, organization_id, product_line_id, item_code, description,
                  quantity, unit, supplier_name, lead_time_days, is_critical_path,
                  ordered_date, expected_date, dispatched_date, received_date,
                  grn_number, inspection_result, inspection_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  description = VALUES(description),
                  quantity = VALUES(quantity),
                  unit = VALUES(unit),
                  supplier_name = VALUES(supplier_name),
                  lead_time_days = VALUES(lead_time_days),
                  is_critical_path = VALUES(is_critical_path),
                  ordered_date = VALUES(ordered_date),
                  expected_date = VALUES(expected_date),
                  dispatched_date = VALUES(dispatched_date),
                  received_date = VALUES(received_date),
                  grn_number = VALUES(grn_number),
                  inspection_result = VALUES(inspection_result),
                  inspection_notes = VALUES(inspection_notes)`,
                [
                  matId,
                  orgId,
                  lineId,
                  mat.itemCode || 'ITEM',
                  mat.description || '',
                  mat.qty || 1,
                  mat.unit || 'NOS',
                  mat.supplierName || '',
                  mat.leadTimeDays || 14,
                  Boolean(mat.isCriticalPath),
                  mat.orderedDate ? formatDbDate(mat.orderedDate) : null,
                  mat.expectedDate ? formatDbDate(mat.expectedDate) : null,
                  mat.dispatchedDate ? formatDbDate(mat.dispatchedDate) : null,
                  mat.receivedDate ? formatDbDate(mat.receivedDate) : null,
                  mat.grnNumber || null,
                  mat.inspectionResult || 'Pending',
                  mat.inspectionNotes || null
                ]
              );
            }
          }
        }
      }

      // Save Baseline Revisions + change rows (after product_lines exist for FK resolution)
      if (Array.isArray(po.revisions)) {
        for (const rev of po.revisions) {
          const revId = toDbId(`${poId}-rev-${rev.revNumber}`, 'rev');
          await conn.query(
            `INSERT INTO baseline_revisions (
               id, organization_id, purchase_order_id, revision_number, reason,
               document_reference, requested_by, approved_by, approved_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
             ON DUPLICATE KEY UPDATE
               reason = VALUES(reason),
               document_reference = VALUES(document_reference),
               approved_at = VALUES(approved_at)`,
            [
              revId,
              orgId,
              poId,
              rev.revNumber,
              rev.reason || '',
              rev.docRef || '',
              rev.approvedAt ? new Date(rev.approvedAt) : new Date()
            ]
          );

          if (Array.isArray(rev.changes)) {
            for (const ch of rev.changes) {
              const chLineId = toDbId(ch.lineId, 'lin');
              const changeId = toDbId(`${revId}-${chLineId}-${ch.milestoneKey}`, 'chg');
              // Resolve product_line FK; skip orphan change rows rather than failing the order.
              const [lineRows] = await conn.query<any[]>(
                `SELECT id FROM product_lines WHERE id = ? LIMIT 1`,
                [chLineId]
              );
              if (!lineRows || lineRows.length === 0) continue;
              await conn.query(
                `INSERT INTO baseline_revision_changes (
                   id, organization_id, baseline_revision_id, product_line_id, milestone_key,
                   old_duration_days, new_duration_days, old_baseline_end_date, new_baseline_end_date
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   old_duration_days = VALUES(old_duration_days),
                   new_duration_days = VALUES(new_duration_days),
                   old_baseline_end_date = VALUES(old_baseline_end_date),
                   new_baseline_end_date = VALUES(new_baseline_end_date)`,
                [
                  changeId,
                  orgId,
                  revId,
                  chLineId,
                  ch.milestoneKey,
                  ch.oldDuration ?? 0,
                  ch.newDuration ?? 0,
                  ch.oldBaselineEnd ? formatDbDate(ch.oldBaselineEnd) : poDate,
                  ch.newBaselineEnd ? formatDbDate(ch.newBaselineEnd) : committedDate
                ]
              );
            }
          }
        }
      }
    }

    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity(
      'UPSERT',
      'purchase_orders',
      `Persisted ${orders.length} order(s) (${totalLines} line(s), ${totalMilestones} milestone(s), ${totalMaterials} material(s)) [${poNumbers.join(', ')}]`,
      { orgId, durationMs, count: orders.length }
    );
    logDbActivity('TX:COMMIT', 'purchase_orders', `Transaction committed successfully`, { orgId, durationMs });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('TX:ROLLBACK', 'purchase_orders', `Transaction rolled back due to error`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteOrderFromDb(pool: Pool, orgId: string, orderId: string): Promise<boolean> {
  const startMs = performance.now();
  logDbActivity('TX:START', 'purchase_orders', `Begin delete transaction for order ${orderId}`, { orgId });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const dbHashedId = toDbId(orderId, 'po');
    const [rows] = await conn.query<any[]>(
      `SELECT id, po_number FROM purchase_orders WHERE organization_id = ? AND (id = ? OR id = ? OR po_number = ?) LIMIT 1`,
      [orgId, orderId, dbHashedId, orderId]
    );
    if (!rows || rows.length === 0) {
      await conn.rollback();
      const durationMs = performance.now() - startMs;
      logDbActivity('DELETE', 'purchase_orders', `Order not found for deletion: ${orderId}`, { orgId, durationMs });
      return false;
    }
    const dbId: string = rows[0].id;
    const poNum: string = rows[0].po_number || orderId;
    // Explicit deletes; FK cascades cover lines/milestones/materials/attachments/slots/cancellations.
    await conn.query(`DELETE FROM purchase_orders WHERE organization_id = ? AND id = ?`, [orgId, dbId]);
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('DELETE', 'purchase_orders', `Deleted order ${poNum} (DB ID: ${dbId}) and all cascaded children`, { orgId, durationMs });
    logDbActivity('TX:COMMIT', 'purchase_orders', `Delete transaction committed for order ${poNum}`, { orgId, durationMs });
    return true;
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback errors; original error is more informative.
    }
    const durationMs = performance.now() - startMs;
    logDbActivity('TX:ROLLBACK', 'purchase_orders', `Delete transaction rolled back`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadOrdersFromDb(pool: Pool, orgId: string): Promise<PurchaseOrder[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [poRows] = await conn.query<any[]>(
      `SELECT * FROM purchase_orders WHERE organization_id = ? ORDER BY po_date DESC`,
      [orgId]
    );

    if (!poRows || poRows.length === 0) {
      const durationMs = performance.now() - startMs;
      logDbActivity('SELECT', 'purchase_orders', `Loaded 0 orders (empty table)`, { orgId, durationMs, count: 0 });
      return [];
    }

    const orders: PurchaseOrder[] = [];

    for (const poRow of poRows) {
      const [lineRows] = await conn.query<any[]>(
        `SELECT * FROM product_lines WHERE purchase_order_id = ? ORDER BY line_number ASC`,
        [poRow.id]
      );

      const productLines: ProductLine[] = [];

      for (const lineRow of lineRows) {
        const [msRows] = await conn.query<any[]>(
          `SELECT * FROM milestones WHERE product_line_id = ? ORDER BY stage_order ASC`,
          [lineRow.id]
        );

        const [matRows] = await conn.query<any[]>(
          `SELECT * FROM materials WHERE product_line_id = ?`,
          [lineRow.id]
        );

        const milestones: Milestone[] = [];
        for (const m of msRows) {
          const [subRows] = await conn.query<any[]>(
            `SELECT * FROM subdivisions WHERE organization_id = ? AND milestone_id = ? ORDER BY created_at ASC`,
            [orgId, m.id]
          );

          milestones.push({
            id: m.id,
            key: m.milestone_key,
            name: m.milestone_name,
            stageOrder: Number(m.stage_order),
            defaultDurationDays: Number(m.default_duration_days),
            committedBaselineStartDate: formatDbDate(m.committed_baseline_start_date),
            committedBaselineEndDate: formatDbDate(m.committed_baseline_end_date),
            currentBaselineEndDate: m.current_baseline_end_date ? formatDbDate(m.current_baseline_end_date) : undefined,
            committedDurationDays: Number(m.committed_duration_days),
            actualStartDate: m.actual_start_date ? formatDbDate(m.actual_start_date) : undefined,
            actualEndDate: m.actual_end_date ? formatDbDate(m.actual_end_date) : undefined,
            forecastStartDate: formatDbDate(m.forecast_start_date) || formatDbDate(m.committed_baseline_start_date),
            forecastEndDate: formatDbDate(m.forecast_end_date) || formatDbDate(m.committed_baseline_end_date),
            varianceDays: Number(m.variance_days || 0),
            status: m.status,
            completionPct: Number(m.completion_pct || 0),
            approvalReference: m.approval_reference || undefined,
            drawingNumber: m.drawing_number || undefined,
            ecnNumber: m.ecn_number || undefined,
            delayCategory: m.delay_category || undefined,
            delayOwner: m.delay_owner || undefined,
            delayReason: m.delay_reason || undefined,
            docRef: m.doc_ref || undefined,
            backdateReason: m.backdate_reason || undefined,
            acceptedBy: m.accepted_by || undefined,
            assemblySubTabs: m.assembly_sub_tabs ? (typeof m.assembly_sub_tabs === 'string' ? JSON.parse(m.assembly_sub_tabs) : m.assembly_sub_tabs) : undefined,
            subdivisions: subRows.length > 0 ? subRows.map(s => ({
              id: s.id,
              milestoneId: s.milestone_id || m.id,
              title: s.title,
              ownerSlot: s.owner_slot,
              ownerUserId: s.owner_user_id || undefined,
              ownerLabel: s.owner_label || undefined,
              status: s.status,
              targetStart: s.target_start ? formatDbDate(s.target_start) : undefined,
              targetEnd: s.target_end ? formatDbDate(s.target_end) : undefined,
              actualStart: s.actual_start ? formatDbDate(s.actual_start) : undefined,
              actualEnd: s.actual_end ? formatDbDate(s.actual_end) : undefined,
              delayCause: s.delay_cause || undefined,
              delayNote: s.delay_note || undefined,
              createdAt: s.created_at ? new Date(s.created_at).toISOString() : new Date().toISOString(),
              updatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : new Date().toISOString()
            })) : undefined
          });
        }

        const materials: MaterialItem[] = matRows.map(mat => ({
          id: mat.id,
          itemCode: mat.item_code,
          description: mat.description,
          qty: Number(mat.quantity),
          unit: mat.unit,
          supplierName: mat.supplier_name,
          leadTimeDays: Number(mat.lead_time_days),
          isCriticalPath: Boolean(mat.is_critical_path),
          orderedDate: mat.ordered_date ? formatDbDate(mat.ordered_date) : undefined,
          expectedDate: mat.expected_date ? formatDbDate(mat.expected_date) : undefined,
          dispatchedDate: mat.dispatched_date ? formatDbDate(mat.dispatched_date) : undefined,
          receivedDate: mat.received_date ? formatDbDate(mat.received_date) : undefined,
          grnNumber: mat.grn_number || undefined,
          inspectionResult: mat.inspection_result || 'Pending',
          inspectionNotes: mat.inspection_notes || undefined
        }));

        productLines.push({
          id: lineRow.id,
          lineNumber: lineRow.line_number,
          productName: lineRow.product_name,
          category: lineRow.category,
          qty: Number(lineRow.quantity),
          designType: lineRow.design_type,
          milestones,
          materials,
          overallVarianceDays: Number(lineRow.overall_variance_days || 0),
          status: lineRow.status,
          delayReason: lineRow.delay_reason || undefined
        });
      }

      // Check for associated cancellation request
      let cancellationRequest: any = undefined;
      try {
        const [cancRows] = await conn.query<any[]>(
          `SELECT * FROM cancellation_requests WHERE organization_id = ? AND purchase_order_id = ? ORDER BY requested_at DESC LIMIT 1`,
          [orgId, poRow.id]
        );
        if (cancRows.length > 0) {
          const cr = cancRows[0];
          cancellationRequest = {
            id: cr.id,
            poId: cr.purchase_order_id,
            poNumber: cr.po_number,
            customerName: cr.customer_name,
            requestedBy: cr.requested_by,
            requestedRole: cr.requested_role,
            requestedAt: cr.requested_at ? new Date(cr.requested_at).toISOString() : new Date().toISOString(),
            reason: cr.reason,
            status: cr.status,
            decisionNotes: cr.decision_notes || undefined,
            actionTaken: cr.action_taken || undefined
          };
        }
      } catch {}

      // Load Attachments (metadata) + Baseline Revisions + change rows.
      let attachments: PurchaseOrder['attachments'] = [];
      let revisions: PurchaseOrder['revisions'] = [];
      try {
        const [attRows] = await conn.query<any[]>(
          `SELECT * FROM po_attachments WHERE organization_id = ? AND purchase_order_id = ? ORDER BY uploaded_at ASC`,
          [orgId, poRow.id]
        );
        attachments = attRows.map((a: any) => ({
          id: a.id,
          name: a.file_name,
          type: a.attachment_type,
          size: a.file_size,
          uploadedBy: '',
          uploadedAt: a.uploaded_at ? new Date(a.uploaded_at).toISOString() : new Date().toISOString()
        }));
      } catch {}
      try {
        const [revRows] = await conn.query<any[]>(
          `SELECT * FROM baseline_revisions WHERE organization_id = ? AND purchase_order_id = ? ORDER BY revision_number ASC`,
          [orgId, poRow.id]
        );
        for (const rv of revRows) {
          let changes: PurchaseOrder['revisions'][number]['changes'] = [];
          try {
            const [chRows] = await conn.query<any[]>(
              `SELECT * FROM baseline_revision_changes WHERE organization_id = ? AND baseline_revision_id = ?`,
              [orgId, rv.id]
            );
            changes = chRows.map((c: any) => ({
              lineId: c.product_line_id,
              milestoneKey: c.milestone_key,
              oldDuration: Number(c.old_duration_days),
              newDuration: Number(c.new_duration_days),
              oldBaselineEnd: formatDbDate(c.old_baseline_end_date),
              newBaselineEnd: formatDbDate(c.new_baseline_end_date)
            }));
          } catch {}
          revisions.push({
            revNumber: Number(rv.revision_number),
            requestedBy: '',
            approvedBy: '',
            approvedAt: rv.approved_at ? new Date(rv.approved_at).toISOString() : new Date().toISOString(),
            reason: rv.reason || '',
            docRef: rv.document_reference || '',
            changes
          });
        }
      } catch {}

      orders.push({
        id: poRow.id,
        poNumber: poRow.po_number,
        customerName: poRow.customer_name,
        customerPoRef: poRow.customer_po_ref,
        poDate: formatDbDate(poRow.po_date),
        bookedAmount: poRow.booked_amount !== null ? Number(poRow.booked_amount) : undefined,
        contractReviewRef: poRow.contract_review_ref,
        committedDeliveryDate: formatDbDate(poRow.committed_delivery_date),
        revisedDeliveryDate: formatDbDate(poRow.revised_delivery_date) || formatDbDate(poRow.committed_delivery_date),
        actualDeliveryDate: poRow.actual_delivery_date ? formatDbDate(poRow.actual_delivery_date) : undefined,
        status: poRow.status,
        productLines,
        revisions,
        attachments,
        cancellationRequest,
        createdBy: poRow.created_by || 'Sales',
        createdAt: poRow.created_at ? new Date(poRow.created_at).toISOString() : new Date().toISOString(),
        lastUpdatedBy: poRow.last_updated_by || 'System',
        lastUpdatedAt: poRow.updated_at ? new Date(poRow.updated_at).toISOString() : new Date().toISOString(),
        isClosed: Boolean(poRow.is_closed),
        closureNotes: poRow.closure_notes || undefined,
        isCancelled: Boolean(poRow.is_cancelled),
        cancellationReason: poRow.cancellation_reason || undefined
      });
    }

    const durationMs = performance.now() - startMs;
    logDbActivity(
      'SELECT',
      'purchase_orders',
      `Loaded ${orders.length} order(s) [${orders.map(o => o.poNumber).filter(Boolean).join(', ')}] with lines and milestones`,
      { orgId, durationMs, count: orders.length }
    );
    return orders;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'purchase_orders', `Failed to load orders`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Product Catalog
// ---------------------------------------------------------------------------

export async function saveProductsToDb(pool: Pool, orgId: string, products: ProductMasterItem[]): Promise<void> {
  if (!products || !Array.isArray(products)) return;
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const prod of products) {
      if (!prod.id || !prod.productCode) continue;
      const prodId = toDbId(prod.id, 'prd');

      await conn.query(
        `INSERT INTO product_catalog (
          id, organization_id, product_code, product_name, category, design_type, total_lead_time_days, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_name = VALUES(product_name),
          category = VALUES(category),
          design_type = VALUES(design_type),
          total_lead_time_days = VALUES(total_lead_time_days),
          description = VALUES(description)`,
        [
          prodId,
          orgId,
          prod.productCode,
          prod.productName,
          prod.category,
          prod.designType,
          prod.totalLeadTimeDays || 30,
          prod.description || null
        ]
      );
    }
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'product_catalog', `Persisted ${products.length} product catalog item(s)`, { orgId, durationMs, count: products.length });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'product_catalog', `Failed to persist products`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadProductsFromDb(pool: Pool, orgId: string): Promise<ProductMasterItem[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM product_catalog WHERE organization_id = ? ORDER BY product_name ASC`,
      [orgId]
    );

    const out: (ProductMasterItem & { materials: never[] })[] = rows.map(r => ({
      id: r.id,
      productCode: r.product_code,
      productName: r.product_name,
      category: r.category,
      designType: r.design_type,
      totalLeadTimeDays: Number(r.total_lead_time_days),
      description: r.description || undefined,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      materials: []
    }));
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'product_catalog', `Loaded ${out.length} product catalog item(s)`, { orgId, durationMs, count: out.length });
    return out;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'product_catalog', `Failed to load product catalog`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export async function saveAuditLogsToDb(pool: Pool, orgId: string, logs: AuditLogEntry[]): Promise<void> {
  if (!logs || !Array.isArray(logs)) return;
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const log of logs) {
      if (!log.id) continue;
      const logId = toDbId(log.id, 'aud');
      await conn.query(
        `INSERT INTO audit_logs (
          id, organization_id, po_number, product_line, role, action, document_reference, details, backdate_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          details = VALUES(details)`,
        [
          logId,
          orgId,
          log.poNumber || 'SYSTEM',
          log.productLine || null,
          log.role || 'System',
          log.action || 'UPDATE',
          log.docRef || null,
          log.details || '',
          log.backdateReason || null,
          log.timestamp ? new Date(log.timestamp) : new Date()
        ]
      );
    }
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('INSERT', 'audit_logs', `Persisted ${logs.length} audit log entry(s)`, { orgId, durationMs, count: logs.length });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('INSERT', 'audit_logs', `Failed to persist audit logs`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadAuditLogsFromDb(pool: Pool, orgId: string): Promise<AuditLogEntry[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 500`,
      [orgId]
    );

    const out: AuditLogEntry[] = rows.map(r => ({
      id: r.id,
      timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      user: r.role || 'System',
      role: r.role,
      poNumber: r.po_number,
      productLine: r.product_line || undefined,
      action: r.action,
      docRef: r.document_reference || undefined,
      details: r.details,
      backdateReason: r.backdate_reason || undefined
    }));
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'audit_logs', `Loaded ${out.length} audit log entry(s)`, { orgId, durationMs, count: out.length });
    return out;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'audit_logs', `Failed to load audit logs`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Rectifications
// ---------------------------------------------------------------------------

export async function saveRectificationsToDb(pool: Pool, orgId: string, rects: RectificationAction[]): Promise<void> {
  if (!rects || !Array.isArray(rects)) return;
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const r of rects) {
      if (!r.id) continue;
      const rectId = toDbId(r.id, 'rec');
      let targetLineId: string | null = null;
      if (r.productLineId) {
        const candidateLineId = toDbId(r.productLineId, 'lin');
        const [lRows] = await conn.query<any[]>(
          `SELECT id FROM product_lines WHERE id = ? LIMIT 1`,
          [candidateLineId]
        );
        if (lRows && lRows.length > 0) {
          targetLineId = candidateLineId;
        }
      }
      // Frontend contract uses `type`; legacy senders used `actionType`.
      const actionType = r.type || (r as { actionType?: string }).actionType || 'Expedite';
      await conn.query(
        `INSERT INTO rectification_actions (
          id, organization_id, purchase_order_id, product_line_id, po_number, product_line_name, milestone_key, milestone_name,
          action_type, title, description, impact_days_saved, suggested_by, suggested_at,
          assigned_to, status, decision_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          decision_notes = VALUES(decision_notes)`,
        [
          rectId,
          orgId,
          null,
          targetLineId,
          r.poNumber || '',
          r.productLineName || '',
          r.milestoneKey || '',
          r.milestoneName || '',
          actionType,
          r.title || '',
          r.description || '',
          r.impactDaysSaved || 0,
          r.suggestedBy || 'System',
          r.suggestedAt ? new Date(r.suggestedAt) : new Date(),
          r.assignedTo || 'PM',
          r.status || 'Pending',
          r.decisionNotes || null
        ]
      );
    }
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'rectification_actions', `Persisted ${rects.length} rectification action(s)`, { orgId, durationMs, count: rects.length });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'rectification_actions', `Failed to persist rectifications`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadRectificationsFromDb(pool: Pool, orgId: string): Promise<RectificationAction[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM rectification_actions WHERE organization_id = ? ORDER BY suggested_at DESC`,
      [orgId]
    );

    const out: (RectificationAction & { actionType?: string })[] = rows.map(r => ({
      id: r.id,
      poNumber: r.po_number,
      productLineId: r.product_line_id || '',
      productLineName: r.product_line_name,
      milestoneKey: r.milestone_key,
      milestoneName: r.milestone_name,
      type: r.action_type,
      // Legacy alias kept for older frontend builds reading `actionType`.
      actionType: r.action_type,
      title: r.title,
      description: r.description,
      impactDaysSaved: Number(r.impact_days_saved),
      suggestedBy: r.suggested_by,
      suggestedAt: r.suggested_at ? new Date(r.suggested_at).toISOString() : new Date().toISOString(),
      assignedTo: r.assigned_to,
      status: r.status,
      decisionBy: r.decision_by || undefined,
      decisionAt: r.decision_at ? new Date(r.decision_at).toISOString() : undefined,
      decisionNotes: r.decision_notes || undefined
    }));
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'rectification_actions', `Loaded ${out.length} rectification action(s)`, { orgId, durationMs, count: out.length });
    return out;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'rectification_actions', `Failed to load rectifications`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// System Config
// ---------------------------------------------------------------------------

export async function saveConfigToDb(pool: Pool, orgId: string, cfg: SystemConfig): Promise<void> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await ensureOrganization(conn, orgId);
    await conn.query(
      `INSERT INTO system_config (
        organization_id, at_risk_threshold_days, delayed_threshold_days, offline_sync_queue, enable_push_notifications
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        at_risk_threshold_days = VALUES(at_risk_threshold_days),
        delayed_threshold_days = VALUES(delayed_threshold_days),
        offline_sync_queue = VALUES(offline_sync_queue),
        enable_push_notifications = VALUES(enable_push_notifications)`,
      [
        orgId,
        cfg.atRiskThresholdDays ?? 3,
        cfg.delayedThresholdDays ?? 7,
        JSON.stringify(cfg.offlineSyncQueue || []),
        Boolean(cfg.enablePushNotifications)
      ]
    );
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'system_config', `Persisted system config (atRisk: ${cfg.atRiskThresholdDays}d, delayed: ${cfg.delayedThresholdDays}d)`, { orgId, durationMs });
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'system_config', `Failed to persist system config`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadConfigFromDb(pool: Pool, orgId: string): Promise<SystemConfig | null> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM system_config WHERE organization_id = ? LIMIT 1`,
      [orgId]
    );
    const durationMs = performance.now() - startMs;
    if (!rows || rows.length === 0) {
      logDbActivity('SELECT', 'system_config', `Loaded system config (none configured, using defaults)`, { orgId, durationMs });
      return null;
    }
    const r = rows[0];
    const out: SystemConfig = {
      atRiskThresholdDays: Number(r.at_risk_threshold_days),
      delayedThresholdDays: Number(r.delayed_threshold_days),
      offlineSyncQueue: r.offline_sync_queue ? (typeof r.offline_sync_queue === 'string' ? JSON.parse(r.offline_sync_queue) : r.offline_sync_queue) : [],
      enablePushNotifications: Boolean(r.enable_push_notifications)
    };
    logDbActivity('SELECT', 'system_config', `Loaded system config (atRisk: ${out.atRiskThresholdDays}d, delayed: ${out.delayedThresholdDays}d)`, { orgId, durationMs });
    return out;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'system_config', `Failed to load system config`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Cancellation Requests
// ---------------------------------------------------------------------------

export async function saveCancellationsToDb(pool: Pool, orgId: string, cancellations: CancellationRequest[]): Promise<void> {
  if (!cancellations || !Array.isArray(cancellations)) return;
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    for (const c of cancellations) {
      if (!c.id) continue;
      const crId = toDbId(c.id, 'cnc');
      const poId = toDbId(c.poId, 'po');
      // Foreign key requires target order to exist in purchase_orders
      const [poRows] = await conn.query<any[]>(
        `SELECT id FROM purchase_orders WHERE id = ? LIMIT 1`,
        [poId]
      );
      if (!poRows || poRows.length === 0) continue;

      await conn.query(
        `INSERT INTO cancellation_requests (
          id, organization_id, purchase_order_id, po_number, customer_name,
          requested_by, requested_role, requested_at, reason, status, decision_notes, action_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          decision_notes = VALUES(decision_notes),
          action_taken = VALUES(action_taken)`,
        [
          crId,
          orgId,
          poId,
          c.poNumber,
          c.customerName,
          c.requestedBy,
          c.requestedRole,
          c.requestedAt ? new Date(c.requestedAt) : new Date(),
          c.reason,
          c.status || 'Pending',
          c.decisionNotes || null,
          c.actionTaken || null
        ]
      );
    }
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'cancellation_requests', `Persisted ${cancellations.length} cancellation request(s)`, { orgId, durationMs, count: cancellations.length });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'cancellation_requests', `Failed to persist cancellations`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadCancellationsFromDb(pool: Pool, orgId: string): Promise<CancellationRequest[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT * FROM cancellation_requests WHERE organization_id = ? ORDER BY requested_at DESC`,
      [orgId]
    );
    const out = rows.map(r => ({
      id: r.id,
      poId: r.purchase_order_id,
      poNumber: r.po_number,
      customerName: r.customer_name,
      requestedBy: r.requested_by,
      requestedRole: r.requested_role,
      requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : new Date().toISOString(),
      reason: r.reason,
      status: r.status,
      decisionNotes: r.decision_notes || undefined,
      actionTaken: r.action_taken || undefined
    }));
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'cancellation_requests', `Loaded ${out.length} cancellation request(s)`, { orgId, durationMs, count: out.length });
    return out;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'cancellation_requests', `Failed to load cancellations`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Category Templates
// ---------------------------------------------------------------------------

export async function saveTemplatesToDb(pool: Pool, orgId: string, templates: CategoryTemplate[]): Promise<void> {
  if (!templates || !Array.isArray(templates)) return;
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureOrganization(conn, orgId);

    let totalMilestones = 0;
    for (const t of templates) {
      if (!t.id) continue;
      const tmplId = toDbId(t.id, 'tmp');
      await conn.query(
        `INSERT INTO category_templates (id, organization_id, category_name, design_type)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           category_name = VALUES(category_name),
           design_type = VALUES(design_type)`,
        [tmplId, orgId, t.categoryName, t.designType]
      );

      if (Array.isArray(t.milestoneDurations)) {
        let order = 1;
        for (const md of t.milestoneDurations) {
          totalMilestones++;
          const subId = toDbId(`${tmplId}-${md.milestoneKey}`, 'tms');
          await conn.query(
            `INSERT INTO category_template_milestones (
               id, organization_id, template_id, stage_order, milestone_key, milestone_name, duration_days
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               stage_order = VALUES(stage_order),
               milestone_name = VALUES(milestone_name),
               duration_days = VALUES(duration_days)`,
            [subId, orgId, tmplId, order++, md.milestoneKey, md.milestoneName, md.durationDays]
          );
        }
      }
    }
    await conn.commit();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'category_templates', `Persisted ${templates.length} template(s) with ${totalMilestones} milestone(s)`, { orgId, durationMs, count: templates.length });
  } catch (err: any) {
    await conn.rollback();
    const durationMs = performance.now() - startMs;
    logDbActivity('UPSERT', 'category_templates', `Failed to persist templates`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}

export async function loadTemplatesFromDb(pool: Pool, orgId: string): Promise<CategoryTemplate[]> {
  const startMs = performance.now();
  const conn = await pool.getConnection();
  try {
    const [tRows] = await conn.query<any[]>(
      `SELECT * FROM category_templates WHERE organization_id = ?`,
      [orgId]
    );

    const templates: CategoryTemplate[] = [];
    for (const tr of tRows) {
      const [mRows] = await conn.query<any[]>(
        `SELECT * FROM category_template_milestones WHERE template_id = ? ORDER BY stage_order ASC`,
        [tr.id]
      );

      templates.push({
        id: tr.id,
        categoryName: tr.category_name,
        designType: tr.design_type,
        milestoneDurations: mRows.map(m => ({
          milestoneKey: m.milestone_key,
          milestoneName: m.milestone_name,
          durationDays: Number(m.duration_days)
        }))
      });
    }
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'category_templates', `Loaded ${templates.length} template(s)`, { orgId, durationMs, count: templates.length });
    return templates;
  } catch (err: any) {
    const durationMs = performance.now() - startMs;
    logDbActivity('SELECT', 'category_templates', `Failed to load templates`, { orgId, durationMs, error: err?.message || String(err) });
    throw err;
  } finally {
    conn.release();
  }
}
