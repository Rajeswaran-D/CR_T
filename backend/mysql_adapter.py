"""
MySQL persistence layer — Python port of server/mysqlAdapter.ts.
Handles all CRUD operations for orders, products, templates, config,
audit logs, rectifications, and cancellations.
"""
import hashlib
import json
import logging
import random
import string
import time
from datetime import datetime, date, timezone
from typing import Any, Optional

import pymysql
import pymysql.cursors

logger = logging.getLogger("cft.mysql")

DEFAULT_ORG_ID = "circor-flow-technologies"

CANONICAL_STAGE_ORDER = {
    "po_from_customer": 1,
    "corb_release": 2,
    "pm_baseline": 3,
    "baseline_review": 3,
    "bom_release": 4,
    "wo_release": 5,
    "sub_supplier_po": 6,
    "material_receipt": 7,
    "raw_material": 7,
    "machining": 8,
    "assembly": 9,
    "fg": 10,
    "qc_pass": 10,
    "customer_inspection": 11,
    "painting": 12,
    "trn": 13,
    "shipment": 14,
}

CANONICAL_STAGE_NAMES = {
    "po_from_customer": "1. Customer Purchase Order (PO)",
    "corb_release": "2. CORB Release",
    "pm_baseline": "3. Baseline Review & Planning",
    "baseline_review": "3. Baseline Review & Planning",
    "bom_release": "4. BOM Release",
    "wo_release": "5. Work Order Release",
    "sub_supplier_po": "6. Sub-Supplier PO",
    "material_receipt": "7. Material Receipt (GRN)",
    "raw_material": "7. Material Receipt (GRN)",
    "machining": "8. Machining",
    "assembly": "9. Assembly",
    "fg": "10. FG",
    "qc_pass": "10. FG",
    "customer_inspection": "11. Customer Inspection",
    "painting": "12. Painting",
    "trn": "13. TRN",
    "shipment": "14. Final Shipment & Dispatch",
}


# ---------------------------------------------------------------------------
# ID helpers
# ---------------------------------------------------------------------------

def to_db_id(id_val: Optional[str], prefix: str = "id") -> str:
    """Constrain any ID to <= 36 chars (fits CHAR(36)/VARCHAR)."""
    if not id_val:
        ts = int(time.time() * 1000)
        rnd = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
        return f"{prefix[:3]}-{ts}-{rnd}"[:36]
    s = str(id_val).strip()
    if len(s) <= 36:
        return s
    md5 = hashlib.md5(s.encode()).hexdigest()
    p = s.split("-")[0][:3] if "-" in s else prefix[:3]
    return f"{p}-{md5}"[:36]


def format_db_date(val: Any) -> str:
    """Safely format any date value to YYYY-MM-DD."""
    if val is None:
        return ""
    if isinstance(val, (datetime, date)):
        if isinstance(val, datetime) and val.tzinfo is None:
            pass  # treat as local
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return ""
    # Already in YYYY-MM-DD
    import re
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    # Try parsing
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return s[:10] if len(s) >= 10 else s


def format_db_datetime(val: Any) -> Optional[str]:
    """Safely format any datetime/timestamp to MySQL YYYY-MM-DD HH:MM:SS format."""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        if isinstance(val, datetime):
            return val.strftime("%Y-%m-%d %H:%M:%S")
        return f"{val.strftime('%Y-%m-%d')} 00:00:00"
    s = str(val).strip()
    if not s or s.lower() in ("none", "null", "undefined", ""):
        return None
    import re
    if re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", s):
        return s
    try:
        clean = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        pass
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return f"{s[:10]} 00:00:00"
    return None


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------

def ensure_organization(cursor: Any, org_id: str, org_name: Optional[str] = None) -> None:
    name = org_name or ("CIRCOR Flow Technologies" if org_id == DEFAULT_ORG_ID else org_id)
    cursor.execute(
        "INSERT INTO organizations (id, name) VALUES (%s, %s) ON DUPLICATE KEY UPDATE name = VALUES(name)",
        (org_id, name),
    )


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

EXPECTED_TABLES = [
    "organizations", "users", "purchase_orders", "po_attachments",
    "product_lines", "milestones", "materials", "baseline_revisions",
    "baseline_revision_changes", "product_catalog", "product_catalog_materials",
    "category_templates", "category_template_milestones", "rectification_actions",
    "system_config", "audit_logs", "subdivisions", "po_slot_assignments",
    "cancellation_requests",
]


def verify_schema(conn: pymysql.connections.Connection) -> dict:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()"
        )
        rows = cursor.fetchall()
        present_set = {r["t"] for r in rows}
        if "purchase_orders" in present_set:
            try:
                cursor.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = 'purchase_orders' AND column_name = 'is_ld'"
                )
                if not cursor.fetchone():
                    cursor.execute("ALTER TABLE purchase_orders ADD COLUMN is_ld TINYINT(1) NOT NULL DEFAULT 0")
                    conn.commit()
            except Exception as e:
                logger.warning(f"Failed to auto-add is_ld column: {e}")
    present = [t for t in EXPECTED_TABLES if t in present_set]
    missing = [t for t in EXPECTED_TABLES if t not in present_set]
    return {"expected": EXPECTED_TABLES, "present": present, "missing": missing}


# ---------------------------------------------------------------------------
# Purchase Orders — Save
# ---------------------------------------------------------------------------

def save_orders_to_db(conn: pymysql.connections.Connection, org_id: str, orders: list[dict]) -> None:
    if not orders:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for po in orders:
            if not po.get("id") or not po.get("poNumber"):
                continue
            po_id = to_db_id(po["id"], "po")
            po_date = format_db_date(po.get("poDate")) or datetime.now().strftime("%Y-%m-%d")
            committed = format_db_date(po.get("committedDeliveryDate")) or po_date
            revised = format_db_date(po.get("revisedDeliveryDate")) or committed
            actual = format_db_date(po.get("actualDeliveryDate")) if po.get("actualDeliveryDate") else None
            booked = po.get("bookedAmount") if isinstance(po.get("bookedAmount"), (int, float)) else None

            cursor.execute(
                """INSERT INTO purchase_orders (
                    id, organization_id, po_number, customer_name, customer_po_ref,
                    po_date, booked_amount, contract_review_ref, committed_delivery_date,
                    revised_delivery_date, actual_delivery_date, status, is_closed,
                    closure_notes, is_cancelled, cancellation_reason, is_ld, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                ON DUPLICATE KEY UPDATE
                    customer_name=VALUES(customer_name),
                    customer_po_ref=VALUES(customer_po_ref),
                    po_date=VALUES(po_date),
                    booked_amount=VALUES(booked_amount),
                    contract_review_ref=VALUES(contract_review_ref),
                    committed_delivery_date=VALUES(committed_delivery_date),
                    revised_delivery_date=VALUES(revised_delivery_date),
                    actual_delivery_date=VALUES(actual_delivery_date),
                    status=VALUES(status),
                    is_closed=VALUES(is_closed),
                    closure_notes=VALUES(closure_notes),
                    is_cancelled=VALUES(is_cancelled),
                    cancellation_reason=VALUES(cancellation_reason),
                    is_ld=VALUES(is_ld),
                    updated_at=NOW()""",
                (
                    po_id, org_id, po.get("poNumber"), po.get("customerName", ""),
                    po.get("customerPoRef", ""), po_date, booked,
                    po.get("contractReviewRef", ""), committed, revised, actual,
                    po.get("status", "In Progress"), bool(po.get("isClosed")),
                    po.get("closureNotes"), bool(po.get("isCancelled")),
                    po.get("cancellationReason"), bool(po.get("isLd") or po.get("is_ld")),
                ),
            )

            # Cancellation Request on PO
            cr = po.get("cancellationRequest")
            if cr and isinstance(cr, dict) and (cr.get("id") or cr.get("reason")):
                cr_id = to_db_id(cr.get("id") or f"cnc-{po_id}", "cnc")
                req_at = format_db_datetime(cr.get("requestedAt")) or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                dec_at = format_db_datetime(cr.get("decisionAt")) if cr.get("status") in ("Rejected", "Approved") else None
                cursor.execute(
                    """INSERT INTO cancellation_requests (
                        id, organization_id, purchase_order_id, po_number, customer_name,
                        requested_by, requested_role, requested_at, reason, status,
                        decision_by, decision_at, decision_notes, action_taken
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        status = VALUES(status),
                        decision_by = VALUES(decision_by),
                        decision_at = VALUES(decision_at),
                        decision_notes = VALUES(decision_notes),
                        action_taken = VALUES(action_taken),
                        reason = VALUES(reason)""",
                    (
                        cr_id,
                        org_id,
                        po_id,
                        po.get("poNumber", ""),
                        po.get("customerName", ""),
                        cr.get("requestedBy") or "Buyer",
                        cr.get("requestedRole") or "Buyer",
                        req_at,
                        cr.get("reason", ""),
                        cr.get("status", "Pending"),
                        cr.get("decisionBy"),
                        dec_at,
                        cr.get("decisionNotes") or cr.get("notes"),
                        cr.get("actionTaken"),
                    ),
                )
            elif cr is None and "cancellationRequest" in po:
                cursor.execute(
                    "DELETE FROM cancellation_requests WHERE purchase_order_id = %s",
                    (po_id,),
                )

            # Attachments
            for att in (po.get("attachments") or []):
                if not att.get("id"):
                    continue
                att_id = to_db_id(att["id"], "att")
                cursor.execute(
                    """INSERT INTO po_attachments (id,organization_id,purchase_order_id,file_name,attachment_type,file_size)
                    VALUES(%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE file_name=VALUES(file_name),attachment_type=VALUES(attachment_type),file_size=VALUES(file_size)""",
                    (att_id, org_id, po_id, att.get("name","attachment"), att.get("type","General"), att.get("size","")),
                )

            # Product Lines
            for line in (po.get("productLines") or []):
                if not line.get("id"):
                    continue
                line_id = to_db_id(line["id"], "lin")
                cursor.execute(
                    """INSERT INTO product_lines (id,organization_id,purchase_order_id,line_number,product_name,
                    category,quantity,design_type,status,overall_variance_days,delay_reason)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                    product_name=VALUES(product_name),category=VALUES(category),quantity=VALUES(quantity),
                    design_type=VALUES(design_type),status=VALUES(status),
                    overall_variance_days=VALUES(overall_variance_days),delay_reason=VALUES(delay_reason)""",
                    (line_id, org_id, po_id, line.get("lineNumber","LINE-01"),
                     line.get("productName",""), line.get("category","Valves"),
                     line.get("qty",1), line.get("designType","Existing Design"),
                     line.get("status","Not Started"), line.get("overallVarianceDays",0),
                     line.get("delayReason")),
                )

                # Milestones
                for ms in (line.get("milestones") or []):
                    if not ms.get("id") or not ms.get("key"):
                        continue
                    ms_id = to_db_id(ms.get("id") or f"{line_id}-{ms['key']}", "ms")
                    b_start = format_db_date(ms.get("committedBaselineStartDate")) or po_date
                    b_end = format_db_date(ms.get("committedBaselineEndDate")) or committed
                    f_start = format_db_date(ms.get("forecastStartDate")) or b_start
                    f_end = format_db_date(ms.get("forecastEndDate")) or b_end
                    a_start = format_db_date(ms.get("actualStartDate")) if ms.get("actualStartDate") else None
                    a_end = format_db_date(ms.get("actualEndDate")) if ms.get("actualEndDate") else None
                    sub_tabs = json.dumps(ms["assemblySubTabs"]) if ms.get("assemblySubTabs") else None

                    cursor.execute(
                        """INSERT INTO milestones (id,organization_id,product_line_id,milestone_key,milestone_name,
                        stage_order,default_duration_days,committed_baseline_start_date,committed_baseline_end_date,
                        committed_duration_days,actual_start_date,actual_end_date,forecast_start_date,forecast_end_date,
                        variance_days,status,completion_pct,approval_reference,drawing_number,ecn_number,
                        delay_category,delay_owner,delay_reason,doc_ref,backdate_reason,accepted_by,assembly_sub_tabs)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON DUPLICATE KEY UPDATE
                        milestone_name=VALUES(milestone_name),stage_order=VALUES(stage_order),
                        default_duration_days=VALUES(default_duration_days),
                        committed_baseline_start_date=VALUES(committed_baseline_start_date),
                        committed_baseline_end_date=VALUES(committed_baseline_end_date),
                        committed_duration_days=VALUES(committed_duration_days),
                        actual_start_date=VALUES(actual_start_date),actual_end_date=VALUES(actual_end_date),
                        forecast_start_date=VALUES(forecast_start_date),forecast_end_date=VALUES(forecast_end_date),
                        variance_days=VALUES(variance_days),status=VALUES(status),completion_pct=VALUES(completion_pct),
                        approval_reference=VALUES(approval_reference),drawing_number=VALUES(drawing_number),
                        ecn_number=VALUES(ecn_number),delay_category=VALUES(delay_category),
                        delay_owner=VALUES(delay_owner),delay_reason=VALUES(delay_reason),
                        doc_ref=VALUES(doc_ref),backdate_reason=VALUES(backdate_reason),
                        accepted_by=VALUES(accepted_by),assembly_sub_tabs=VALUES(assembly_sub_tabs)""",
                        (ms_id, org_id, line_id, ms["key"], CANONICAL_STAGE_NAMES.get(ms["key"], ms.get("name", ms["key"])),
                         CANONICAL_STAGE_ORDER.get(ms["key"], ms.get("stageOrder", 1)), ms.get("defaultDurationDays",1),
                         b_start, b_end, ms.get("committedDurationDays",1),
                         a_start, a_end, f_start, f_end, ms.get("varianceDays",0),
                         ms.get("status","Not Started"), ms.get("completionPct",0),
                         ms.get("approvalReference"), ms.get("drawingNumber"), ms.get("ecnNumber"),
                         ms.get("delayCategory"), ms.get("delayOwner"), ms.get("delayReason"),
                         ms.get("docRef"), ms.get("backdateReason"), ms.get("acceptedBy"), sub_tabs),
                    )

                    # Subdivisions
                    for sub in (ms.get("subdivisions") or []):
                        if not sub.get("id"):
                            continue
                        sub_id = to_db_id(sub.get("id") or f"{ms_id}-{sub.get('title','')}", "sub")
                        cursor.execute(
                            """INSERT INTO subdivisions (id,organization_id,milestone_id,title,owner_slot,
                            owner_user_id,owner_label,status,target_start,target_end,actual_start,actual_end,
                            delay_cause,delay_note)
                            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON DUPLICATE KEY UPDATE title=VALUES(title),owner_slot=VALUES(owner_slot),
                            owner_user_id=VALUES(owner_user_id),owner_label=VALUES(owner_label),
                            status=VALUES(status),target_start=VALUES(target_start),target_end=VALUES(target_end),
                            actual_start=VALUES(actual_start),actual_end=VALUES(actual_end),
                            delay_cause=VALUES(delay_cause),delay_note=VALUES(delay_note)""",
                            (sub_id, org_id, ms_id, sub.get("title","Task"), sub.get("ownerSlot","PM"),
                             sub.get("ownerUserId"), sub.get("ownerLabel"), sub.get("status","Not Started"),
                             format_db_date(sub.get("targetStart")) if sub.get("targetStart") else None,
                             format_db_date(sub.get("targetEnd")) if sub.get("targetEnd") else None,
                             format_db_date(sub.get("actualStart")) if sub.get("actualStart") else None,
                             format_db_date(sub.get("actualEnd")) if sub.get("actualEnd") else None,
                             sub.get("delayCause"), sub.get("delayNote")),
                        )

                # Materials
                for mat in (line.get("materials") or []):
                    if not mat.get("id"):
                        continue
                    mat_id = to_db_id(mat.get("id") or f"{line_id}-{mat.get('itemCode','')}", "mat")
                    cursor.execute(
                        """INSERT INTO materials (id,organization_id,product_line_id,item_code,description,
                        quantity,unit,supplier_name,lead_time_days,is_critical_path,ordered_date,expected_date,
                        dispatched_date,received_date,grn_number,inspection_result,inspection_notes)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON DUPLICATE KEY UPDATE
                        description=VALUES(description),quantity=VALUES(quantity),unit=VALUES(unit),
                        supplier_name=VALUES(supplier_name),lead_time_days=VALUES(lead_time_days),
                        is_critical_path=VALUES(is_critical_path),ordered_date=VALUES(ordered_date),
                        expected_date=VALUES(expected_date),dispatched_date=VALUES(dispatched_date),
                        received_date=VALUES(received_date),grn_number=VALUES(grn_number),
                        inspection_result=VALUES(inspection_result),inspection_notes=VALUES(inspection_notes)""",
                        (mat_id, org_id, line_id, mat.get("itemCode","ITEM"), mat.get("description",""),
                         mat.get("qty",1), mat.get("unit","NOS"), mat.get("supplierName",""),
                         mat.get("leadTimeDays",14), bool(mat.get("isCriticalPath")),
                         format_db_date(mat.get("orderedDate")) if mat.get("orderedDate") else None,
                         format_db_date(mat.get("expectedDate")) if mat.get("expectedDate") else None,
                         format_db_date(mat.get("dispatchedDate")) if mat.get("dispatchedDate") else None,
                         format_db_date(mat.get("receivedDate")) if mat.get("receivedDate") else None,
                         mat.get("grnNumber"), mat.get("inspectionResult","Pending"), mat.get("inspectionNotes")),
                    )

            # Baseline Revisions
            for rev in (po.get("revisions") or []):
                try:
                    rev_id = to_db_id(f"{po_id}-rev-{rev.get('revNumber','')}", "rev")
                    approved_at = format_db_datetime(rev.get("approvedAt")) or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    cursor.execute(
                        """INSERT INTO baseline_revisions (id,organization_id,purchase_order_id,revision_number,
                        reason,document_reference,requested_by,approved_by,approved_at)
                        VALUES(%s,%s,%s,%s,%s,%s,NULL,NULL,%s)
                        ON DUPLICATE KEY UPDATE reason=VALUES(reason),document_reference=VALUES(document_reference),
                        approved_at=VALUES(approved_at)""",
                        (rev_id, org_id, po_id, rev.get("revNumber"), rev.get("reason",""),
                         rev.get("docRef",""), approved_at),
                    )
                    for ch in (rev.get("changes") or []):
                        ch_line_id = to_db_id(ch.get("lineId"), "lin")
                        change_id = to_db_id(f"{rev_id}-{ch_line_id}-{ch.get('milestoneKey','')}", "chg")
                        cursor.execute("SELECT id FROM product_lines WHERE id = %s LIMIT 1", (ch_line_id,))
                        if not cursor.fetchone():
                            continue
                        cursor.execute(
                            """INSERT INTO baseline_revision_changes (id,organization_id,baseline_revision_id,
                            product_line_id,milestone_key,old_duration_days,new_duration_days,
                            old_baseline_end_date,new_baseline_end_date)
                            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON DUPLICATE KEY UPDATE
                            old_duration_days=VALUES(old_duration_days),new_duration_days=VALUES(new_duration_days),
                            old_baseline_end_date=VALUES(old_baseline_end_date),
                            new_baseline_end_date=VALUES(new_baseline_end_date)""",
                            (change_id, org_id, rev_id, ch_line_id, ch.get("milestoneKey"),
                             ch.get("oldDuration",0), ch.get("newDuration",0),
                             format_db_date(ch.get("oldBaselineEnd")) if ch.get("oldBaselineEnd") else po_date,
                             format_db_date(ch.get("newBaselineEnd")) if ch.get("newBaselineEnd") else committed),
                        )
                except Exception as rev_err:
                    logger.warning(f"Failed to persist revision for PO {po_id}: {rev_err}")
    conn.commit()


# ---------------------------------------------------------------------------
# Purchase Orders — Load
# ---------------------------------------------------------------------------

def load_orders_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM purchase_orders WHERE organization_id = %s OR organization_id = 'local-development' OR organization_id = 'circor-flow-technologies' ORDER BY po_date DESC",
            (org_id,),
        )
        po_rows = cursor.fetchall()

    if not po_rows:
        return []

    orders = []
    for po_row in po_rows:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM product_lines WHERE purchase_order_id = %s ORDER BY line_number ASC",
                (po_row["id"],),
            )
            line_rows = cursor.fetchall()

        product_lines = []
        for line_row in line_rows:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM milestones WHERE product_line_id = %s ORDER BY stage_order ASC",
                    (line_row["id"],),
                )
                ms_rows = cursor.fetchall()
                cursor.execute(
                    "SELECT * FROM materials WHERE product_line_id = %s",
                    (line_row["id"],),
                )
                mat_rows = cursor.fetchall()

            milestones = []
            for m in ms_rows:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM subdivisions WHERE milestone_id = %s ORDER BY created_at ASC",
                        (m["id"],),
                    )
                    sub_rows = cursor.fetchall()

                sub_tabs = m.get("assembly_sub_tabs")
                if isinstance(sub_tabs, str):
                    try:
                        sub_tabs = json.loads(sub_tabs)
                    except Exception:
                        sub_tabs = None

                ms_obj: dict = {
                    "id": m["id"],
                    "key": m["milestone_key"],
                    "name": CANONICAL_STAGE_NAMES.get(m["milestone_key"], m["milestone_name"]),
                    "stageOrder": CANONICAL_STAGE_ORDER.get(m["milestone_key"], int(m.get("stage_order") or 1)),
                    "defaultDurationDays": int(m.get("default_duration_days") or 1),
                    "committedBaselineStartDate": format_db_date(m.get("committed_baseline_start_date")),
                    "committedBaselineEndDate": format_db_date(m.get("committed_baseline_end_date")),
                    "committedDurationDays": int(m.get("committed_duration_days") or 1),
                    "forecastStartDate": format_db_date(m.get("forecast_start_date")) or format_db_date(m.get("committed_baseline_start_date")),
                    "forecastEndDate": format_db_date(m.get("forecast_end_date")) or format_db_date(m.get("committed_baseline_end_date")),
                    "varianceDays": int(m.get("variance_days") or 0),
                    "status": m.get("status"),
                    "completionPct": int(m.get("completion_pct") or 0),
                }
                if m.get("current_baseline_end_date"):
                    ms_obj["currentBaselineEndDate"] = format_db_date(m["current_baseline_end_date"])
                for opt in ["actualStartDate", "actualEndDate", "approvalReference", "drawingNumber",
                            "ecnNumber", "delayCategory", "delayOwner", "delayReason", "docRef",
                            "backdateReason", "acceptedBy"]:
                    col = {
                        "actualStartDate": "actual_start_date", "actualEndDate": "actual_end_date",
                        "approvalReference": "approval_reference", "drawingNumber": "drawing_number",
                        "ecnNumber": "ecn_number", "delayCategory": "delay_category",
                        "delayOwner": "delay_owner", "delayReason": "delay_reason",
                        "docRef": "doc_ref", "backdateReason": "backdate_reason",
                        "acceptedBy": "accepted_by",
                    }[opt]
                    val = m.get(col)
                    if val:
                        if opt in ("actualStartDate", "actualEndDate"):
                            ms_obj[opt] = format_db_date(val)
                        else:
                            ms_obj[opt] = val
                if sub_tabs is not None:
                    ms_obj["assemblySubTabs"] = sub_tabs
                if sub_rows:
                    ms_obj["subdivisions"] = [
                        {
                            "id": s["id"],
                            "milestoneId": s.get("milestone_id") or m["id"],
                            "title": s["title"],
                            "ownerSlot": s.get("owner_slot"),
                            "ownerUserId": s.get("owner_user_id") or None,
                            "ownerLabel": s.get("owner_label") or None,
                            "status": s.get("status"),
                            "targetStart": format_db_date(s["target_start"]) if s.get("target_start") else None,
                            "targetEnd": format_db_date(s["target_end"]) if s.get("target_end") else None,
                            "actualStart": format_db_date(s["actual_start"]) if s.get("actual_start") else None,
                            "actualEnd": format_db_date(s["actual_end"]) if s.get("actual_end") else None,
                            "delayCause": s.get("delay_cause") or None,
                            "delayNote": s.get("delay_note") or None,
                            "createdAt": s["created_at"].isoformat() if hasattr(s.get("created_at"), "isoformat") else str(s.get("created_at", "")),
                            "updatedAt": s["updated_at"].isoformat() if hasattr(s.get("updated_at"), "isoformat") else str(s.get("updated_at", "")),
                        }
                        for s in sub_rows
                    ]
                milestones.append(ms_obj)

            milestones.sort(key=lambda x: CANONICAL_STAGE_ORDER.get(x["key"], x.get("stageOrder", 99)))

            materials = [
                {
                    "id": mat["id"],
                    "itemCode": mat.get("item_code"),
                    "description": mat.get("description"),
                    "qty": int(mat.get("quantity") or 1),
                    "unit": mat.get("unit"),
                    "supplierName": mat.get("supplier_name"),
                    "leadTimeDays": int(mat.get("lead_time_days") or 14),
                    "isCriticalPath": bool(mat.get("is_critical_path")),
                    "orderedDate": format_db_date(mat["ordered_date"]) if mat.get("ordered_date") else None,
                    "expectedDate": format_db_date(mat["expected_date"]) if mat.get("expected_date") else None,
                    "dispatchedDate": format_db_date(mat["dispatched_date"]) if mat.get("dispatched_date") else None,
                    "receivedDate": format_db_date(mat["received_date"]) if mat.get("received_date") else None,
                    "grnNumber": mat.get("grn_number") or None,
                    "inspectionResult": mat.get("inspection_result") or "Pending",
                    "inspectionNotes": mat.get("inspection_notes") or None,
                }
                for mat in mat_rows
            ]

            product_lines.append({
                "id": line_row["id"],
                "lineNumber": line_row.get("line_number"),
                "productName": line_row.get("product_name"),
                "category": line_row.get("category"),
                "qty": int(line_row.get("quantity") or 1),
                "designType": line_row.get("design_type"),
                "milestones": milestones,
                "materials": materials,
                "overallVarianceDays": int(line_row.get("overall_variance_days") or 0),
                "status": line_row.get("status"),
                "delayReason": line_row.get("delay_reason") or None,
            })

        # Cancellation request for this PO
        cancellation_request = None
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM cancellation_requests WHERE purchase_order_id = %s ORDER BY requested_at DESC LIMIT 1",
                    (po_row["id"],),
                )
                cr = cursor.fetchone()
            if cr:
                cancellation_request = {
                    "id": cr["id"],
                    "poId": cr.get("purchase_order_id"),
                    "poNumber": cr.get("po_number"),
                    "customerName": cr.get("customer_name"),
                    "requestedBy": cr.get("requested_by"),
                    "requestedRole": cr.get("requested_role") or "Buyer",
                    "requestedAt": cr["requested_at"].isoformat() if hasattr(cr.get("requested_at"), "isoformat") else str(cr.get("requested_at","")),
                    "reason": cr.get("reason"),
                    "status": cr.get("status"),
                    "decisionBy": cr.get("decision_by") or cr.get("approved_by") or None,
                    "decisionAt": cr["decision_at"].isoformat() if hasattr(cr.get("decision_at"), "isoformat") else (cr.get("decision_at") or cr.get("approved_at") or None),
                    "decisionNotes": cr.get("decision_notes") or cr.get("notes") or None,
                    "actionTaken": cr.get("action_taken") or None,
                    "approvedBy": cr.get("decision_by") or cr.get("approved_by") or None,
                    "approvedAt": cr["decision_at"].isoformat() if hasattr(cr.get("decision_at"), "isoformat") else (cr.get("decision_at") or cr.get("approved_at") or None),
                    "notes": cr.get("decision_notes") or cr.get("notes") or None,
                }
        except Exception:
            pass

        # Revisions for this PO
        revisions = []
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM baseline_revisions WHERE purchase_order_id = %s ORDER BY revision_number ASC",
                    (po_row["id"],),
                )
                rev_rows = cursor.fetchall()
            for r_row in rev_rows:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "SELECT * FROM baseline_revision_changes WHERE baseline_revision_id = %s",
                        (r_row["id"],),
                    )
                    ch_rows = cursor.fetchall()
                revisions.append({
                    "revNumber": int(r_row.get("revision_number") or 0),
                    "requestedBy": r_row.get("requested_by") or "Project Management",
                    "approvedBy": r_row.get("approved_by") or "Project Management",
                    "approvedAt": r_row["approved_at"].isoformat() if hasattr(r_row.get("approved_at"), "isoformat") else str(r_row.get("approved_at") or ""),
                    "reason": r_row.get("reason") or "",
                    "docRef": r_row.get("document_reference") or "",
                    "changes": [
                        {
                            "lineId": ch.get("product_line_id"),
                            "milestoneKey": ch.get("milestone_key"),
                            "oldDurationDays": int(ch.get("old_duration_days") or 0),
                            "newDurationDays": int(ch.get("new_duration_days") or 0),
                            "oldBaselineEndDate": format_db_date(ch.get("old_baseline_end_date")),
                            "newBaselineEndDate": format_db_date(ch.get("new_baseline_end_date")),
                        }
                        for ch in ch_rows
                    ],
                })
        except Exception:
            pass

        if not revisions:
            revisions = [
                {
                    "revNumber": 0,
                    "requestedBy": "Project Management",
                    "approvedBy": "Project Management",
                    "approvedAt": str(po_row.get("created_at") or datetime.now().isoformat()),
                    "reason": "Initial schedule generated from category template.",
                    "docRef": po_row.get("contract_review_ref") or "CR-INIT",
                    "changes": [],
                }
            ]

        # Attachments for this PO
        attachments = []
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM po_attachments WHERE purchase_order_id = %s ORDER BY uploaded_at ASC",
                    (po_row["id"],),
                )
                att_rows = cursor.fetchall()
            for att in att_rows:
                attachments.append({
                    "id": att["id"],
                    "name": att.get("file_name") or "attachment",
                    "type": att.get("attachment_type") or "General",
                    "size": att.get("file_size") or "",
                    "uploadedAt": att["uploaded_at"].isoformat() if hasattr(att.get("uploaded_at"), "isoformat") else str(att.get("uploaded_at") or ""),
                })
        except Exception:
            pass

        order_obj: dict = {
            "id": po_row["id"],
            "poNumber": po_row.get("po_number"),
            "customerName": po_row.get("customer_name"),
            "customerPoRef": po_row.get("customer_po_ref"),
            "poDate": format_db_date(po_row.get("po_date")),
            "bookedAmount": float(po_row["booked_amount"]) if po_row.get("booked_amount") is not None else None,
            "contractReviewRef": po_row.get("contract_review_ref"),
            "committedDeliveryDate": format_db_date(po_row.get("committed_delivery_date")),
            "revisedDeliveryDate": format_db_date(po_row.get("revised_delivery_date")),
            "actualDeliveryDate": format_db_date(po_row.get("actual_delivery_date")) if po_row.get("actual_delivery_date") else None,
            "status": po_row.get("status"),
            "isClosed": bool(po_row.get("is_closed")),
            "closureNotes": po_row.get("closure_notes") or None,
            "isCancelled": bool(po_row.get("is_cancelled")),
            "cancellationReason": po_row.get("cancellation_reason") or None,
            "isLd": bool(po_row.get("is_ld")),
            "productLines": product_lines,
            "revisions": revisions,
            "attachments": attachments,
            "lastUpdatedAt": po_row["updated_at"].isoformat() if hasattr(po_row.get("updated_at"), "isoformat") else str(po_row.get("updated_at", "")),
            "createdAt": po_row["created_at"].isoformat() if hasattr(po_row.get("created_at"), "isoformat") else str(po_row.get("created_at", "")),
        }
        if cancellation_request:
            order_obj["cancellationRequest"] = cancellation_request

        orders.append(order_obj)

    return orders


def delete_order_from_db(conn: pymysql.connections.Connection, org_id: str, order_id: str) -> bool:
    db_id = to_db_id(order_id, "po")
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT id, po_number FROM purchase_orders WHERE organization_id = %s AND (id = %s OR id = %s OR po_number = %s) LIMIT 1",
            (org_id, order_id, db_id, order_id),
        )
        row = cursor.fetchone()
    if not row:
        return False
    with conn.cursor() as cursor:
        cursor.execute(
            "DELETE FROM purchase_orders WHERE organization_id = %s AND id = %s",
            (org_id, row["id"]),
        )
    conn.commit()
    return True


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

def save_products_to_db(conn: pymysql.connections.Connection, org_id: str, products: list[dict]) -> None:
    if not products:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for prod in products:
            if not prod.get("id"):
                continue
            prod_id = to_db_id(prod["id"], "prd")
            lead_time = int(prod.get("totalLeadTimeDays") or prod.get("leadTimeDays") or 0)
            cursor.execute(
                """INSERT INTO product_catalog (id,organization_id,product_code,product_name,category,
                design_type,total_lead_time_days,description)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                product_code=VALUES(product_code),product_name=VALUES(product_name),
                category=VALUES(category),design_type=VALUES(design_type),
                total_lead_time_days=VALUES(total_lead_time_days),description=VALUES(description)""",
                (prod_id, org_id, prod.get("code") or prod.get("productCode") or "",
                 prod.get("name") or prod.get("productName") or "",
                 prod.get("category",""), prod.get("designType","Existing Design"),
                 lead_time, prod.get("description","")),
            )
            for mat in (prod.get("materials") or prod.get("bomMaterials") or []):
                if not mat.get("id"):
                    continue
                mat_id = to_db_id(mat["id"], "pcm")
                cursor.execute(
                    """INSERT INTO product_catalog_materials (id,organization_id,product_id,item_code,
                    description,supplier_name,lead_time_days,is_critical_path)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                    item_code=VALUES(item_code),description=VALUES(description),
                    supplier_name=VALUES(supplier_name),lead_time_days=VALUES(lead_time_days),
                    is_critical_path=VALUES(is_critical_path)""",
                    (mat_id, org_id, prod_id, mat.get("itemCode",""), mat.get("description",""),
                     mat.get("supplierName",""), int(mat.get("leadTimeDays") or 14),
                     bool(mat.get("isCriticalPath"))),
                )
    conn.commit()


def load_products_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM product_catalog WHERE organization_id = %s OR organization_id = 'circor-flow-technologies' ORDER BY product_name ASC",
            (org_id,),
        )
        rows = cursor.fetchall()
    result = []
    for row in rows:
        materials = []
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM product_catalog_materials WHERE product_id = %s",
                    (row["id"],),
                )
                mat_rows = cursor.fetchall()
            materials = [
                {
                    "id": m["id"],
                    "itemCode": m.get("item_code",""),
                    "description": m.get("description",""),
                    "qty": int(m.get("quantity") or 1),
                    "unit": m.get("unit","NOS"),
                    "leadTimeDays": int(m.get("lead_time_days") or 14),
                    "isCriticalPath": bool(m.get("is_critical_path")),
                    "supplierName": m.get("supplier_name",""),
                }
                for m in mat_rows
            ]
        except Exception:
            pass

        result.append({
            "id": row["id"],
            "code": row.get("product_code",""),
            "productCode": row.get("product_code",""),
            "name": row.get("product_name",""),
            "productName": row.get("product_name",""),
            "category": row.get("category",""),
            "designType": row.get("design_type","Existing Design"),
            "description": row.get("description",""),
            "totalLeadTimeDays": int(row.get("total_lead_time_days") or row.get("lead_time_days") or 0),
            "leadTimeDays": int(row.get("total_lead_time_days") or row.get("lead_time_days") or 0),
            "isActive": True,
            "bomMaterials": materials,
            "materials": materials,
        })
    return result


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def save_templates_to_db(conn: pymysql.connections.Connection, org_id: str, templates: list[dict]) -> None:
    if not templates:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for tmpl in templates:
            if not tmpl.get("id"):
                continue
            tmpl_id = to_db_id(tmpl["id"], "tpl")
            cursor.execute(
                """INSERT INTO category_templates (id, organization_id, category_name, design_type)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    category_name = VALUES(category_name),
                    design_type = VALUES(design_type)""",
                (tmpl_id, org_id, tmpl.get("categoryName",""), tmpl.get("designType","Existing Design")),
            )
            for ms in (tmpl.get("milestones") or []):
                if not ms.get("id") and not ms.get("key"):
                    continue
                ms_id = to_db_id(ms.get("id") or f"{tmpl_id}-{ms.get('key','')}", "ctm")
                dur = ms.get("durationDays") or ms.get("defaultDurationDays") or 1
                cursor.execute(
                    """INSERT INTO category_template_milestones (
                        id, organization_id, template_id, stage_order, milestone_key, milestone_name, duration_days
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        milestone_name = VALUES(milestone_name),
                        stage_order = VALUES(stage_order),
                        duration_days = VALUES(duration_days)""",
                    (ms_id, org_id, tmpl_id, ms.get("stageOrder", 1), ms.get("key", ""), ms.get("name", ""), dur),
                )
    conn.commit()


def load_templates_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM category_templates WHERE organization_id = %s OR organization_id = 'circor-flow-technologies' ORDER BY category_name ASC",
            (org_id,),
        )
        rows = cursor.fetchall()
    result = []
    for row in rows:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM category_template_milestones WHERE template_id = %s ORDER BY stage_order ASC",
                (row["id"],),
            )
            ms_rows = cursor.fetchall()
        milestones = [
            {
                "id": m["id"],
                "key": m.get("milestone_key",""),
                "name": m.get("milestone_name",""),
                "stageOrder": int(m.get("stage_order") or 1),
                "durationDays": int(m.get("duration_days") or 1),
                "defaultDurationDays": int(m.get("duration_days") or 1),
            }
            for m in ms_rows
        ]
        result.append({
            "id": row["id"],
            "categoryName": row.get("category_name",""),
            "designType": row.get("design_type","Existing Design"),
            "description": row.get("description",""),
            "isDefault": True,
            "milestones": milestones,
        })
    return result


# ---------------------------------------------------------------------------
# Audit Logs
# ---------------------------------------------------------------------------

def save_audit_logs_to_db(conn: pymysql.connections.Connection, org_id: str, logs: list[dict]) -> None:
    if not logs:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for log in logs:
            if not log.get("id"):
                continue
            log_id = to_db_id(log["id"], "aud")
            cursor.execute(
                """INSERT INTO audit_logs (
                    id, organization_id, po_number, product_line, role, action,
                    document_reference, details, backdate_reason, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    details = VALUES(details)""",
                (
                    log_id,
                    org_id,
                    log.get("poNumber") or "SYSTEM",
                    log.get("productLine"),
                    log.get("role") or "System",
                    log.get("action") or log.get("actionType") or "",
                    log.get("docRef") or log.get("documentReference"),
                    log.get("details") or log.get("description") or "",
                    log.get("backdateReason"),
                ),
            )
    conn.commit()


def load_audit_logs_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM audit_logs WHERE organization_id = %s OR organization_id = 'circor-flow-technologies' ORDER BY created_at DESC LIMIT 500",
            (org_id,),
        )
        rows = cursor.fetchall()
    return [
        {
            "id": r["id"],
            "timestamp": r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else str(r.get("created_at", "")),
            "user": r.get("role") or "System",
            "role": r.get("role"),
            "poNumber": r.get("po_number"),
            "productLine": r.get("product_line") or None,
            "action": r.get("action"),
            "details": r.get("details"),
            "docRef": r.get("document_reference") or None,
            "backdateReason": r.get("backdate_reason") or None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Rectifications
# ---------------------------------------------------------------------------

def save_rectifications_to_db(conn: pymysql.connections.Connection, org_id: str, rects: list[dict]) -> None:
    if not rects:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for r in rects:
            if not r.get("id"):
                continue
            r_id = to_db_id(r["id"], "rec")
            action_type = r.get("type") or r.get("actionType") or "Expedite"
            cursor.execute(
                """INSERT INTO rectification_actions (
                    id, organization_id, purchase_order_id, product_line_id, po_number,
                    product_line_name, milestone_key, milestone_name, action_type, title,
                    description, impact_days_saved, suggested_by, suggested_at,
                    assigned_to, status, decision_notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    decision_notes = VALUES(decision_notes)""",
                (
                    r_id,
                    org_id,
                    r.get("poId") or r.get("purchaseOrderId"),
                    r.get("lineId") or r.get("productLineId"),
                    r.get("poNumber") or "",
                    r.get("productLineName") or "",
                    r.get("milestoneKey") or "",
                    r.get("milestoneName") or "",
                    action_type,
                    r.get("title") or "",
                    r.get("description") or "",
                    r.get("impactDaysSaved", 0),
                    r.get("suggestedBy") or "System",
                    r.get("assignedTo") or "",
                    r.get("status") or "Suggested",
                    r.get("decisionNotes") or r.get("notes"),
                ),
            )
    conn.commit()


def load_rectifications_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM rectification_actions WHERE organization_id = %s OR organization_id = 'circor-flow-technologies' ORDER BY suggested_at DESC",
            (org_id,),
        )
        rows = cursor.fetchall()
    return [
        {
            "id": r["id"],
            "poNumber": r.get("po_number"),
            "productLineId": r.get("product_line_id") or "",
            "productLineName": r.get("product_line_name"),
            "milestoneKey": r.get("milestone_key"),
            "milestoneName": r.get("milestone_name"),
            "type": r.get("action_type") or "Expedite",
            "actionType": r.get("action_type") or "Expedite",
            "title": r.get("title") or "",
            "description": r.get("description") or "",
            "impactDaysSaved": int(r.get("impact_days_saved") or 0),
            "suggestedBy": r.get("suggested_by") or "System",
            "suggestedAt": r["suggested_at"].isoformat() if hasattr(r.get("suggested_at"), "isoformat") else str(r.get("suggested_at", "")),
            "assignedTo": r.get("assigned_to") or "",
            "status": r.get("status") or "Suggested",
            "decisionNotes": r.get("decision_notes") or None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "atRiskThresholdDays": 3,
    "delayedThresholdDays": 7,
    "offlineSyncQueue": [],
    "enablePushNotifications": False,
}


def save_config_to_db(conn: pymysql.connections.Connection, org_id: str, cfg: dict) -> None:
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        cursor.execute(
            """INSERT INTO system_config (organization_id,at_risk_threshold_days,delayed_threshold_days,
            enable_push_notifications,config_json)
            VALUES(%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
            at_risk_threshold_days=VALUES(at_risk_threshold_days),
            delayed_threshold_days=VALUES(delayed_threshold_days),
            enable_push_notifications=VALUES(enable_push_notifications),
            config_json=VALUES(config_json)""",
            (org_id, cfg.get("atRiskThresholdDays",3), cfg.get("delayedThresholdDays",7),
             bool(cfg.get("enablePushNotifications",False)),
             json.dumps(cfg)),
        )
    conn.commit()


def load_config_from_db(conn: pymysql.connections.Connection, org_id: str) -> Optional[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM system_config WHERE organization_id = %s LIMIT 1",
            (org_id,),
        )
        row = cursor.fetchone()
    if not row:
        return None
    if row.get("config_json"):
        try:
            return json.loads(row["config_json"])
        except Exception:
            pass
    return {
        "atRiskThresholdDays": int(row.get("at_risk_threshold_days") or 3),
        "delayedThresholdDays": int(row.get("delayed_threshold_days") or 7),
        "offlineSyncQueue": [],
        "enablePushNotifications": bool(row.get("enable_push_notifications")),
    }


# ---------------------------------------------------------------------------
# Cancellations
# ---------------------------------------------------------------------------

def save_cancellations_to_db(conn: pymysql.connections.Connection, org_id: str, cancellations: list[dict]) -> None:
    if not cancellations:
        return
    with conn.cursor() as cursor:
        ensure_organization(cursor, org_id)
        for c in cancellations:
            if not c.get("id"):
                continue
            c_id = to_db_id(c["id"], "cnc")
            cursor.execute(
                """INSERT INTO cancellation_requests (id,organization_id,purchase_order_id,po_number,
                customer_name,requested_by,requested_role,requested_at,reason,status,decision_by,decision_at,decision_notes)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                reason=VALUES(reason),status=VALUES(status),decision_by=VALUES(decision_by),
                decision_at=VALUES(decision_at),decision_notes=VALUES(decision_notes)""",
                (c_id, org_id, c.get("poId"), c.get("poNumber"), c.get("customerName"),
                 c.get("requestedBy"), c.get("requestedRole") or "Buyer",
                 format_db_datetime(c.get("requestedAt")) or datetime.now().strftime("%Y-%m-%d %H:%M:%S"), c.get("reason"),
                 c.get("status","Pending"), c.get("approvedBy") or c.get("decisionBy"),
                 format_db_datetime(c.get("approvedAt") or c.get("decisionAt")), c.get("notes") or c.get("decisionNotes")),
            )
    conn.commit()


def load_cancellations_from_db(conn: pymysql.connections.Connection, org_id: str) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM cancellation_requests WHERE organization_id = %s OR organization_id = 'circor-flow-technologies' ORDER BY requested_at DESC",
            (org_id,),
        )
        rows = cursor.fetchall()
    return [
        {
            "id": r["id"],
            "poId": r.get("purchase_order_id"),
            "poNumber": r.get("po_number"),
            "customerName": r.get("customer_name"),
            "requestedBy": r.get("requested_by"),
            "requestedRole": r.get("requested_role") or "Buyer",
            "requestedAt": r["requested_at"].isoformat() if hasattr(r.get("requested_at"), "isoformat") else str(r.get("requested_at","")),
            "reason": r.get("reason"),
            "status": r.get("status"),
            "approvedBy": r.get("decision_by") or r.get("approved_by") or None,
            "approvedAt": r["decision_at"].isoformat() if hasattr(r.get("decision_at"), "isoformat") else (r.get("decision_at") or r.get("approved_at") or None),
            "notes": r.get("decision_notes") or r.get("notes") or None,
        }
        for r in rows
    ]

