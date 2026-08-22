/**
 * Color Hunt — Group Module (Epic 5)
 *
 * Handles the "Find Your Pack" screen:
 *   - Join an existing group via short invite code (e.g. "1T530")
 *   - Create a new group with an auto-generated invite code
 *
 * On success, calls router.onGroupAssigned(profile).
 */

import { supabase } from './supabase.js'
import { onGroupAssigned, getSession } from './router.js'
import { showToast } from './ui.js'

// ── Init ──────────────────────────────────────────────────────

/**
 * Binds all group screen event listeners.
 * Called once after the DOM is ready.
 */
export function initGroup() {
  _bindJoinBtn()
  _bindCreateBtn()
  _bindBackBtn()

  // Auto-uppercase the invite code input
  const codeInput = document.getElementById('group-code-input')
  codeInput?.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase()
  })
}

// ── Join ──────────────────────────────────────────────────────

function _bindJoinBtn() {
  const joinBtn   = document.getElementById('group-join-btn')
  const codeInput = document.getElementById('group-code-input')

  joinBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase()
    if (!code) { showToast('Enter a Group ID first.'); return }

    joinBtn.disabled = true
    joinBtn.textContent = 'Joining…'

    // Look up the group by invite_code
    const { data: group, error } = await supabase
      .from('groups')
      .select('id, invite_code')
      .eq('invite_code', code)
      .maybeSingle()

    if (error || !group) {
      showToast('Group not found. Check the ID and try again.')
      joinBtn.disabled = false
      joinBtn.textContent = 'JOIN'
      return
    }

    const profile = await _assignGroup(group.id)
    if (profile) {
      onGroupAssigned(profile)
    } else {
      joinBtn.disabled = false
      joinBtn.textContent = 'JOIN'
    }
  })
}

// ── Create ────────────────────────────────────────────────────

function _bindCreateBtn() {
  const createBtn = document.getElementById('group-create-btn')

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true
    createBtn.textContent = 'Creating…'

    // 1. Generate a unique invite code
    const inviteCode = await _generateUniqueCode()

    // 2. Insert the new group
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert({ name: `Group ${inviteCode}`, invite_code: inviteCode })
      .select()
      .single()

    if (groupError || !group) {
      console.error('[group] createGroup error:', groupError)
      showToast('Could not create group. Try again.')
      createBtn.disabled = false
      createBtn.textContent = 'CREATE GROUP'
      return
    }

    // 3. Create the group's first quest using the pickNextPrompt util
    const { pickNextPrompt } = await import('./prompts.js')
    const prompt = pickNextPrompt([])
    await supabase.from('quests').insert({
      group_id:     group.id,
      week_number:  1,
      prompt_name:  prompt.name,
      prompt_color: prompt.color,
      start_date:   new Date().toISOString(),
      is_active:    true,
    })

    // 4. Assign user to the group
    const profile = await _assignGroup(group.id)
    if (profile) {
      onGroupAssigned(profile)
    } else {
      createBtn.disabled = false
      createBtn.textContent = 'CREATE GROUP'
    }
  })
}

// ── Back Button ───────────────────────────────────────────────

function _bindBackBtn() {
  document.getElementById('group-back')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    // router.onAuthStateChange will handle showing the auth screen
  })
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Assigns the authenticated user to the given group.
 * Upserts the user_profiles row and returns the updated profile.
 * @param {string} groupId
 * @returns {Promise<object|null>}
 */
async function _assignGroup(groupId) {
  const session = getSession()
  if (!session) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      { user_id: session.user.id, group_id: groupId },
      { onConflict: 'user_id' }
    )
    .select('*, groups(id, invite_code)')
    .single()

  if (error) {
    console.error('[group] assignGroup error:', error)
    showToast('Something went wrong. Try again.')
    return null
  }

  return data
}

/**
 * Generates a short random alphanumeric code (e.g. "1T530")
 * and verifies it's unique in the groups table.
 * Retries up to 10 times.
 * @returns {Promise<string>}
 */
async function _generateUniqueCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // no O/0, I/1 ambiguity
  const LENGTH = 5

  for (let attempt = 0; attempt < 10; attempt++) {
    let code = ''
    for (let i = 0; i < LENGTH; i++) {
      code += CHARS[Math.floor(Math.random() * CHARS.length)]
    }

    const { data } = await supabase
      .from('groups')
      .select('id')
      .eq('invite_code', code)
      .maybeSingle()

    if (!data) return code  // unique!
  }

  // Fallback: timestamp-based code
  return Date.now().toString(36).toUpperCase().slice(-5)
}
