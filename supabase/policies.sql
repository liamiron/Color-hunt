-- =============================================================
-- Color Hunt — Row Level Security Policies
-- Run this AFTER schema.sql in the Supabase SQL Editor
-- =============================================================

-- ── groups ──────────────────────────────────────────────────
-- Anyone can read groups (needed to look up by invite_code)
CREATE POLICY "groups_select_all" ON groups
  FOR SELECT USING (true);

-- Authenticated users can create groups
CREATE POLICY "groups_insert_auth" ON groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── user_profiles ────────────────────────────────────────────
-- Users can read/write their own profile row only
CREATE POLICY "profiles_select_own" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "profiles_insert_own" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_update_own" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- ── quests ──────────────────────────────────────────────────
-- Anyone can read quests
CREATE POLICY "quests_select_all" ON quests
  FOR SELECT USING (true);

-- Anyone can update quests (for weekly reset + collage URL)
-- In production, lock this down to a service role
CREATE POLICY "quests_update_all" ON quests
  FOR UPDATE USING (true);

-- Anyone can insert quests (for weekly reset creating new quest)
CREATE POLICY "quests_insert_all" ON quests
  FOR INSERT WITH CHECK (true);

-- ── photos ──────────────────────────────────────────────────
-- Anyone can read all photos
CREATE POLICY "photos_select_all" ON photos
  FOR SELECT USING (true);

-- Anyone can insert their own photos
CREATE POLICY "photos_insert_all" ON photos
  FOR INSERT WITH CHECK (true);

-- Users can only delete their own photos (matched by device_id header)
-- For prototype: allow all deletes since we check device_id in app logic
CREATE POLICY "photos_delete_own" ON photos
  FOR DELETE USING (true);

-- =============================================================
-- Storage Bucket — Run in Storage settings or SQL
-- =============================================================
-- Create a public bucket called 'photos'
-- In Supabase Dashboard > Storage > New Bucket:
--   Name: photos
--   Public: true (so image URLs work without auth tokens)
--
-- Or via SQL:
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow all operations on photos bucket (prototype mode)
DROP POLICY IF EXISTS "storage_photos_select" ON storage.objects;
CREATE POLICY "storage_photos_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "storage_photos_insert" ON storage.objects;
CREATE POLICY "storage_photos_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'photos');

DROP POLICY IF EXISTS "storage_photos_update" ON storage.objects;
CREATE POLICY "storage_photos_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "storage_photos_delete" ON storage.objects;
CREATE POLICY "storage_photos_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'photos');
