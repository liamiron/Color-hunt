import { supabase } from './supabase.js'
import { loadAllQuestPhotos } from './state.js'
import { pickNextPrompt } from './prompts.js'
import { generateAndUploadCollage } from './collage.js'
import { showToast } from './ui.js'

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
    return await performReset(quest, resetTime, quest.group_id)
  }

  return false
}

// ── Reset Flow ────────────────────────────────────────────────

/**
 * Admin: Force-end the current week for a given group immediately.
 * Loads the active quest, then performs the full reset flow.
 * @param {string} groupId
 * @returns {Promise<boolean>}
 */
export async function endWeekForGroup(groupId) {
  const { data: quest, error } = await supabase
    .from('quests')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[weekly-reset] endWeekForGroup: DB error fetching active quest', error)
    return false
  }

  if (!quest) {
    // No active quest — the group may be in a stuck state where the previous
    // week's quest was closed but the new one was never created. Attempt recovery.
    console.warn('[weekly-reset] endWeekForGroup: no active quest — attempting recovery for group', groupId)
    return await recoverMissingQuest(groupId)
  }

  return await performReset(quest, new Date(), groupId)
}

/**
 * Recovery: called when there is NO active quest for a group (stuck state).
 * Finds the most recently closed quest, generates its collage if missing,
 * then creates the next quest.
 *
 * This safely handles the case where a reset partially failed:
 *   - Old quest IS closed (is_active = false)
 *   - New quest was NEVER created
 *
 * Safe to call even if called multiple times — the insert uses is_active guard
 * and the second caller will find an active quest already exists.
 *
 * @param {string} groupId
 * @returns {Promise<boolean>}
 */
export async function recoverMissingQuest(groupId) {
  console.log('[weekly-reset] recoverMissingQuest: starting recovery for group', groupId)

  // Find the most recent closed quest — that's the one that needs a successor
  const { data: lastQuest, error: lastErr } = await supabase
    .from('quests')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_active', false)
    .order('week_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastErr || !lastQuest) {
    console.error('[weekly-reset] recoverMissingQuest: no closed quest found for group', groupId, lastErr)
    return false
  }

  // Double-check there really is no active quest (race-safety)
  const { data: existingActive } = await supabase
    .from('quests')
    .select('id')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (existingActive) {
    console.log('[weekly-reset] recoverMissingQuest: active quest already exists — nothing to do')
    return true
  }

  // Generate a collage for the closed quest if it doesn't already have one
  if (!lastQuest.collage_url) {
    const allPhotos = await loadAllQuestPhotos(lastQuest.id)
    if (allPhotos.length > 0) {
      try {
        const collageUrl = await generateAndUploadCollage(
          lastQuest.id,
          lastQuest.prompt_name,
          lastQuest.prompt_color,
        )
        if (collageUrl) {
          await supabase
            .from('quests')
            .update({ collage_url: collageUrl })
            .eq('id', lastQuest.id)
        }
      } catch (err) {
        console.error('[weekly-reset] recoverMissingQuest: collage generation error:', err)
        // Non-fatal — we still create the new quest
      }
    }
  }

  // Create the next quest starting now
  const usedNames = await loadUsedPromptNames(groupId)
  const nextPrompt = pickNextPrompt(usedNames)
  const startTime = new Date()

  const { error: createError } = await supabase
    .from('quests')
    .insert({
      group_id:     groupId,
      week_number:  lastQuest.week_number + 1,
      prompt_name:  nextPrompt.name,
      prompt_color: nextPrompt.color,
      start_date:   startTime.toISOString(),
      is_active:    true,
    })

  if (createError) {
    console.error('[weekly-reset] recoverMissingQuest: createQuest error:', createError)
    return false
  }

  console.log('[weekly-reset] recoverMissingQuest: recovery complete. New prompt:', nextPrompt.name)
  return true
}

async function performReset(quest, resetTime, groupId) {
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

  // Another client already closed it — but we must verify the new quest was
  // actually created before bailing. If the first client crashed between
  // closing the old quest and inserting the new one, we need to finish the job.
  if (!updated) {
    console.log('[weekly-reset] Quest already closed by another client — verifying new quest exists…')
    const { data: newActive } = await supabase
      .from('quests')
      .select('id')
      .eq('group_id', groupId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (newActive) {
      // All good — new quest exists
      return true
    }

    // New quest is missing — the first client must have failed mid-reset.
    // Fall through to steps 2-4 to complete the reset ourselves.
    console.warn('[weekly-reset] New quest missing after close — completing reset…')
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
  const usedNames = await loadUsedPromptNames(groupId)
  const nextPrompt = pickNextPrompt(usedNames)

  // Step 4: Create the new quest, starting at the exact reset time (Sunday midnight)
  const { error: createError } = await supabase
    .from('quests')
    .insert({
      group_id:     groupId,
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
 * @param {string} groupId
 * @returns {Promise<string[]>}
 */
async function loadUsedPromptNames(groupId) {
  const { data, error } = await supabase
    .from('quests')
    .select('prompt_name')
    .eq('group_id', groupId)
    .order('week_number', { ascending: true })

  if (error) {
    console.error('[weekly-reset] loadUsedPromptNames error:', error)
    return []
  }

  return (data || []).map(q => q.prompt_name)
}
