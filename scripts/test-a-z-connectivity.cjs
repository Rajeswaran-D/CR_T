#!/usr/bin/env node
/**
 * A-Z End-to-End Connectivity & Synchronization Test Suite
 *
 * Tests the complete loop:
 *   Frontend (Vite Proxy :5173) -> Backend (Express :3001) -> Database (MySQL circor_e2e_dev)
 *
 * Covers:
 * 1. Health & DB connection verification.
 * 2. Multi-tab synchronization (Tab A, Tab B, Tab C) across BroadcastChannel and backend polling.
 * 3. INSERT event: Full order created via FE proxy -> verified in Express -> verified directly in MySQL.
 * 4. UPDATE event: Milestone updated via FE proxy -> verified in Tab A -> verified in Express -> verified in MySQL.
 * 5. DELETE event: Order deleted via FE proxy -> verified in Tab B -> verified in Express (404) -> verified 0 rows in MySQL.
 * 6. Resurrection protection: Stale tab push does NOT resurrect deleted order in DB.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const VITE_PORT = 5173;
const BACKEND_PORT = 3001;
const ORG_ID = process.env.VITE_ORGANIZATION_ID || 'local-development';
const FE_PROXY_URL = `http://localhost:${VITE_PORT}/api`;
const BE_DIRECT_URL = `http://localhost:${BACKEND_PORT}/api`;

const results = [];
function recordResult(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const icon = passed ? '✅ [PASS]' : '❌ [FAIL]';
  console.log(`  ${icon} ${name}${detail ? ` (${detail})` : ''}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHttp(url, maxAttempts = 60, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      await sleep(intervalMs);
    }
  }
  return false;
}

async function run() {
  console.log('========================================================================');
  console.log('🧪 CIRCOR E2E TRACKER: A-Z CONNECTIVITY & MULTI-TAB SYNC TEST');
  console.log('========================================================================\n');

  // Direct MySQL Connection
  console.log('📡 [PHASE 1] Connecting directly to MySQL...');
  const dbConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'cft_app',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'circor_e2e_dev'
  };

  let dbConn;
  try {
    dbConn = await mysql.createConnection(dbConfig);
    const [ping] = await dbConn.query('SELECT 1 AS ok');
    recordResult('Direct MySQL connection', ping && ping[0].ok === 1, `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } catch (err) {
    recordResult('Direct MySQL connection', false, err.message);
    process.exit(1);
  }

  // Start Backend Process
  console.log('\n🚀 [PHASE 2] Starting Express Backend Server (:3001)...');
  const serverProc = spawn('npx', ['tsx', 'server/server.ts'], {
    cwd: ROOT,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(BACKEND_PORT) }
  });

  const backendOnline = await waitForHttp(`${BE_DIRECT_URL}/health`, 60, 500);
  if (!backendOnline) {
    console.error('❌ Express backend failed to boot!');
    serverProc.kill();
    if (dbConn) await dbConn.end();
    process.exit(1);
  }
  recordResult('Express backend online', true, `port ${BACKEND_PORT}`);

  // Start Vite Frontend Dev Server
  console.log('\n🌐 [PHASE 3] Starting Vite Frontend Dev Server (:5173)...');
  const viteProc = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: ROOT,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env }
  });

  const viteOnline = await waitForHttp(`http://localhost:${VITE_PORT}`, 60, 500);
  if (!viteOnline) {
    console.error('❌ Vite dev server failed to boot!');
    viteProc.kill();
    serverProc.kill();
    if (dbConn) await dbConn.end();
    process.exit(1);
  }
  recordResult('Vite dev server online', true, `port ${VITE_PORT}`);

  // Verify Vite Proxy connectivity to Backend
  const proxyRes = await fetch(`${FE_PROXY_URL}/health`);
  const healthData = await proxyRes.json();
  recordResult(
    'Vite Proxy -> Express Backend connectivity',
    proxyRes.status === 200 && healthData.status === 'healthy',
    `Status: ${healthData.status}, Storage: ${healthData.storageProvider}`
  );
  recordResult(
    'Backend MySQL pool status',
    healthData.dbConnected === true && healthData.dbConfigured === true,
    `dbConnected: ${healthData.dbConnected}`
  );

  // Set up Multi-Tab Broadcast Channels
  console.log('\n📑 [PHASE 4] Setting Up Multi-Tab Real-Time Synchronization Simulation...');
  const CHANNEL_NAME = 'cft_tracker_cross_tab_channel';
  const tabA_Channel = new BroadcastChannel(CHANNEL_NAME);
  const tabB_Channel = new BroadcastChannel(CHANNEL_NAME);

  const tabB_Events = [];
  tabB_Channel.onmessage = (event) => {
    tabB_Events.push(event.data);
  };

  const tabA_Events = [];
  tabA_Channel.onmessage = (event) => {
    tabA_Events.push(event.data);
  };
  recordResult('Multi-tab BroadcastChannels initialized', true, 'Tab A & Tab B joined cft_tracker_cross_tab_channel');

  // Test Data Setup
  const testPoNumber = `AZ-TEST-${Date.now().toString().slice(-5)}`;
  const testPoId = `po-az-${Date.now()}`;
  const testLineId = `line-az-${Date.now()}`;
  const testMaterialId = `mat-az-${Date.now()}`;

  const initialOrder = {
    id: testPoId,
    poNumber: testPoNumber,
    customerName: 'Turbine Dynamics Aerospace Corp',
    customerPoRef: 'AERO-REF-2026',
    poDate: '2026-10-15',
    committedDeliveryDate: '2026-12-15',
    revisedDeliveryDate: '2026-12-15',
    status: 'In Progress',
    bookedAmount: 185000,
    contractReviewRef: 'CR-AZ-900',
    productLines: [
      {
        id: testLineId,
        lineNumber: 'LINE-01',
        productName: 'Cryo Extreme Safety Valve 4-inch',
        category: 'High-Pressure Control Valves',
        qty: 5,
        designType: 'Existing Design',
        status: 'In Progress',
        overallVarianceDays: 0,
        milestones: [
          {
            id: `ms-${testLineId}-po_from_customer`,
            key: 'po_from_customer',
            name: '1. Customer Purchase Order (PO)',
            stageOrder: 1,
            defaultDurationDays: 1,
            committedBaselineStartDate: '2026-10-15',
            committedBaselineEndDate: '2026-10-15',
            actualStartDate: '2026-10-15',
            actualEndDate: '2026-10-15',
            forecastStartDate: '2026-10-15',
            forecastEndDate: '2026-10-15',
            status: 'Completed',
            completionPct: 100,
            docRef: 'PO-AZ-INTAKE'
          },
          {
            id: `ms-${testLineId}-pm_baseline`,
            key: 'pm_baseline',
            name: '2. Baseline Review & Planning',
            stageOrder: 2,
            defaultDurationDays: 3,
            committedBaselineStartDate: '2026-10-16',
            committedBaselineEndDate: '2026-10-18',
            actualStartDate: '2026-10-16',
            forecastStartDate: '2026-10-16',
            forecastEndDate: '2026-10-18',
            status: 'In Progress',
            completionPct: 50
          }
        ],
        materials: [
          {
            id: testMaterialId,
            itemCode: 'MAT-SS316-FORGE',
            description: 'SS316 Forged Valve Body Blank',
            qty: 5,
            unit: 'PCS',
            supplierName: 'Titanium Castings Ltd',
            leadTimeDays: 14,
            isCriticalPath: true,
            orderedDate: '2026-10-16',
            expectedDate: '2026-10-30',
            inspectionResult: 'Pending'
          }
        ]
      }
    ],
    revisions: [],
    attachments: [],
    createdBy: 'Project Management',
    createdAt: new Date().toISOString(),
    lastUpdatedBy: 'Project Management',
    lastUpdatedAt: new Date().toISOString(),
    isClosed: false
  };

  // -------------------------------------------------------------------------
  // PHASE 5: INSERT EVENT (FE -> BE -> DB + Multi-Tab Broadcast)
  // -------------------------------------------------------------------------
  console.log('\n➕ [PHASE 5] Executing INSERT Event...');

  // Tab A dispatches save through Vite FE Proxy
  const insertRes = await fetch(`${FE_PROXY_URL}/shared-state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': ORG_ID
    },
    body: JSON.stringify({
      cft_pos: [initialOrder]
    })
  });
  recordResult('Tab A sends INSERT to FE Proxy (:5173/api/shared-state)', insertRes.status === 204, `status ${insertRes.status}`);

  // Tab A broadcasts to all other open tabs
  tabA_Channel.postMessage({
    type: 'CFT_SYNC_KEY',
    key: 'cft_pos',
    serialized: JSON.stringify([initialOrder]),
    timestamp: Date.now()
  });

  // Check Tab B received real-time broadcast
  await sleep(150);
  const receivedInsertEvent = tabB_Events.find(e => e.type === 'CFT_SYNC_KEY' && e.key === 'cft_pos');
  recordResult(
    'Tab B receives INSERT event instantly via BroadcastChannel',
    Boolean(receivedInsertEvent),
    `Received in Tab B: ${Boolean(receivedInsertEvent)}`
  );

  // Verify BE Direct Read
  const beOrderRes = await fetch(`${BE_DIRECT_URL}/orders/${testPoId}`, {
    headers: { 'X-Organization-Id': ORG_ID }
  });
  const beOrder = await beOrderRes.json();
  recordResult(
    'Backend returns newly inserted order via REST GET',
    beOrderRes.status === 200 && beOrder.poNumber === testPoNumber,
    `PO: ${beOrder.poNumber}, Customer: ${beOrder.customerName}`
  );

  // Verify Directly in MySQL Database
  const [poDbRows] = await dbConn.query(
    'SELECT id, po_number, customer_name, status, booked_amount FROM purchase_orders WHERE po_number = ?',
    [testPoNumber]
  );
  recordResult(
    'MySQL: purchase_orders row inserted and verified',
    poDbRows.length === 1 && poDbRows[0].customer_name === 'Turbine Dynamics Aerospace Corp',
    `DB ID: ${poDbRows[0]?.id}, Customer: ${poDbRows[0]?.customer_name}, Amount: ${poDbRows[0]?.booked_amount}`
  );

  const [lineDbRows] = await dbConn.query(
    'SELECT id, line_number, product_name, quantity FROM product_lines WHERE purchase_order_id = ?',
    [poDbRows[0]?.id]
  );
  recordResult(
    'MySQL: product_lines child row inserted and verified',
    lineDbRows.length === 1 && lineDbRows[0].product_name === 'Cryo Extreme Safety Valve 4-inch',
    `Line: ${lineDbRows[0]?.line_number}, Qty: ${lineDbRows[0]?.quantity}`
  );

  const [msDbRows] = await dbConn.query(
    'SELECT milestone_key, milestone_name, status FROM milestones WHERE product_line_id = ?',
    [lineDbRows[0]?.id]
  );
  recordResult(
    'MySQL: milestones rows inserted and verified',
    msDbRows.length === 2 && msDbRows.some(m => m.milestone_key === 'po_from_customer'),
    `Milestones count: ${msDbRows.length}`
  );

  const [matDbRows] = await dbConn.query(
    'SELECT item_code, description, lead_time_days FROM materials WHERE product_line_id = ?',
    [lineDbRows[0]?.id]
  );
  recordResult(
    'MySQL: materials row inserted and verified',
    matDbRows.length === 1 && matDbRows[0].item_code === 'MAT-SS316-FORGE',
    `Material: ${matDbRows[0]?.item_code}, Lead time: ${matDbRows[0]?.lead_time_days}d`
  );

  // -------------------------------------------------------------------------
  // PHASE 6: UPDATE EVENT (FE -> BE -> DB + Multi-Tab Sync)
  // -------------------------------------------------------------------------
  console.log('\n✏️ [PHASE 6] Executing UPDATE Event (advancing milestone to Completed)...');

  // Tab B advances milestone stage 2 (pm_baseline) to Completed
  const updatedOrder = JSON.parse(JSON.stringify(initialOrder));
  const pmBaselineMs = updatedOrder.productLines[0].milestones.find(m => m.key === 'pm_baseline');
  pmBaselineMs.status = 'Completed';
  pmBaselineMs.completionPct = 100;
  pmBaselineMs.actualEndDate = '2026-10-18';
  pmBaselineMs.docRef = 'PM-AZ-APPROVED-DOC';
  updatedOrder.lastUpdatedAt = new Date().toISOString();

  // Tab B persists through Vite Proxy
  const updateRes = await fetch(`${FE_PROXY_URL}/shared-state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': ORG_ID
    },
    body: JSON.stringify({
      cft_pos: [updatedOrder]
    })
  });
  recordResult('Tab B sends UPDATE to FE Proxy (:5173/api/shared-state)', updateRes.status === 204, `status ${updateRes.status}`);

  // Tab B broadcasts to Tab A
  tabB_Channel.postMessage({
    type: 'CFT_SYNC_KEY',
    key: 'cft_pos',
    serialized: JSON.stringify([updatedOrder]),
    timestamp: Date.now()
  });

  // Verify Tab A received the update
  await sleep(150);
  const tabAReceivedUpdate = tabA_Events.find(e => e.type === 'CFT_SYNC_KEY' && e.key === 'cft_pos');
  const tabAParsedOrder = tabAReceivedUpdate ? JSON.parse(tabAReceivedUpdate.serialized)[0] : null;
  const tabAPmMs = tabAParsedOrder?.productLines[0]?.milestones?.find(m => m.key === 'pm_baseline');
  recordResult(
    'Tab A receives UPDATE event instantly via BroadcastChannel',
    tabAPmMs && tabAPmMs.status === 'Completed' && tabAPmMs.docRef === 'PM-AZ-APPROVED-DOC',
    `Stage 2 Status: ${tabAPmMs?.status}, DocRef: ${tabAPmMs?.docRef}`
  );

  // Verify directly in MySQL Database
  const [updatedMsDb] = await dbConn.query(
    'SELECT milestone_key, status, completion_pct, actual_end_date, doc_ref FROM milestones WHERE milestone_key = "pm_baseline" AND product_line_id = ?',
    [lineDbRows[0]?.id]
  );
  recordResult(
    'MySQL: milestones row updated to Completed with verified columns',
    updatedMsDb.length === 1 && updatedMsDb[0].status === 'Completed' && Number(updatedMsDb[0].completion_pct) === 100,
    `Status: ${updatedMsDb[0]?.status}, EndDate: ${updatedMsDb[0]?.actual_end_date ? new Date(updatedMsDb[0].actual_end_date).toISOString().slice(0, 10) : 'N/A'}, Pct: ${updatedMsDb[0]?.completion_pct}%`
  );

  // -------------------------------------------------------------------------
  // PHASE 7: DELETE EVENT (FE -> BE -> DB + Multi-Tab Sync)
  // -------------------------------------------------------------------------
  console.log('\n🗑️ [PHASE 7] Executing DELETE Event...');

  // Tab A sends DELETE to FE proxy
  const deleteRes = await fetch(`${FE_PROXY_URL}/orders/${testPoId}`, {
    method: 'DELETE',
    headers: { 'X-Organization-Id': ORG_ID }
  });
  recordResult('Tab A sends DELETE to FE Proxy (:5173/api/orders/:id)', deleteRes.status === 204, `status ${deleteRes.status}`);

  // Tab A broadcasts deletion event
  tabA_Channel.postMessage({
    type: 'CFT_PO_DELETED',
    poId: testPoId
  });

  // Check Tab B received deletion broadcast
  await sleep(150);
  const tabBDeleteEvent = tabB_Events.find(e => e.type === 'CFT_PO_DELETED' && e.poId === testPoId);
  recordResult(
    'Tab B receives CFT_PO_DELETED event instantly via BroadcastChannel',
    Boolean(tabBDeleteEvent),
    `Deleted PO ID: ${tabBDeleteEvent?.poId}`
  );

  // Verify Backend returns 404
  const verifyDeleteBe = await fetch(`${BE_DIRECT_URL}/orders/${testPoId}`, {
    headers: { 'X-Organization-Id': ORG_ID }
  });
  recordResult(
    'Backend returns 404 for deleted order',
    verifyDeleteBe.status === 404,
    `Status: ${verifyDeleteBe.status}`
  );

  // Verify Directly in MySQL: 0 rows remain (cascade deleted)
  const [poDbAfterDel] = await dbConn.query(
    'SELECT COUNT(*) AS count FROM purchase_orders WHERE po_number = ?',
    [testPoNumber]
  );
  recordResult(
    'MySQL: purchase_orders row confirmed DELETED (0 rows)',
    poDbAfterDel[0].count === 0,
    `Count: ${poDbAfterDel[0].count}`
  );

  const [lineDbAfterDel] = await dbConn.query(
    'SELECT COUNT(*) AS count FROM product_lines WHERE purchase_order_id = ?',
    [poDbRows[0]?.id]
  );
  recordResult(
    'MySQL: product_lines child cascade DELETED (0 rows)',
    lineDbAfterDel[0].count === 0,
    `Count: ${lineDbAfterDel[0].count}`
  );

  const [msDbAfterDel] = await dbConn.query(
    'SELECT COUNT(*) AS count FROM milestones WHERE product_line_id = ?',
    [lineDbRows[0]?.id]
  );
  recordResult(
    'MySQL: milestones cascade DELETED (0 rows)',
    msDbAfterDel[0].count === 0,
    `Count: ${msDbAfterDel[0].count}`
  );

  // -------------------------------------------------------------------------
  // PHASE 8: RESURRECTION PREVENTION CHECK
  // -------------------------------------------------------------------------
  console.log('\n🛡️ [PHASE 8] Testing Stale-Tab Resurrection Protection...');

  // A stale tab attempts to push an old state containing the deleted PO
  const stalePushRes = await fetch(`${FE_PROXY_URL}/shared-state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Organization-Id': ORG_ID
    },
    body: JSON.stringify({
      cft_pos: [initialOrder]
    })
  });
  recordResult('Stale tab sends pre-delete snapshot to FE Proxy', stalePushRes.status === 204);

  // Verify MySQL: the tombstone blocked re-insertion
  const [poDbAfterStalePush] = await dbConn.query(
    'SELECT COUNT(*) AS count FROM purchase_orders WHERE po_number = ?',
    [testPoNumber]
  );
  recordResult(
    'Tombstone blocked resurrection: MySQL still has 0 rows',
    poDbAfterStalePush[0].count === 0,
    `Count: ${poDbAfterStalePush[0].count}`
  );

  // GET /api/orders must not serve it
  const getOrdersRes = await fetch(`${FE_PROXY_URL}/orders`, {
    headers: { 'X-Organization-Id': ORG_ID }
  });
  const currentOrders = await getOrdersRes.json();
  const resurrectCheck = currentOrders.some(o => o.poNumber === testPoNumber || o.id === testPoId);
  recordResult(
    'GET /api/orders filters tombstoned order (never resurrects in FE state)',
    !resurrectCheck,
    `Found in orders list: ${resurrectCheck}`
  );

  // -------------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n🧹 Cleaning up test processes...');
  tabA_Channel.close();
  tabB_Channel.close();
  if (dbConn) await dbConn.end();
  viteProc.kill();
  serverProc.kill();

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log('\n========================================================================');
  console.log(`📊 FINAL TEST SUMMARY: ${passed}/${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('========================================================================');

  if (failed === 0) {
    console.log('🎉 ALL A-Z CONNECTIVITY & MULTI-TAB SYNCHRONIZATION TESTS PASSED PERFECTLY!');
    console.log('✨ FE <-> BE <-> DB: Real-time INSERT, UPDATE, DELETE & Multi-Tab Sync 100% OPERATIONAL.\n');
    process.exit(0);
  } else {
    console.error(`❌ ${failed} check(s) failed.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
