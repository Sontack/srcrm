-- ============================================================
-- 060_advanced_features_upgrade.sql
-- Advanced features: n8n integration, template source tracking,
-- AI knowledge categorization, and conversation handling modes.
-- ============================================================

-- 1. n8n Integrations
CREATE TABLE IF NOT EXISTS n8n_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  webhook_url text,
  api_key text,
  auth_header text DEFAULT 'X-N8N-API-KEY',
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'disconnected',
  last_tested_at timestamptz,
  last_error text,
  events text[] NOT NULL DEFAULT ARRAY['message.received', 'contact.created', 'broadcast.completed'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_n8n_integrations_account ON n8n_integrations(account_id);

ALTER TABLE n8n_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "n8n_integrations_select" ON n8n_integrations;
CREATE POLICY "n8n_integrations_select" ON n8n_integrations FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "n8n_integrations_modify" ON n8n_integrations;
CREATE POLICY "n8n_integrations_modify" ON n8n_integrations FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- 2. Message templates: support n8n and custom templates
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS n8n_template_id text;

-- 3. AI Knowledge documents: category and metadata for Excel/CSV knowledge
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_category ON ai_knowledge_documents(account_id, category);

-- 4. Conversations handling mode (AI vs Human)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handling_mode text NOT NULL DEFAULT 'ai';
