-- ============================================================
-- 061_n8n_workspace_upgrade.sql
-- n8n Workspace integration: instance URL, editor embed URL, and workflow event mappings
-- ============================================================

ALTER TABLE n8n_integrations
  ADD COLUMN IF NOT EXISTS instance_url text,
  ADD COLUMN IF NOT EXISTS editor_url text,
  ADD COLUMN IF NOT EXISTS api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS auth_header_name text DEFAULT 'X-N8N-API-KEY',
  ADD COLUMN IF NOT EXISTS auth_header_value_encrypted text,
  ADD COLUMN IF NOT EXISTS workflow_mappings jsonb NOT NULL DEFAULT '{}'::jsonb;
