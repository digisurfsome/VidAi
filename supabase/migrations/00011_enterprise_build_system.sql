-- =====================================================
-- Enterprise Build System — Core Tables
-- Migration: 00011_enterprise_build_system.sql
-- Date: 2026-03-22
--
-- Creates tables for:
--   1. build_jobs — Build tracking with idempotency
--   2. build_events — Real-time progress events
--   3. app_secrets — Per-app encrypted secret vault
--   4. build_deliveries — Delivery receipts
--   5. app_deployments — Deployment tracking
--   6. build_analytics — Build metrics
-- =====================================================

-- =========================
-- 1. BUILD JOBS
-- =========================
CREATE TABLE IF NOT EXISTS build_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name VARCHAR(255),
  app_description TEXT,
  spec JSONB,                          -- The full app spec/PRD
  status VARCHAR(50) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'building', 'testing', 'deploying', 'complete', 'failed', 'cancelled')),
  current_phase INTEGER DEFAULT 0,
  current_phase_name VARCHAR(100),
  phases_completed JSONB DEFAULT '[]'::jsonb,
  progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  error_context JSONB,                 -- Cumulative error context for retries
  retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 3),
  max_retries INTEGER DEFAULT 3,
  priority VARCHAR(20) DEFAULT 'standard' CHECK (priority IN ('low', 'standard', 'high', 'critical')),
  complexity_tier VARCHAR(20) CHECK (complexity_tier IN ('simple', 'standard', 'complex', 'enterprise')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_build_jobs_user_id ON build_jobs(user_id);
CREATE INDEX idx_build_jobs_status ON build_jobs(status);
CREATE INDEX idx_build_jobs_idempotency ON build_jobs(idempotency_key);
CREATE INDEX idx_build_jobs_created_at ON build_jobs(created_at DESC);

-- =========================
-- 2. BUILD EVENTS (Real-time progress)
-- =========================
CREATE TABLE IF NOT EXISTS build_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_job_id UUID NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL
    CHECK (event_type IN (
      'phase_start', 'phase_complete', 'phase_failed',
      'test_start', 'test_pass', 'test_fail',
      'screenshot_captured', 'video_captured',
      'build_complete', 'build_failed',
      'retry_start', 'retry_complete',
      'deploy_start', 'deploy_progress', 'deploy_complete', 'deploy_failed',
      'info', 'warning', 'error'
    )),
  phase INTEGER,
  phase_name VARCHAR(100),
  message TEXT,
  data JSONB,                          -- Flexible payload per event type
  screenshot_url TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_build_events_job_id ON build_events(build_job_id);
CREATE INDEX idx_build_events_type ON build_events(event_type);
CREATE INDEX idx_build_events_created ON build_events(created_at);

-- =========================
-- 3. APP SECRETS (Per-app encrypted vault)
-- =========================
CREATE TABLE IF NOT EXISTS app_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,                -- References build_jobs(id) or a standalone app
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_name VARCHAR(255) NOT NULL,
  encrypted_value TEXT NOT NULL,        -- AES-256-GCM encrypted
  iv TEXT NOT NULL,                     -- Initialization vector
  tag TEXT NOT NULL,                    -- Auth tag for GCM
  key_type VARCHAR(50) DEFAULT 'env'
    CHECK (key_type IN ('env', 'api_key', 'oauth', 'webhook', 'custom')),
  description TEXT,
  is_required BOOLEAN DEFAULT FALSE,
  last_rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, key_name)
);

CREATE INDEX idx_app_secrets_app_id ON app_secrets(app_id);
CREATE INDEX idx_app_secrets_user_id ON app_secrets(user_id);

-- =========================
-- 4. BUILD DELIVERIES (Receipts)
-- =========================
CREATE TABLE IF NOT EXISTS build_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_job_id UUID NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_name VARCHAR(255) NOT NULL,

  -- What was built
  tech_stack JSONB NOT NULL,           -- ["React", "TypeScript", "Supabase", "Stripe"]
  routes JSONB,                        -- {public: [...], authenticated: [...], admin: [...]}
  files_delivered INTEGER NOT NULL DEFAULT 0,
  features_included JSONB,             -- ["Authentication", "Payments", "Admin Dashboard"]

  -- Quality metrics
  tests_passed INTEGER NOT NULL DEFAULT 0,
  tests_total INTEGER NOT NULL DEFAULT 0,
  visual_qa_score INTEGER CHECK (visual_qa_score >= 0 AND visual_qa_score <= 100),
  phase_results JSONB,                 -- Detailed results per phase

  -- Integrity link
  manifest_hash VARCHAR(255),          -- SHA-256 of the full codebase
  manifest_data JSONB,                 -- Per-file hashes

  -- Artifacts
  receipt_pdf_url TEXT,
  screenshots JSONB,                   -- Array of screenshot URLs
  test_report_url TEXT,
  session_video_url TEXT,

  -- Delivery metadata
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  download_url TEXT,
  download_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_build_deliveries_build_job ON build_deliveries(build_job_id);
CREATE INDEX idx_build_deliveries_user_id ON build_deliveries(user_id);

-- =========================
-- 5. APP DEPLOYMENTS
-- =========================
CREATE TABLE IF NOT EXISTS app_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_job_id UUID NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Provider info
  provider VARCHAR(50) NOT NULL DEFAULT 'vercel'
    CHECK (provider IN ('vercel', 'netlify', 'railway', 'manual')),
  provider_project_id VARCHAR(255),
  provider_deployment_id VARCHAR(255),

  -- URLs
  deployment_url TEXT,
  custom_domain TEXT,
  github_repo_url TEXT,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'creating_repo', 'pushing_code', 'deploying', 'live', 'failed', 'rolled_back', 'deleted')),
  status_message TEXT,

  -- Configuration
  environment_vars_injected BOOLEAN DEFAULT FALSE,
  framework_preset VARCHAR(50) DEFAULT 'vite',
  build_command VARCHAR(255) DEFAULT 'npm run build',
  output_directory VARCHAR(255) DEFAULT 'dist',

  -- Timestamps
  deployed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_app_deployments_build_job ON app_deployments(build_job_id);
CREATE INDEX idx_app_deployments_user_id ON app_deployments(user_id);
CREATE INDEX idx_app_deployments_status ON app_deployments(status);

-- =========================
-- 6. BUILD ANALYTICS
-- =========================
CREATE TABLE IF NOT EXISTS build_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_job_id UUID NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,

  -- Timing
  total_duration_ms INTEGER,
  phase_1_duration_ms INTEGER,         -- Build validation
  phase_2_duration_ms INTEGER,         -- Playwright tests
  phase_3_duration_ms INTEGER,         -- Computer Use QA
  phase_4_duration_ms INTEGER,         -- Deployment
  queue_wait_ms INTEGER,               -- Time spent waiting in queue

  -- Phase 1 results
  phase_1_passed BOOLEAN,
  npm_install_ms INTEGER,
  typecheck_ms INTEGER,
  lint_ms INTEGER,
  build_ms INTEGER,

  -- Phase 2 results
  phase_2_test_count INTEGER,
  phase_2_tests_passed INTEGER,
  phase_2_console_errors INTEGER DEFAULT 0,
  phase_2_uncaught_exceptions INTEGER DEFAULT 0,

  -- Phase 3 results
  phase_3_visual_score INTEGER CHECK (phase_3_visual_score >= 0 AND phase_3_visual_score <= 100),
  phase_3_interactions_tested INTEGER,
  phase_3_interactions_passed INTEGER,
  phase_3_pages_tested INTEGER,

  -- Build metadata
  retry_count INTEGER DEFAULT 0,
  final_attempt INTEGER DEFAULT 1,
  failure_phase INTEGER,
  failure_reason TEXT,

  -- App metadata
  app_complexity_tier VARCHAR(20),
  routes_count INTEGER,
  components_count INTEGER,
  total_lines_of_code INTEGER,

  -- Deployment metrics
  deployment_duration_ms INTEGER,
  deployment_succeeded BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_build_analytics_job ON build_analytics(build_job_id);
CREATE INDEX idx_build_analytics_created ON build_analytics(created_at DESC);

-- =========================
-- TRIGGERS: Auto-update updated_at
-- =========================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create triggers if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_build_jobs_updated_at') THEN
    CREATE TRIGGER set_build_jobs_updated_at
      BEFORE UPDATE ON build_jobs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_app_secrets_updated_at') THEN
    CREATE TRIGGER set_app_secrets_updated_at
      BEFORE UPDATE ON app_secrets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_app_deployments_updated_at') THEN
    CREATE TRIGGER set_app_deployments_updated_at
      BEFORE UPDATE ON app_deployments
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =========================
-- RLS POLICIES
-- =========================

-- Enable RLS on all tables
ALTER TABLE build_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_analytics ENABLE ROW LEVEL SECURITY;

-- build_jobs: Users can view their own builds
CREATE POLICY build_jobs_select_own ON build_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY build_jobs_insert_own ON build_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- build_events: Users can view events for their builds
CREATE POLICY build_events_select_own ON build_events
  FOR SELECT USING (
    build_job_id IN (SELECT id FROM build_jobs WHERE user_id = auth.uid())
  );

-- app_secrets: Users can manage their own app secrets
CREATE POLICY app_secrets_select_own ON app_secrets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY app_secrets_insert_own ON app_secrets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY app_secrets_update_own ON app_secrets
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY app_secrets_delete_own ON app_secrets
  FOR DELETE USING (auth.uid() = user_id);

-- build_deliveries: Users can view their own deliveries
CREATE POLICY build_deliveries_select_own ON build_deliveries
  FOR SELECT USING (auth.uid() = user_id);

-- app_deployments: Users can view their own deployments
CREATE POLICY app_deployments_select_own ON app_deployments
  FOR SELECT USING (auth.uid() = user_id);

-- build_analytics: Users can view analytics for their own builds
CREATE POLICY build_analytics_select_own ON build_analytics
  FOR SELECT USING (
    build_job_id IN (SELECT id FROM build_jobs WHERE user_id = auth.uid())
  );

-- =========================
-- SERVICE ROLE PERMISSIONS
-- =========================
-- Service role needs full access for API endpoints
GRANT ALL PRIVILEGES ON TABLE build_jobs TO service_role;
GRANT ALL PRIVILEGES ON TABLE build_events TO service_role;
GRANT ALL PRIVILEGES ON TABLE app_secrets TO service_role;
GRANT ALL PRIVILEGES ON TABLE build_deliveries TO service_role;
GRANT ALL PRIVILEGES ON TABLE app_deployments TO service_role;
GRANT ALL PRIVILEGES ON TABLE build_analytics TO service_role;

-- Authenticated users need basic access (RLS handles row-level)
GRANT SELECT, INSERT ON TABLE build_jobs TO authenticated;
GRANT SELECT ON TABLE build_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_secrets TO authenticated;
GRANT SELECT ON TABLE build_deliveries TO authenticated;
GRANT SELECT ON TABLE app_deployments TO authenticated;
GRANT SELECT ON TABLE build_analytics TO authenticated;
