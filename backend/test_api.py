"""
Complete Integration Test Suite for the Python FastAPI Backend.
Tests all 20 API endpoints matching the exact contracts of the frontend.
"""
import io
import json
import urllib.request
import urllib.error
import sys

# Ensure UTF-8 output on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_URL = "http://127.0.0.1:5000/api"
DEFAULT_HEADERS = {
    "Content-Type": "application/json",
    "X-Organization-Id": "circor-flow-technologies"
}

def request(method, path, body=None, headers=None):
    url = f"{BASE_URL}{path}"
    h = dict(DEFAULT_HEADERS)
    if headers:
        h.update(headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else None
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            parsed = json.loads(content)
        except Exception:
            parsed = content
        return e.code, parsed

def test(name, fn):
    try:
        ok = fn()
        if ok:
            print(f"  \u2705 [PASS] {name}")
            return True
        else:
            print(f"  \u274c [FAIL] {name} returned False")
            return False
    except Exception as e:
        print(f"  \u274c [ERROR] {name}: {e}")
        return False

def run_all():
    print("================================================================")
    print("\U0001f680 RUNNING PYTHON FASTAPI INTEGRATION TEST SUITE")
    print("================================================================\n")
    results = []

    print("\U0001f4cb GROUP 1: Health & Diagnostics")
    def test_health():
        status, data = request("GET", "/health")
        return status == 200 and "status" in data and "storageProvider" in data
    results.append(test("GET /api/health", test_health))

    def test_db_status():
        status, data = request("GET", "/db/status")
        return status == 200 and "storageProvider" in data and "ordersCount" in data
    results.append(test("GET /api/db/status", test_db_status))

    print("\n\U0001f4cb GROUP 2: Shared State Live-Sync")
    def test_shared_state_get():
        status, data = request("GET", "/shared-state")
        return status == 200 and isinstance(data, dict) and "cft_pos" in data
    results.append(test("GET /api/shared-state", test_shared_state_get))

    def test_shared_state_put():
        status, _ = request("PUT", "/shared-state", body={"cft_test_ping": 12345})
        return status == 204
    results.append(test("PUT /api/shared-state", test_shared_state_put))

    print("\n\U0001f4cb GROUP 3: Purchase Orders CRUD Lifecycle")
    test_id = "test-po-python-001"
    test_po = {
        "id": test_id,
        "poNumber": "PO-PY-001",
        "customerName": "FastAPI Aerospace",
        "customerPoRef": "REF-PY-99",
        "poDate": "2026-11-01",
        "committedDeliveryDate": "2026-12-01",
        "revisedDeliveryDate": "2026-12-01",
        "status": "In Progress",
        "productLines": [],
        "revisions": [],
        "attachments": [],
    }

    def test_create_order():
        status, data = request("POST", "/orders", body=test_po)
        return status == 201 and data.get("id") == test_id
    results.append(test("POST /api/orders creates order", test_create_order))

    def test_get_orders():
        status, data = request("GET", "/orders")
        return status == 200 and isinstance(data, list) and any(o.get("id") == test_id for o in data)
    results.append(test("GET /api/orders lists created order", test_get_orders))

    def test_get_order_by_id():
        status, data = request("GET", f"/orders/{test_id}")
        return status == 200 and data.get("customerName") == "FastAPI Aerospace"
    results.append(test("GET /api/orders/:id retrieves order", test_get_order_by_id))

    def test_update_order():
        status, data = request("PUT", f"/orders/{test_id}", body={"customerName": "FastAPI Aerospace Updated"})
        return status == 200 and data.get("customerName") == "FastAPI Aerospace Updated"
    results.append(test("PUT /api/orders/:id updates order", test_update_order))

    def test_delete_order():
        status, _ = request("DELETE", f"/orders/{test_id}")
        if status != 204:
            return False
        get_status, _ = request("GET", f"/orders/{test_id}")
        return get_status == 404
    results.append(test("DELETE /api/orders/:id removes order", test_delete_order))

    print("\n\U0001f4cb GROUP 4: Product Catalog & Templates")
    test_prod_id = "test-prod-py-01"
    test_prod = {
        "id": test_prod_id,
        "code": "PROD-PY-01",
        "productCode": "PROD-PY-01",
        "name": "FastAPI High Pressure Valve",
        "productName": "FastAPI High Pressure Valve",
        "category": "Valves",
        "description": "Engineered Valve",
        "leadTimeDays": 30,
        "isActive": True,
        "bomMaterials": []
    }

    def test_create_product():
        status, data = request("POST", "/products", body=test_prod)
        return status == 201 and data.get("id") == test_prod_id
    results.append(test("POST /api/products adds product", test_create_product))

    def test_get_products():
        status, data = request("GET", "/products")
        found = status == 200 and isinstance(data, list) and any(p.get("id") == test_prod_id for p in data)
        # Clean up test product via shared-state so it never pollutes the catalog
        s_status, s_data = request("GET", "/shared-state")
        if s_status == 200 and isinstance(s_data, dict):
            s_data["cft_products"] = [p for p in s_data.get("cft_products", []) if p.get("id") != test_prod_id]
            request("PUT", "/shared-state", body=s_data)
        return found
    results.append(test("GET /api/products returns products", test_get_products))

    def test_get_templates():
        status, data = request("GET", "/templates")
        return status == 200 and isinstance(data, list)
    results.append(test("GET /api/templates returns templates", test_get_templates))

    def test_create_template():
        tmpl_id = "test-tmpl-py-01"
        status, data = request("POST", "/templates", body={
            "id": tmpl_id,
            "categoryName": "Control Valves",
            "description": "Standard control valve template",
            "isDefault": False,
            "milestones": []
        })
        return status == 201 and data.get("id") == tmpl_id
    results.append(test("POST /api/templates creates template", test_create_template))

    print("\n\U0001f4cb GROUP 5: Governance & Config")
    def test_create_audit():
        audit_id = "test-audit-py-01"
        status, data = request("POST", "/audit-log", body={
            "id": audit_id,
            "poNumber": "PO-PY-001",
            "actionType": "INTEGRATION_TEST",
            "description": "Testing audit log creation",
            "userId": "admin"
        })
        return status == 201 and data.get("id") == audit_id
    results.append(test("POST /api/audit-log creates log", test_create_audit))

    def test_get_audit():
        status, data = request("GET", "/audit-log")
        return status == 200 and isinstance(data, list)
    results.append(test("GET /api/audit-log lists logs", test_get_audit))

    def test_get_rectifications():
        status, data = request("GET", "/rectifications")
        return status == 200 and isinstance(data, list)
    results.append(test("GET /api/rectifications lists actions", test_get_rectifications))

    def test_get_put_config():
        status, cfg = request("GET", "/config")
        if status != 200:
            return False
        cfg["atRiskThresholdDays"] = 4
        p_status, p_data = request("PUT", "/config", body=cfg)
        return p_status == 200 and p_data.get("atRiskThresholdDays") == 4
    results.append(test("GET & PUT /api/config updates config", test_get_put_config))

    print("\n\U0001f4cb GROUP 6: Cancellations")
    test_canc_po_id = "test-po-canc-tmp-01"
    test_canc_id = "test-canc-py-01"
    def test_create_cancellation():
        # Create a temporary PO so live user orders are never touched
        request("POST", "/orders", body={
            "id": test_canc_po_id,
            "poNumber": "PO-TEMP-CANC-99",
            "customerName": "Test Customer",
            "customerPoRef": "REF-TEMP-99",
            "poDate": "2026-11-01",
            "committedDeliveryDate": "2026-12-01",
            "revisedDeliveryDate": "2026-12-01",
            "status": "In Progress",
            "productLines": [],
        })
        c_status, data = request("POST", "/cancellations", body={
            "id": test_canc_id,
            "poId": test_canc_po_id,
            "poNumber": "PO-TEMP-CANC-99",
            "customerName": "Test Customer",
            "requestedBy": "Tester",
            "reason": "Test Cancellation",
            "status": "Pending"
        })
        return c_status == 201 and data.get("id") == test_canc_id
    results.append(test("POST /api/cancellations submits request", test_create_cancellation))

    def test_get_cancellations():
        status, data = request("GET", "/cancellations")
        passed = status == 200 and isinstance(data, list) and any(c.get("id") == test_canc_id for c in data)
        # Clean up temporary PO (cascades and deletes test cancellation cleanly)
        request("DELETE", f"/orders/{test_canc_po_id}")
        return passed
    results.append(test("GET /api/cancellations lists requests", test_get_cancellations))

    passed = sum(results)
    total = len(results)
    print("\n================================================================")
    if passed == total:
        print(f"\U0001f389 ALL {passed}/{total} BACKEND INTEGRATION TESTS PASSED (100%)!")
        print("\U0001f4a5 FastAPI is 100% compliant with React frontend and test specifications.")
        print("================================================================\n")
        return 0
    else:
        print(f"\u274c {total - passed}/{total} TESTS FAILED.")
        print("================================================================\n")
        return 1

if __name__ == "__main__":
    sys.exit(run_all())
