-- ============================================================
-- 063_ai_multiple_keys_and_failover.sql
-- Multiple AI API Keys, Key Visibility, and Automatic Failover
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT 'Primary API Key',
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'openai_compatible')),
  model text NOT NULL,
  base_url text,
  api_key text NOT NULL, -- AES-256-GCM encrypted
  key_hint text NOT NULL DEFAULT '••••••••',
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'backup', 'rate_limited', 'invalid', 'disabled')),
  rate_limited_until timestamptz,
  last_used_at timestamptz,
  last_tested_at timestamptz,
  last_error text,
  total_requests integer NOT NULL DEFAULT 0,
  successful_requests integer NOT NULL DEFAULT 0,
  failed_requests integer NOT NULL DEFAULT 0,
  rate_limit_errors integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_keys_account_priority ON ai_keys (account_id, is_active, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_keys_account_primary ON ai_keys (account_id, is_primary);

ALTER TABLE ai_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_keys_select" ON ai_keys;
CREATE POLICY "ai_keys_select" ON ai_keys
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "ai_keys_modify" ON ai_keys;
CREATE POLICY "ai_keys_modify" ON ai_keys
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Migrate existing ai_configs key into ai_keys if not already present
INSERT INTO ai_keys (
  account_id,
  created_by,
  label,
  provider,
  model,
  base_url,
  api_key,
  key_hint,
  is_primary,
  is_active,
  status,
  priority
)
SELECT
  account_id,
  created_by,
  'Primary API Key',
  provider,
  model,
  base_url,
  api_key,
  '••••••••',
  true,
  true,
  'active',
  0
FROM ai_configs
WHERE api_key IS NOT NULL AND btrim(api_key) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM ai_keys WHERE ai_keys.account_id = ai_configs.account_id
  );
