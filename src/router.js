/**
 * Color Hunt — Screen Router
 *
 * Manages all top-level screens:
 *   - screen-auth      (login)
 *   - screen-group     (find your pack)
 *   - screen-main      (the existing app experience)
 *   - screen-admin     (admin panel — admin only)
 *   - screen-hunt-over (shown when a group is closed)
 *
 * Boot sequence:
 *   1. Check Supabase session
 *   2. If no session → show auth
 *   3. If session but no group → show group picker
 *   4. If session + group → show main screen
 */

import { supabase } from './supabase.js'
import { ensureUserProfile } from './state.js'

const SCREENS = ['screen-auth', 'screen-group', 'screen-main', 'screen-admin', 'screen-hunt-over']

let _session      = null
let _userProfile  = null
let _onMainReady  = null  // callback set by main.js

// ── Public API ────────────────────────────────────────────────

/**
 * Initialises the router. Call once on app boot (from main.js).
 * @param {Function} onMainReady  callback to run when the main screen is shown
 */
export async function initRouter(onMainReady) {
  _onMainReady = onMainReady

  // Supabase handles OAuth redirects automatically on page load
  const { data } = await supabase.auth.getSession()
  _session = data.session

  if (_session) {
    await _afterAuth(_session)
  } else {
    showScreen('auth')
  }

  // Listen for sign-in / sign-out events
  supabase.auth.onAuthStateChange(async (_event, session) => {
    _session = session
    if (!session) {
      _userProfile = null
      showScreen('auth')
    }
  })
}

/**
 * Shows one screen and hides all others.
 * @param {'auth'|'group'|'main'|'admin'|'hunt-over'} name
 */
export function showScreen(name) {
  SCREENS.forEach(id => {
    const el = document.getElementById(id)
    if (el) el.hidden = (id !== `screen-${name}`)
  })
}

/** Returns the active Supabase session (may be null). */
export function getSession() { return _session }

/** Returns the user's profile row from user_profiles (may be null). */
export function getUserProfileCached() { return _userProfile }

/** Returns true if the current user has admin privileges. */
export function isAdmin() { return _userProfile?.is_admin === true }

/**
 * Refreshes the cached profile from DB (e.g. after admin action changes group_id).
 */
export async function refreshUserProfile() {
  if (!_session) return null
  _userProfile = await ensureUserProfile(_session.user.id)
  return _userProfile
}

/**
 * Called by auth.js after a successful sign-in.
 * @param {object} session
 */
export async function onAuthSuccess(session) {
  _session = session
  await _afterAuth(session)
}

/**
 * Called by group.js after the user has been assigned to a group.
 * @param {object} profile  updated user_profiles row
 */
export function onGroupAssigned(profile) {
  _userProfile = profile
  showScreen('main')
  if (_onMainReady) _onMainReady()
}

// ── Internal ──────────────────────────────────────────────────

async function _afterAuth(session) {
  _userProfile = await ensureUserProfile(session.user.id)

  if (!_userProfile?.group_id) {
    showScreen('group')
  } else {
    showScreen('main')
    if (_onMainReady) _onMainReady()
  }
}
