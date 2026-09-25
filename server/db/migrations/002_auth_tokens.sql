-- ============================================================
-- Migration 002: add auth_tokens (email verification + password reset)
--
--   psql -U postgres -d secureenroll -f migrations/002_auth_tokens.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('email_verify','password_reset')),
    token_hash  CHAR(64)    NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens (user_id, purpose);
