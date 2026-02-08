-- Jobs table
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB,
  context JSONB,
  research JSONB,
  brief JSONB,
  draft JSONB,
  polished_draft JSONB,
  review JSONB,
  output JSONB,
  iteration INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

-- Client profiles
CREATE TABLE client_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  description TEXT,
  goals JSONB,
  platforms JSONB,
  contacts JSONB,
  preferences JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Brand voices
CREATE TABLE brand_voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT REFERENCES client_profiles(id),
  tone TEXT,
  avoid JSONB,
  examples JSONB,
  vocabulary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content feedback
CREATE TABLE content_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT REFERENCES client_profiles(id),
  content_id TEXT,
  liked BOOLEAN,
  comments TEXT,
  tags JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
