-- =====================================================
-- Deterministic Enforcement — State Machines + Integrity
-- Migration: 00012_deterministic_enforcement.sql
-- Date: 2026-03-22
--
-- Adds:
--   1. Build status state machine trigger (rejects illegal transitions)
--   2. Deployment status state machine trigger
--   3. Sequence column on build_events for guaranteed ordering
--   4. Unique partial index preventing duplicate active deployments
--   5. Test count validation on build_deliveries
--   6. Phase regression prevention on build_jobs
-- =====================================================

-- =========================
-- 1. BUILD STATUS STATE MACHINE (Database-level enforcement)
-- =========================

CREATE OR REPLACE FUNCTION validate_build_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Only validate on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Define valid transitions
  CASE OLD.status
    WHEN 'queued' THEN
      IF NEW.status NOT IN ('building', 'cancelled', 'failed') THEN
        RAISE EXCEPTION 'Illegal build status transition: % → %. Allowed from queued: building, cancelled, failed', OLD.status, NEW.status;
      END IF;
    WHEN 'building' THEN
      IF NEW.status NOT IN ('testing', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Illegal build status transition: % → %. Allowed from building: testing, failed, cancelled', OLD.status, NEW.status;
      END IF;
    WHEN 'testing' THEN
      IF NEW.status NOT IN ('deploying', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Illegal build status transition: % → %. Allowed from testing: deploying, failed, cancelled', OLD.status, NEW.status;
      END IF;
    WHEN 'deploying' THEN
      IF NEW.status NOT IN ('complete', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Illegal build status transition: % → %. Allowed from deploying: complete, failed, cancelled', OLD.status, NEW.status;
      END IF;
    WHEN 'complete' THEN
      -- Terminal state — no transitions allowed
      RAISE EXCEPTION 'Illegal build status transition: complete is a terminal state. No transitions allowed.';
    WHEN 'failed' THEN
      IF NEW.status NOT IN ('building') THEN
        RAISE EXCEPTION 'Illegal build status transition: % → %. Allowed from failed: building (retry only)', OLD.status, NEW.status;
      END IF;
    WHEN 'cancelled' THEN
      -- Terminal state — no transitions allowed
      RAISE EXCEPTION 'Illegal build status transition: cancelled is a terminal state. No transitions allowed.';
    ELSE
      RAISE EXCEPTION 'Unknown build status: %', OLD.status;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_build_status_machine') THEN
    CREATE TRIGGER enforce_build_status_machine
      BEFORE UPDATE ON build_jobs
      FOR EACH ROW
      WHEN (OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION validate_build_status_transition();
  END IF;
END $$;

-- =========================
-- 2. DEPLOYMENT STATUS STATE MACHINE
-- =========================

CREATE OR REPLACE FUNCTION validate_deploy_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  CASE OLD.status
    WHEN 'pending' THEN
      IF NEW.status NOT IN ('creating_repo', 'failed', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'creating_repo' THEN
      IF NEW.status NOT IN ('pushing_code', 'failed', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'pushing_code' THEN
      IF NEW.status NOT IN ('deploying', 'failed', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'deploying' THEN
      IF NEW.status NOT IN ('live', 'failed', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'live' THEN
      IF NEW.status NOT IN ('rolled_back', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'failed' THEN
      IF NEW.status NOT IN ('pending', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'rolled_back' THEN
      IF NEW.status NOT IN ('pending', 'deleted') THEN
        RAISE EXCEPTION 'Illegal deployment transition: % → %', OLD.status, NEW.status;
      END IF;
    WHEN 'deleted' THEN
      RAISE EXCEPTION 'Illegal deployment transition: deleted is a terminal state';
    ELSE
      RAISE EXCEPTION 'Unknown deployment status: %', OLD.status;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_deploy_status_machine') THEN
    CREATE TRIGGER enforce_deploy_status_machine
      BEFORE UPDATE ON app_deployments
      FOR EACH ROW
      WHEN (OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION validate_deploy_status_transition();
  END IF;
END $$;

-- =========================
-- 3. SEQUENCE COLUMN ON BUILD EVENTS
-- =========================

-- Add sequence column for deterministic ordering
ALTER TABLE build_events
  ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 0;

-- Auto-increment sequence per build_job_id
CREATE OR REPLACE FUNCTION set_build_event_sequence()
RETURNS TRIGGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO next_seq
  FROM build_events
  WHERE build_job_id = NEW.build_job_id;

  NEW.sequence = next_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'auto_sequence_build_events') THEN
    CREATE TRIGGER auto_sequence_build_events
      BEFORE INSERT ON build_events
      FOR EACH ROW
      EXECUTE FUNCTION set_build_event_sequence();
  END IF;
END $$;

-- Index for sequence-based queries
CREATE INDEX IF NOT EXISTS idx_build_events_sequence
  ON build_events(build_job_id, sequence);

-- =========================
-- 4. UNIQUE PARTIAL INDEX: Prevent duplicate active deployments
-- =========================

-- Only one active deployment per build at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_deploy_per_build
  ON app_deployments(build_job_id)
  WHERE status IN ('pending', 'creating_repo', 'pushing_code', 'deploying', 'live');

-- =========================
-- 5. TEST COUNT VALIDATION ON DELIVERIES
-- =========================

ALTER TABLE build_deliveries
  ADD CONSTRAINT check_tests_passed_lte_total
  CHECK (tests_passed <= tests_total);

ALTER TABLE build_deliveries
  ADD CONSTRAINT check_visual_qa_range
  CHECK (visual_qa_score IS NULL OR (visual_qa_score >= 0 AND visual_qa_score <= 100));

-- Manifest hash is required for all deliveries
ALTER TABLE build_deliveries
  ALTER COLUMN manifest_hash SET NOT NULL;

-- =========================
-- 6. PHASE REGRESSION PREVENTION
-- =========================

CREATE OR REPLACE FUNCTION prevent_phase_regression()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow phase reset only on retry (failed → building)
  IF OLD.status = 'failed' AND NEW.status = 'building' THEN
    RETURN NEW;
  END IF;

  -- Prevent phase from going backward during active build
  IF NEW.current_phase < OLD.current_phase AND NEW.status NOT IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'Phase regression not allowed: % → %. Phases must move forward.',
      OLD.current_phase, NEW.current_phase;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_phase_progression') THEN
    CREATE TRIGGER enforce_phase_progression
      BEFORE UPDATE ON build_jobs
      FOR EACH ROW
      WHEN (OLD.current_phase IS DISTINCT FROM NEW.current_phase)
      EXECUTE FUNCTION prevent_phase_regression();
  END IF;
END $$;

-- =========================
-- 7. ANALYTICS INPUT VALIDATION
-- =========================

ALTER TABLE build_analytics
  ADD CONSTRAINT check_analytics_durations_positive
  CHECK (
    (total_duration_ms IS NULL OR total_duration_ms >= 0) AND
    (phase_1_duration_ms IS NULL OR phase_1_duration_ms >= 0) AND
    (phase_2_duration_ms IS NULL OR phase_2_duration_ms >= 0) AND
    (phase_3_duration_ms IS NULL OR phase_3_duration_ms >= 0) AND
    (phase_4_duration_ms IS NULL OR phase_4_duration_ms >= 0) AND
    (queue_wait_ms IS NULL OR queue_wait_ms >= 0)
  );

ALTER TABLE build_analytics
  ADD CONSTRAINT check_analytics_test_counts
  CHECK (
    phase_2_tests_passed IS NULL OR phase_2_test_count IS NULL OR
    phase_2_tests_passed <= phase_2_test_count
  );

ALTER TABLE build_analytics
  ADD CONSTRAINT check_analytics_interactions
  CHECK (
    phase_3_interactions_passed IS NULL OR phase_3_interactions_tested IS NULL OR
    phase_3_interactions_passed <= phase_3_interactions_tested
  );
