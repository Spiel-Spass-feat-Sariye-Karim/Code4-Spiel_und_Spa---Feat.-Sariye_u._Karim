-- ════════════════════════════════════════════════
-- Schritt 1: E-Mail-Spalte zu users hinzufügen
-- ════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- ════════════════════════════════════════════════
-- Schritt 2: Reset-Token Tabelle erstellen
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prt_user  ON password_reset_tokens(user_id);
