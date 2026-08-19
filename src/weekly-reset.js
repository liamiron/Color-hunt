import { supabase } from './supabase.js'
import { loadAllQuestPhotos } from './state.js'
import { pickNextPrompt } from './prompts.js'
import { generateAndUploadCollage } from './collage.js'
import { showToast } from './ui.js'

const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001'
const DEV_TRIPLE_TAP_LIMIT = 2000  // ms window for triple-tap

let _devTapCount = 0
let _devTapTimer = null

// ── Sunday Midnight Timing ────────────────────────────────────

/**
 * Returns the next Sunday 00:00 UTC that falls AFTER the given date.
 * This is the scheduled reset time for any quest that started on/before that date.
 *
 * Examples:
 *   Wednesday Aug 20 → Sunday Aug 24 00:00 UTC
 *   Sunday  Aug 24 (just after midnight) → Sunday Aug 31 00:00 UTC
 *
 * @param {string|Date} startDate
 * @returns {Date}
 */
export function getNextSundayMidnight(startDate) {
  const d = new Date(startDate)
  // UTC day of week: 0 = Sunday, 1 = Mon … 6 = Sat
  const dayOfWeek = d.getUTCDay()
  // Days until the NEXT Sunday (if today is Sunday, go to next one = 7)
  const daysAhead = dayOfWeek === 0 ? 7 : (7 - dayOfWeek)
  const nextSunday = new Date(d)
  nextSunday.setUTCDate(d.getUTCDate() + daysAhead)
  nextSunday.setUTCHours(0, 0, 0, 0)
  return nextSunday
}

/**
 * Human-readable countdown to next Sunday reset.
 * @param {string|Date} startDate
 * @returns {string}  e.g. "3d 14h 22m"
 */
export function timeUntilReset(startDate) {
  const ms = getNextSundayMidnight(startDate).getTime() - Date.now()
  if (ms <= 0) return 'Resetting…'
  const totalSecs = Math.floor(ms / 1000)
  const d = Math.floor(totalSecs / 86400)
  const h = Math.floor((totalSecs % 86400) / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Reset Check ───────────────────────────────────────────────

/**
 * Called on every app load and visibility refresh.
 * Checks if the current quest's scheduled Sunday midnight has passed.
 * If so, triggers the full weekly reset flow.
 *
 * @param {object} quest  The active quest object
 * @returns {Promise<boolean>}  true if a reset was triggered
 */
export async function checkAndReset(quest) {
  if (!quest) return false

  const resetTime = getNextSundayMidnight(quest.start_date)

  if (Date.now() >= resetTime.getTime()) {
    console.log(`[weekly-reset] Reset time reached: ${resetTime.toISOString()}`)
    return await performReset(quest, resetTime)
  }

  return false
}

/**
 * Dev shortcut: triple-tap the header to force a reset (for testing).
 * @param {object}   quest
 * @param {Function} onReset  callback after reset completes
 */
export function setupDevReset(quest, onReset) {
  const headerEl = document.getElementById('prompt-text')
  if (!headerEl) return

  headerEl.addEventListener('click', () => {
    _devTapCount++
    clearTimeout(_devTapTimer)

    if (_devTapCount >= 3) {
      _devTapCount = 0
      showToast('⚙️ Dev: forcing weekly reset…')
      // Use Date.now() as the "reset time" for dev purposes
      performReset(quest, new Date()).then(onReset)
      return
    }

    _devTapTimer = setTimeout(() => { _devTapCount = 0 }, DEV_TRIPLE_TAP_LIMIT)
  })
}

// ── Reset Flow ────────────────────────────────────────────────

async function performReset(quest, resetTime) {
  console.log('[weekly-reset] Performing weekly reset for quest:', quest.id)
  showToast('Week ending — generating collage…', 6000)

  // Step 1: Race-safe quest close
  // Only the first client to win this UPDATE proceeds (is_active guard)
  const { data: updated, error: closeError } = await supabase
    .from('quests')
    .update({
      is_active:    false,
      completed_at: resetTime.toISOString(),
    })
    .eq('id', quest.id)
    .eq('is_active', true)
    .select()
    .maybeSingle()

  if (closeError) {
    console.error('[weekly-reset] closeQuest error:', closeError)
    return false
  }

  // Another client already closed it — bail out gracefully
  if (!updated) {
    console.log('[weekly-reset] Quest already closed by another client.')
    return true
  }

  // Step 2: Generate and upload collage from all group photos
  let collageUrl = null
  const allPhotos = await loadAllQuestPhotos(quest.id)

  if (allPhotos.length > 0) {
    try {
      collageUrl = await generateAndUploadCollage(
        quest.id,
        quest.prompt_name,
        quest.prompt_color,
      )
    } catch (err) {
      console.error('[weekly-reset] collage generation error:', err)
    }
  }

  // Save collage URL to the closed quest record
  if (collageUrl) {
    await supabase
      .from('quests')
      .update({ collage_url: collageUrl })
      .eq('id', quest.id)
  }

  // Step 3: Determine next prompt — avoid all previously used names
  const usedNames = await loadUsedPromptNames()
  const nextPrompt = pickNextPrompt(usedNames)

  // Step 4: Create the new quest, starting at the exact reset time (Sunday midnight)
  const { error: createError } = await supabase
    .from('quests')
    .insert({
      group_id:     DEFAULT_GROUP_ID,
      week_number:  quest.week_number + 1,
      prompt_name:  nextPrompt.name,
      prompt_color: nextPrompt.color,
      start_date:   resetTime.toISOString(),
      is_active:    true,
    })

  if (createError) {
    console.error('[weekly-reset] createQuest error:', createError)
    return false
  }

  showToast('✨ New week started! Check the archive for the collage.')
  console.log('[weekly-reset] Reset complete. New prompt:', nextPrompt.name)
  return true
}

// ── Used Prompt Tracking ──────────────────────────────────────

/**
 * Loads all prompt names that have been used in past or current quests,
 * so the next prompt selection can avoid repeats.
 * @returns {Promise<string[]>}
 */
async function loadUsedPromptNames() {
  const { data, error } = await supabase
    .from('quests')
    .select('prompt_name')
    .eq('group_id', DEFAULT_GROUP_ID)
    .order('week_number', { ascending: true })

  if (error) {
    console.error('[weekly-reset] loadUsedPromptNames error:', error)
    return []
  }

  return (data || []).map(q => q.prompt_name)
}
