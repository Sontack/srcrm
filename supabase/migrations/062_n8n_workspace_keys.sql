-- ============================================================
-- 062_n8n_workspace_keys.sql
-- Ensure encrypted api key and auth header columns exist
-- ============================================================

ALTER TABLE n8n_integrations
  ADD COLUMN IF NOT EXISTS api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS auth_header_name text DEFAULT 'X-N8N-API-KEY',
  ADD COLUMN IF NOT EXISTS auth_header_value_encrypted text;
