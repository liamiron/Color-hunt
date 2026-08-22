import { supabase } from './supabase.js'

const DEVICE_ID_KEY = 'ch_device_id'

// ── Device Identity (legacy — kept for prototype photo paths) ─

/**
 * Returns a stable device UUID from localStorage.
 * Creates one on first visit.
 * @returns {string}
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    // crypto.randomUUID() requires a secure context (HTTPS / localhost).
    // When accessed over LAN IP on mobile (plain HTTP), fall back to a
    // Math.random()-based UUID v4 that works in any context.
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0
          const v = c === 'x' ? r : (r & 0x3 | 0x8)
          return v.toString(16)
        })
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

// ── User Profile ──────────────────────────────────────────────

/**
 * Fetches the user's profile (including joined group info).
 * Returns null if no profile row exists yet.
 * @param {string} userId  — from auth.uid()
 * @returns {Promise<object|null>}
 */
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*, groups(id, invite_code, name)')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[state] getUserProfile error:', error)
    return null
  }
  return data
}

/**
 * Ensures a user_profiles row exists for this user.
 * Creates one (with no group) if missing.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function ensureUserProfile(userId) {
  // Try fetching first
  let profile = await getUserProfile(userId)
  if (profile) return profile

  // Create a blank profile
  const { data, error } = await supabase
    .from('user_profiles')
    .insert({ user_id: userId })
    .select('*, groups(id, invite_code, name)')
    .single()

  if (error) {
    console.error('[state] ensureUserProfile error:', error)
    return null
  }
  return data
}

// ── Data Loading ──────────────────────────────────────────────

/**
 * Loads the currently active quest for the given group.
 * @param {string} groupId
 * @returns {Promise<object|null>}
 */
export async function loadActiveQuest(groupId) {
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[state] loadActiveQuest error:', error)
    return null
  }
  return data
}

/**
 * Loads only the current user's photos for a given quest.
 * @param {string} questId
 * @param {string} deviceId
 * @returns {Promise<object[]>}
 */
export async function loadMyPhotos(questId, deviceId) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('quest_id', questId)
    .eq('device_id', deviceId)
    .order('slot_index')

  if (error) {
    console.error('[state] loadMyPhotos error:', error)
    return []
  }
  return data || []
}

/**
 * Loads ALL photos for a quest (from all users).
 * Used for collage generation at end of week.
 * @param {string} questId
 * @returns {Promise<object[]>}
 */
export async function loadAllQuestPhotos(questId) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('quest_id', questId)

  if (error) {
    console.error('[state] loadAllQuestPhotos error:', error)
    return []
  }
  return data || []
}

/**
 * Loads all completed quests for the archive, newest first.
 * @param {string} groupId
 * @returns {Promise<object[]>}
 */
export async function loadArchive(groupId) {
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_active', false)
    .order('week_number', { ascending: false })

  if (error) {
    console.error('[state] loadArchive error:', error)
    return []
  }
  return data || []
}

/**
 * Sets up a listener that re-fetches data when the user
 * returns to the tab (replaces Supabase Realtime to stay free-tier safe).
 * @param {() => Promise<void>} refreshFn
 */
export function setupVisibilityRefresh(refreshFn) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshFn()
    }
  })
}
