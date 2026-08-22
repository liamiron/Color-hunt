/**
 * Color Hunt — Auth Module (Epic 4)
 *
 * Handles social authentication:
 *   1. Google OAuth
 *   2. Facebook OAuth
 *
 * On success, calls router.onAuthSuccess(session).
 */

import { supabase } from './supabase.js'

// ── Init ──────────────────────────────────────────────────────

/**
 * Binds all auth screen event listeners.
 * Called once after the DOM is ready.
 */
export function initAuth() {
  _bindSocialButtons()
}

// ── Social buttons ────────────────────────────────────────────

function _bindSocialButtons() {
  document.getElementById('auth-google')?.addEventListener('click', () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  })

  document.getElementById('auth-facebook')?.addEventListener('click', () => {
    supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: window.location.origin },
    })
  })
}
