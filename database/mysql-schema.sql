-- CICOR Flow Technologies organization database foundation.
-- Keep this schema behind an authenticated API. The browser must never connect to MySQL directly.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE organizations (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  role VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_org_email (organization_id, email),
  CONSTRAINT fk_users_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE purchase_orders (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  po_number VARCHAR(80) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_po_ref VARCHAR(120) NOT NULL,
  po_date DATE NOT NULL,
  booked_amount DECIMAL(15, 2) NULL,
  contract_review_ref VARCHAR(120) NOT NULL,
  committed_delivery_date DATE NOT NULL,
  revised_delivery_date DATE NOT NULL,
  actual_delivery_date DATE NULL,
  status VARCHAR(40) NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closure_notes TEXT NULL,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMP NULL,
  cancelled_by VARCHAR(160) NULL,
  cancellation_reason TEXT NULL,
  created_by VARCHAR(128) NULL,
  last_updated_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_orders_org_number (organization_id, po_number),
  KEY idx_purchase_orders_org_status (organization_id, status),
  KEY idx_purchase_orders_org_closed (organization_id, is_closed),
  KEY idx_purchase_orders_org_cancelled (organization_id, is_cancelled),
  CONSTRAINT fk_purchase_orders_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_purchase_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_purchase_orders_updated_by FOREIGN KEY (last_updated_by) REFERENCES users(id)
);

CREATE TABLE po_attachments (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  attachment_type VARCHAR(80) NOT NULL,
  file_size VARCHAR(40) NOT NULL,
  uploaded_by VARCHAR(128) NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attachments_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_attachments_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE product_lines (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NOT NULL,
  line_number VARCHAR(40) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(160) NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  design_type VARCHAR(40) NOT NULL,
  status VARCHAR(40) NOT NULL,
  overall_variance_days INT NOT NULL DEFAULT 0,
  delay_reason TEXT NULL,
  UNIQUE KEY uq_product_lines_order_number (purchase_order_id, line_number),
  CONSTRAINT fk_product_lines_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_product_lines_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE milestones (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  product_line_id VARCHAR(128) NOT NULL,
  milestone_key VARCHAR(100) NOT NULL,
  milestone_name VARCHAR(255) NOT NULL,
  stage_order INT NOT NULL,
  default_duration_days INT NOT NULL,
  committed_baseline_start_date DATE NOT NULL,
  committed_baseline_end_date DATE NOT NULL,
  current_baseline_end_date DATE NULL,
  committed_duration_days INT NOT NULL,
  actual_start_date DATE NULL,
  actual_end_date DATE NULL,
  forecast_start_date DATE NOT NULL,
  forecast_end_date DATE NOT NULL,
  variance_days INT NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL,
  completion_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
  approval_reference VARCHAR(160) NULL,
  drawing_number VARCHAR(160) NULL,
  ecn_number VARCHAR(160) NULL,
  delay_category VARCHAR(40) NULL,
  delay_owner VARCHAR(160) NULL,
  delay_reason TEXT NULL,
  doc_ref VARCHAR(160) NULL,
  backdate_reason TEXT NULL,
  accepted_by VARCHAR(160) NULL,
  accepted_at TIMESTAMP NULL,
  assembly_sub_tabs JSON NULL,
  last_updated_by VARCHAR(128) NULL,
  last_updated_at TIMESTAMP NULL,
  UNIQUE KEY uq_milestones_line_key (product_line_id, milestone_key),
  KEY idx_milestones_line_order (product_line_id, stage_order),
  CONSTRAINT fk_milestones_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_milestones_line FOREIGN KEY (product_line_id) REFERENCES product_lines(id) ON DELETE CASCADE
);

CREATE TABLE materials (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  product_line_id VARCHAR(128) NOT NULL,
  item_code VARCHAR(120) NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(14, 3) NOT NULL,
  unit VARCHAR(40) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  lead_time_days INT NOT NULL,
  is_critical_path BOOLEAN NOT NULL DEFAULT FALSE,
  ordered_date DATE NULL,
  expected_date DATE NULL,
  dispatched_date DATE NULL,
  received_date DATE NULL,
  grn_number VARCHAR(160) NULL,
  inspection_result VARCHAR(40) NULL,
  inspection_notes TEXT NULL,
  updated_by VARCHAR(128) NULL,
  updated_at TIMESTAMP NULL,
  CONSTRAINT fk_materials_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_materials_line FOREIGN KEY (product_line_id) REFERENCES product_lines(id) ON DELETE CASCADE
);

CREATE TABLE baseline_revisions (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NOT NULL,
  revision_number INT NOT NULL,
  reason TEXT NOT NULL,
  document_reference VARCHAR(160) NOT NULL,
  requested_by VARCHAR(128) NULL,
  approved_by VARCHAR(128) NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_revisions_order_number (purchase_order_id, revision_number),
  CONSTRAINT fk_revisions_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_revisions_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE baseline_revision_changes (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  baseline_revision_id VARCHAR(128) NOT NULL,
  product_line_id VARCHAR(128) NOT NULL,
  milestone_key VARCHAR(100) NOT NULL,
  old_duration_days INT NOT NULL,
  new_duration_days INT NOT NULL,
  old_baseline_end_date DATE NOT NULL,
  new_baseline_end_date DATE NOT NULL,
  CONSTRAINT fk_revision_changes_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_revision_changes_revision FOREIGN KEY (baseline_revision_id) REFERENCES baseline_revisions(id) ON DELETE CASCADE,
  CONSTRAINT fk_revision_changes_line FOREIGN KEY (product_line_id) REFERENCES product_lines(id)
);

CREATE TABLE product_catalog (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  product_code VARCHAR(120) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  category VARCHAR(160) NOT NULL,
  design_type VARCHAR(40) NOT NULL,
  total_lead_time_days INT NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catalog_org_code (organization_id, product_code),
  CONSTRAINT fk_catalog_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE product_catalog_materials (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  product_id VARCHAR(128) NOT NULL,
  item_code VARCHAR(120) NOT NULL,
  description VARCHAR(255) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  lead_time_days INT NOT NULL,
  is_critical_path BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_catalog_materials_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_catalog_materials_product FOREIGN KEY (product_id) REFERENCES product_catalog(id) ON DELETE CASCADE
);

CREATE TABLE category_templates (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  category_name VARCHAR(160) NOT NULL,
  design_type VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_templates_org_category_design (organization_id, category_name, design_type),
  CONSTRAINT fk_templates_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE category_template_milestones (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  template_id VARCHAR(128) NOT NULL,
  stage_order INT NOT NULL,
  milestone_key VARCHAR(100) NOT NULL,
  milestone_name VARCHAR(255) NOT NULL,
  duration_days INT NOT NULL,
  UNIQUE KEY uq_template_milestones_key (template_id, milestone_key),
  CONSTRAINT fk_template_milestones_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_template_milestones_template FOREIGN KEY (template_id) REFERENCES category_templates(id) ON DELETE CASCADE
);

CREATE TABLE rectification_actions (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NULL,
  product_line_id VARCHAR(128) NULL,
  po_number VARCHAR(80) NOT NULL,
  product_line_name VARCHAR(255) NOT NULL,
  milestone_key VARCHAR(100) NOT NULL,
  milestone_name VARCHAR(255) NOT NULL,
  action_type VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  impact_days_saved INT NOT NULL DEFAULT 0,
  suggested_by VARCHAR(160) NOT NULL,
  suggested_at TIMESTAMP NOT NULL,
  assigned_to VARCHAR(160) NOT NULL,
  status VARCHAR(40) NOT NULL,
  decision_by VARCHAR(128) NULL,
  decision_at TIMESTAMP NULL,
  decision_notes TEXT NULL,
  CONSTRAINT fk_rectifications_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_rectifications_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_rectifications_line FOREIGN KEY (product_line_id) REFERENCES product_lines(id) ON DELETE SET NULL,
  CONSTRAINT fk_rectifications_decision_user FOREIGN KEY (decision_by) REFERENCES users(id)
);

CREATE TABLE system_config (
  organization_id VARCHAR(128) PRIMARY KEY,
  at_risk_threshold_days INT NOT NULL DEFAULT 3,
  delayed_threshold_days INT NOT NULL DEFAULT 7,
  offline_sync_queue JSON NOT NULL,
  enable_push_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_system_config_organization FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE audit_logs (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NULL,
  user_id VARCHAR(128) NULL,
  po_number VARCHAR(80) NOT NULL,
  product_line VARCHAR(120) NULL,
  role VARCHAR(60) NOT NULL,
  action VARCHAR(120) NOT NULL,
  document_reference VARCHAR(160) NULL,
  details TEXT NOT NULL,
  backdate_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_org_created (organization_id, created_at),
  CONSTRAINT fk_audit_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_audit_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE subdivisions (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  milestone_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  owner_slot VARCHAR(100) NOT NULL,
  owner_user_id VARCHAR(128) NULL,
  owner_label VARCHAR(160) NULL,
  status VARCHAR(40) NOT NULL,
  target_start DATE NULL,
  target_end DATE NULL,
  actual_start DATE NULL,
  actual_end DATE NULL,
  delay_cause VARCHAR(80) NULL,
  delay_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_subdivisions_milestone (milestone_id),
  CONSTRAINT fk_subdivisions_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_subdivisions_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
  CONSTRAINT fk_subdivisions_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE po_slot_assignments (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  slot_role VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_slot_assignment (purchase_order_id, slot_role, user_id),
  CONSTRAINT fk_psa_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_psa_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_psa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE cancellation_requests (
  id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  purchase_order_id VARCHAR(128) NOT NULL,
  po_number VARCHAR(80) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  requested_by VARCHAR(160) NOT NULL,
  requested_role VARCHAR(100) NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Pending',
  decision_by VARCHAR(160) NULL,
  decision_at TIMESTAMP NULL,
  decision_notes TEXT NULL,
  action_taken VARCHAR(40) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cancellation_requests_org_status (organization_id, status),
  KEY idx_cancellation_requests_order (purchase_order_id),
  CONSTRAINT fk_cr_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_cr_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);
