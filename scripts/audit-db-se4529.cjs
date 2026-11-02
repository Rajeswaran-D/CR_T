const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3306,
    user: 'cft_app', password: 'RajesD',
    database: 'circor_e2e_dev',
    dateStrings: true
  });

  const [pos] = await pool.query("SELECT * FROM purchase_orders WHERE po_number = 'PO-SE-4529'");
  console.log('PO:', pos[0]?.po_number, 'Customer:', pos[0]?.customer_name, 'Status:', pos[0]?.status, 'PO Date:', pos[0]?.po_date, 'Committed Delivery:', pos[0]?.committed_delivery_date, 'Revised Delivery:', pos[0]?.revised_delivery_date);

  const [lines] = await pool.query("SELECT * FROM product_lines WHERE purchase_order_id = ?", [pos[0]?.id]);
  console.log('Product Line:', lines[0]?.line_number, lines[0]?.product_name, 'Overall Variance:', lines[0]?.overall_variance_days, 'Status:', lines[0]?.status);

  const [milestones] = await pool.query("SELECT * FROM milestones WHERE product_line_id = ? ORDER BY stage_order ASC", [lines[0]?.id]);
  console.log('\n--- MILESTONES IN DB ---');
  milestones.forEach(m => {
    console.log(`Stage ${m.stage_order} (${m.milestone_name}):`);
    console.log(`  Baseline: ${m.committed_baseline_start_date} -> ${m.committed_baseline_end_date} (${m.committed_duration_days}d)`);
    console.log(`  Actual:   ${m.actual_start_date || 'null'} -> ${m.actual_end_date || 'null'}`);
    console.log(`  Forecast: ${m.forecast_start_date} -> ${m.forecast_end_date}`);
    console.log(`  Status:   ${m.status} | Variance: ${m.variance_days}d | Delay: ${m.delay_category || 'null'} - ${m.delay_reason || 'null'}`);
  });

  await pool.end();
}
main().catch(console.error);
