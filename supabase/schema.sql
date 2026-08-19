-- =============================================================
-- Color Hunt — Database Schema
-- Run this in the Supabase SQL Editor
-- =============================================================

-- Groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Default Group',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Weekly quests (one active per group at a time)
CREATE TABLE IF NOT EXISTS quests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  week_number INT NOT NULL,
  prompt_name TEXT NOT NULL,
  prompt_color TEXT NOT NULL DEFAULT '#C8E600',
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  collage_url TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Photos — each user has their own 9 slots per quest
CREATE TABLE IF NOT EXISTS photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quest_id UUID REFERENCES quests(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  slot_index INT NOT NULL CHECK (slot_index >= 0 AND slot_index <= 8),
  storage_path TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Each user can only have one photo per slot per quest
  UNIQUE(quest_id, device_id, slot_index)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_quests_group_active ON quests(group_id, is_active);
CREATE INDEX IF NOT EXISTS idx_photos_quest_device ON photos(quest_id, device_id);
CREATE INDEX IF NOT EXISTS idx_photos_quest ON photos(quest_id);

-- Enable Row Level Security
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- Seed Data — default group + first quest
-- =============================================================
INSERT INTO groups (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Group')
ON CONFLICT (id) DO NOTHING;

INSERT INTO quests (group_id, week_number, prompt_name, prompt_color)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  1,
  'LEMON YELLOW',
  '#C8E600'
)
ON CONFLICT DO NOTHING;
