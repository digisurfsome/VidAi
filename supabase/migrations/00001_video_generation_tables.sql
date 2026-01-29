-- Migration: Create video generation tables and API usage tracking
-- Description: Adds tables for storing AI-generated videos and tracking API usage
-- Author: Agent OS
-- Date: 2025-08-25

-- Create video_generations table
CREATE TABLE IF NOT EXISTS video_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model_id VARCHAR(255) NOT NULL, -- e.g., 'fal-ai/minimax-video'
  parameters JSONB DEFAULT '{}', -- Stores all generation parameters
  video_url TEXT, -- URL to generated video
  thumbnail_url TEXT, -- URL to video thumbnail
  fal_request_id VARCHAR(255), -- fal.ai's request ID for tracking
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  generation_time_ms INTEGER, -- Time taken to generate
  file_size_bytes BIGINT,
  duration_seconds FLOAT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_video_generations_user_id ON video_generations(user_id);
CREATE INDEX idx_video_generations_status ON video_generations(status);
CREATE INDEX idx_video_generations_created_at ON video_generations(created_at DESC);

-- Create api_usage_tracking table
CREATE TABLE IF NOT EXISTS api_usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_provider VARCHAR(50) NOT NULL, -- 'fal.ai', 'openai', etc.
  endpoint VARCHAR(255), -- Specific API endpoint used
  tokens_used INTEGER,
  credits_used DECIMAL(10, 4),
  request_metadata JSONB DEFAULT '{}', -- Additional request details
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for usage queries
CREATE INDEX idx_api_usage_user_provider ON api_usage_tracking(user_id, api_provider, created_at DESC);

-- Enable Row Level Security
ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for video_generations
CREATE POLICY "Users can view own video generations"
  ON video_generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own video generations"
  ON video_generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own video generations"
  ON video_generations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own video generations"
  ON video_generations FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for api_usage_tracking
CREATE POLICY "Users can view own API usage"
  ON api_usage_tracking FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can track own API usage"
  ON api_usage_tracking FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for admin and backend operations)
CREATE POLICY "Service role has full access to video_generations"
  ON video_generations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to api_usage_tracking"
  ON api_usage_tracking FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for video_generations updated_at
CREATE TRIGGER update_video_generations_updated_at
  BEFORE UPDATE ON video_generations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE video_generations IS 'Stores metadata and results of AI video generation requests';
COMMENT ON TABLE api_usage_tracking IS 'Tracks API usage across different providers for billing and analytics';
COMMENT ON COLUMN video_generations.status IS 'Generation status: pending, processing, completed, or failed';
COMMENT ON COLUMN video_generations.fal_request_id IS 'External request ID from fal.ai for tracking and debugging';
COMMENT ON COLUMN api_usage_tracking.api_provider IS 'API provider name (e.g., fal.ai, openai)';
COMMENT ON COLUMN api_usage_tracking.credits_used IS 'Credits or cost associated with the API call';