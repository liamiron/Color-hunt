/**
 * Color Hunt — Main Entry Point
 *
 * Orchestrates: Router init → Auth/Group screens → Main screen:
 *   Supabase session → device ID → data load → UI render →
 *   weekly-reset check → visibility refresh listener
 */

import { DotLottie } from '@lottiefiles/dotlottie-web'
import { loadActiveQuest, loadMyPhotos, loadArchive, setupVisibilityRefresh } from './state.js'
import { applyAccentColor } from './prompts.js'
import { initGrid, updateGridPhotos } from './grid.js'
import { initArchive, updateArchive } from './archive.js'
import { checkAndReset, timeUntilReset, getNextSundayMidnight } from './weekly-reset.js'
import { initRouter, getSession, getUserProfileCached, isAdmin, showScreen, refreshUserProfile } from './router.js'
import { initAuth } from './auth.js'
import { initGroup } from './group.js'
import { showToast } from './ui.js'
import { initAdmin, getIcon } from './admin.js'
import { supabase } from './supabase.js'

// ── DOM refs ────────────────────────────────────────────────────
const promptHighlight  = document.getElementById('prompt-highlight')
const promptSkeleton   = document.getElementById('prompt-skeleton')
const gridLoadingEl    = document.getElementById('grid-loading')
const photoGridEl      = document.getElementById('photo-grid')
const questLockedEl    = document.getElementById('quest-locked')
const countdownEl      = document.getElementById('quest-countdown')
const countdownValueEl = document.getElementById('countdown-value')
const mainLoaderEl     = document.getElementById('main-loader')
const mainLoaderCanvas = document.getElementById('main-loader-canvas')
const groupIdDisplay   = document.getElementById('group-id-display')

// ── App State ─────────────────────────────────────────────────
let _userId      = null
let _activeQuest = null
let _groupId     = null

// ── Bootstrap ─────────────────────────────────────────────────

// Start the Lottie animation immediately so the overlay is animated
const _dotLottie = new DotLottie({
  canvas: mainLoaderCanvas,
  src: '/main-loading-animation.lottie',
  loop: true,
  autoplay: true,
})

function hideMainLoader() {
  mainLoaderEl.classList.add('main-loader--hidden')
  // Remove from DOM after fade completes so it can't block interactions
  mainLoaderEl.addEventListener('transitionend', () => {
    mainLoaderEl.remove()
    _dotLottie.destroy()
  }, { once: true })
}

// ── Screen init ───────────────────────────────────────────────

// Initialise auth and group module listeners immediately (DOM is ready)
initAuth()
initGroup()
_initAdminButton()
_initHuntOverButton()

// Boot the router — it decides which screen to show, calls onMainReady when appropriate
initRouter(onMainReady).finally(() => {
  hideMainLoader()
})

/**
 * Called by the router when the main screen becomes active.
 * Kicks off data loading and sets up refresh listeners.
 */
async function onMainReady() {
  try {
    const profile = getUserProfileCached()
    _userId  = profile?.user_id
    _groupId = profile?.group_id || null

    if (!_groupId) {
      showError(new Error('No group assigned. Please reload and sign in again.'))
      return
    }

    // Check if group is closed → show Hunt is Over screen instead
    const { data: group } = await supabase
      .from('groups')
      .select('is_closed')
      .eq('id', _groupId)
      .single()

    if (group?.is_closed) {
      showScreen('hunt-over')
      return
    }

    await loadAndRender()
  } catch (err) {
    console.error('[main] onMainReady error:', err)
    showError(err)
  }

  // Re-fetch when user returns to the tab (replaces Realtime)
  setupVisibilityRefresh(async () => {
    try {
      // Re-check if group was closed while user was away
      if (_groupId) {
        const { data: group } = await supabase
          .from('groups')
          .select('is_closed')
          .eq('id', _groupId)
          .single()
        if (group?.is_closed) {
          showScreen('hunt-over')
          return
        }
      }
      await loadAndRender(/* silent = */ true)
    } catch (err) {
      console.warn('[main] visibility refresh error:', err)
    }
  })

  // Show admin button if user is admin
  _updateAdminButtonVisibility()

  // Group ID chip — display and clipboard copy
  _initGroupIdChip()
}

async function loadAndRender(silent = false) {
  if (!silent) showLoading(true)

  // 1. Load active quest for this user's group
  let quest = await loadActiveQuest(_groupId)

  // 2. Check if quest has expired → weekly reset
  if (quest) {
    const wasReset = await checkAndReset(quest)
    if (wasReset) {
      // Re-load after reset
      quest = await loadActiveQuest(_groupId)
    }
  }

  _activeQuest = quest

  if (!quest) {
    showError(new Error('No active quest found. Check Supabase setup.'))
    return
  }

  // 3. Apply prompt accent color to the whole UI
  applyAccentColor(quest.prompt_color)

  // Reveal accent-coloured elements now that the real color is set —
  // they were hidden in HTML to prevent a yellow flash on first paint.
  const fabEl = document.getElementById('fab-btn')
  if (fabEl) fabEl.removeAttribute('hidden')

  // 4. Update header + start countdown
  promptHighlight.textContent = `TARGET: ${quest.prompt_name}`
  startCountdown(quest.start_date)

  // 5. Load this user's photos
  const photos = await loadMyPhotos(quest.id, _userId)

  // 6. Render grid
  showLoading(false)

  if (silent) {
    // Just update grid data without full re-init
    updateGridPhotos(photos)
  } else {
    initGrid(quest.id, _userId, photos)
  }

  // 7. Load + render archive
  const archive = await loadArchive(_groupId)
  if (silent) {
    updateArchive(archive)
  } else {
    initArchive(archive)
  }

  // 8. Dev reset shortcut removed — use Admin Panel to end the week manually
}

// ── Admin Button ──────────────────────────────────────────────

function _initAdminButton() {
  const btn = document.getElementById('admin-panel-btn')
  if (!btn) return
  btn.innerHTML = getIcon('settings')
  btn.addEventListener('click', () => {
    showScreen('admin')
    initAdmin()
  })
}

function _updateAdminButtonVisibility() {
  const btn = document.getElementById('admin-panel-btn')
  if (!btn) return
  if (isAdmin()) {
    btn.removeAttribute('hidden')
  } else {
    btn.hidden = true
  }
}

// ── Hunt is Over Button ───────────────────────────────────────

function _initHuntOverButton() {
  const btn = document.getElementById('hunt-over-find-btn')
  if (!btn) return
  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Leaving…'
    // Unassign user from the closed group
    if (_userId) {
      await supabase
        .from('user_profiles')
        .update({ group_id: null })
        .eq('user_id', _userId)
      _groupId = null
      await refreshUserProfile()
    }
    showScreen('group')
    btn.disabled = false
    btn.textContent = 'Find a New Hunt'
  })
}

// ── Group ID Chip ─────────────────────────────────────────────

function _initGroupIdChip() {
  if (!groupIdDisplay) return

  const profile = getUserProfileCached()
  const code = profile?.groups?.invite_code

  if (!code) {
    groupIdDisplay.hidden = true
    return
  }

  groupIdDisplay.textContent = `Group ID: ${code}`
  groupIdDisplay.hidden = false

  groupIdDisplay.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code)
      showToast('Copied to clipboard!')
    } catch {
      // Fallback for browsers without clipboard API
      showToast(code)
    }
  })
}

// ── UI helpers ────────────────────────────────────────────────

function showLoading(show) {
  gridLoadingEl.hidden  = !show
  photoGridEl.hidden    = show
  if (questLockedEl) questLockedEl.hidden = true
  // Swap header: skeleton pill while loading, real highlight once loaded
  if (promptSkeleton)   promptSkeleton.hidden  = !show
  if (promptHighlight)  promptHighlight.hidden  = show
  // Hide countdown badge while loading
  if (countdownEl) countdownEl.style.visibility = show ? 'hidden' : 'visible'
}

function showError(err) {
  // Show loading area with error content, hide grid
  photoGridEl.hidden = true
  if (questLockedEl) questLockedEl.hidden = true

  gridLoadingEl.innerHTML = `
    <div style="text-align:center; padding: 32px 24px;">
      <div style="font-size:2.5rem; margin-bottom:12px;">⚠️</div>
      <p style="font-size:0.95rem; line-height:1.5; color:#555;">
        ${err?.message || 'Something went wrong.'}<br><br>
        Make sure your <code>.env</code> file is set up.<br>
        See <strong>supabase/setup-guide.md</strong>.
      </p>
    </div>
  `
  gridLoadingEl.hidden = false
}

// ── Countdown ────────────────────────────────────────────────

let _countdownInterval = null

function startCountdown(startDate) {
  // Clear any previous interval
  clearInterval(_countdownInterval)

  function tick() {
    if (!countdownValueEl || !countdownEl) return
    const text    = timeUntilReset(startDate)
    const resetMs = getNextSundayMidnight(startDate).getTime() - Date.now()
    const urgent  = resetMs > 0 && resetMs < 24 * 60 * 60 * 1000

    countdownValueEl.textContent = text
    countdownEl.classList.toggle('quest-countdown--urgent', urgent)
  }

  tick()  // run immediately
  _countdownInterval = setInterval(tick, 60_000)  // update every minute
}
