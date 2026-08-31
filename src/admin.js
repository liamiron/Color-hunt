/**
 * Color Hunt — Admin Module
 *
 * Provides all admin panel logic:
 *   - Fetching all groups with member/quest/photo details
 *   - End week for a group (triggers collage + new quest)
 *   - Reset a group (full wipe + fresh week 1)
 *   - Delete a group (permanent)
 *   - Close / Reopen a group (triggers "Hunt is Over" for members)
 *   - View + remove members
 */

import { supabase } from './supabase.js'
import { endWeekForGroup } from './weekly-reset.js'
import { showToast } from './ui.js'
import { showScreen } from './router.js'
import { pickNextPrompt } from './prompts.js'

// ── Public: Init ──────────────────────────────────────────────

/**
 * Initialise the admin screen — loads data and binds events.
 * Call this each time the admin screen is shown.
 */
export async function initAdmin() {
  _bindBackButton()
  await _renderAdminScreen()
}

// ── Public: Data Actions ──────────────────────────────────────

/**
 * Load all groups with aggregated info for the admin panel.
 * @returns {Promise<object[]>}
 */
export async function loadAllGroups() {
  // Fetch all groups
  const { data: groups, error: groupsError } = await supabase
    .from('groups')
    .select('*')
    .order('created_at', { ascending: false })

  if (groupsError) {
    console.error('[admin] loadAllGroups error:', groupsError)
    return []
  }

  // For each group, load member count, active quest, photo count
  const enriched = await Promise.all(groups.map(async (group) => {
    // Member count
    const { count: memberCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', group.id)

    // Active quest
    const { data: activeQuest } = await supabase
      .from('quests')
      .select('*')
      .eq('group_id', group.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Photo count for active quest
    let photoCount = 0
    if (activeQuest) {
      const { count } = await supabase
        .from('photos')
        .select('*', { count: 'exact', head: true })
        .eq('quest_id', activeQuest.id)
      photoCount = count || 0
    }

    // Total quest count
    const { count: questCount } = await supabase
      .from('quests')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', group.id)

    return {
      ...group,
      memberCount: memberCount || 0,
      activeQuest,
      photoCount,
      totalWeeks: questCount || 0,
    }
  }))

  return enriched
}

/**
 * Load members for a specific group.
 * @param {string} groupId
 * @returns {Promise<object[]>}
 */
export async function loadGroupMembers(groupId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[admin] loadGroupMembers error:', error)
    return []
  }
  return data || []
}

/**
 * Admin: end the current week for a group immediately.
 * @param {string} groupId
 */
export async function adminEndWeek(groupId) {
  showToast('Ending week… generating collage ⏳', 6000)
  const ok = await endWeekForGroup(groupId)
  if (ok) {
    showToast('✅ Week ended! New quest started.')
  } else {
    showToast('❌ Could not end week — no active quest?')
  }
}

/**
 * Admin: Full group reset — deletes ALL quests + photos + storage files,
 * then creates a fresh week 1 quest.
 * @param {string} groupId
 */
export async function resetGroup(groupId) {
  // Delete photos from storage
  await _deleteGroupStorageFiles(groupId)

  // Delete all quests (CASCADE deletes photos rows)
  const { error: deleteError } = await supabase
    .from('quests')
    .delete()
    .eq('group_id', groupId)

  if (deleteError) {
    console.error('[admin] resetGroup delete quests error:', deleteError)
    throw deleteError
  }

  // Reopen group if it was closed
  await supabase
    .from('groups')
    .update({ is_closed: false })
    .eq('id', groupId)

  // Create fresh week 1 quest
  const nextPrompt = pickNextPrompt([])
  const { error: insertError } = await supabase
    .from('quests')
    .insert({
      group_id:     groupId,
      week_number:  1,
      prompt_name:  nextPrompt.name,
      prompt_color: nextPrompt.color,
      start_date:   new Date().toISOString(),
      is_active:    true,
    })

  if (insertError) {
    console.error('[admin] resetGroup insert quest error:', insertError)
    throw insertError
  }
}

/**
 * Admin: Permanently delete a group and all its data.
 * @param {string} groupId
 */
export async function deleteGroup(groupId) {
  // Delete storage files
  await _deleteGroupStorageFiles(groupId)

  // Unassign all members
  await supabase
    .from('user_profiles')
    .update({ group_id: null })
    .eq('group_id', groupId)

  // Delete the group (CASCADE handles quests + photos rows)
  const { error } = await supabase
    .from('groups')
    .delete()
    .eq('id', groupId)

  if (error) {
    console.error('[admin] deleteGroup error:', error)
    throw error
  }
}

/**
 * Admin: Close a group — members will see "Hunt is Over" screen.
 * @param {string} groupId
 */
export async function closeGroup(groupId) {
  const { error } = await supabase
    .from('groups')
    .update({ is_closed: true })
    .eq('id', groupId)

  if (error) {
    console.error('[admin] closeGroup error:', error)
    throw error
  }
}

/**
 * Admin: Reopen a closed group.
 * @param {string} groupId
 */
export async function reopenGroup(groupId) {
  const { error } = await supabase
    .from('groups')
    .update({ is_closed: false })
    .eq('id', groupId)

  if (error) {
    console.error('[admin] reopenGroup error:', error)
    throw error
  }
}

/**
 * Admin: Remove a member from their group.
 * @param {string} userId
 */
export async function removeMember(userId) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ group_id: null })
    .eq('user_id', userId)

  if (error) {
    console.error('[admin] removeMember error:', error)
    throw error
  }
}

// ── Internal: Storage Cleanup ─────────────────────────────────

/**
 * Delete all photo files in storage for a given group.
 * Walks all quests and all photo storage_paths.
 * @param {string} groupId
 */
async function _deleteGroupStorageFiles(groupId) {
  // Get all quests for this group
  const { data: quests } = await supabase
    .from('quests')
    .select('id')
    .eq('group_id', groupId)

  if (!quests || quests.length === 0) return

  const questIds = quests.map(q => q.id)

  // Get all photos storage_paths
  const { data: photos } = await supabase
    .from('photos')
    .select('storage_path')
    .in('quest_id', questIds)

  if (!photos || photos.length === 0) return

  // Extract storage paths from full URLs
  // storage_path is stored as a full public URL like:
  // https://xxx.supabase.co/storage/v1/object/public/photos/path/to/file.jpg
  const paths = photos
    .map(p => {
      const match = p.storage_path?.match(/\/object\/public\/photos\/(.+)/)
      return match ? match[1] : null
    })
    .filter(Boolean)

  if (paths.length === 0) return

  const { error } = await supabase.storage
    .from('photos')
    .remove(paths)

  if (error) {
    console.warn('[admin] storage cleanup partial error:', error)
    // Non-fatal — continue with DB deletion even if storage cleanup fails
  }
}

// ── Internal: UI Rendering ────────────────────────────────────

async function _renderAdminScreen() {
  const container = document.getElementById('admin-groups-list')
  const statsEl   = document.getElementById('admin-stats')
  if (!container) return

  // Loading state
  container.innerHTML = `
    <div class="admin-loading">
      <div class="admin-spinner"></div>
      <span>Loading groups…</span>
    </div>
  `

  const groups = await loadAllGroups()

  // Render stats
  if (statsEl) {
    const totalMembers = groups.reduce((sum, g) => sum + g.memberCount, 0)
    const totalPhotos  = groups.reduce((sum, g) => sum + g.photoCount, 0)
    statsEl.innerHTML = `
      <div class="admin-stat">
        <span class="admin-stat__value">${groups.length}</span>
        <span class="admin-stat__label">Groups</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat__value">${totalMembers}</span>
        <span class="admin-stat__label">Members</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat__value">${totalPhotos}</span>
        <span class="admin-stat__label">Photos this week</span>
      </div>
    `
  }

  if (groups.length === 0) {
    container.innerHTML = `
      <div class="admin-empty">
        <div class="admin-empty__icon">${_icon('globe')}</div>
        <p class="admin-empty__text">No groups yet. Once people create groups, they'll appear here.</p>
      </div>
    `
    return
  }

  container.innerHTML = ''
  groups.forEach(group => {
    const card = _buildGroupCard(group)
    container.appendChild(card)
  })
}

function _buildGroupCard(group) {
  const card = document.createElement('div')
  card.className = 'admin-group-card'
  card.dataset.groupId = group.id

  const isClosed = group.is_closed
  const quest    = group.activeQuest
  const weekNum  = quest ? quest.week_number : '—'
  const prompt   = quest ? quest.prompt_name : 'No active quest'
  const color    = quest ? quest.prompt_color : '#aaa'

  card.innerHTML = `
    <div class="admin-group-card__header">
      <div class="admin-group-card__info">
        <div class="admin-group-card__name">${_escHtml(group.name)}</div>
        <div class="admin-group-card__code">ID: <span class="admin-code-chip">${_escHtml(group.invite_code || '—')}</span></div>
      </div>
      <div class="admin-group-card__badges">
        <span class="admin-status-pill ${isClosed ? 'admin-status-pill--closed' : 'admin-status-pill--active'}">
          ${isClosed
            ? `<span class="admin-status-dot admin-status-dot--closed"></span> Closed`
            : `<span class="admin-status-dot admin-status-dot--active"></span> Active`
          }
        </span>
      </div>
    </div>

    <div class="admin-group-card__meta">
      <div class="admin-meta-item">
        <span class="admin-meta-item__icon">${_icon('users')}</span>
        <span>${group.memberCount} member${group.memberCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="admin-meta-item">
        <span class="admin-meta-item__icon" style="color:${color}">${_icon('target')}</span>
        <span>Week ${weekNum}: <strong>${_escHtml(prompt)}</strong></span>
      </div>
      <div class="admin-meta-item">
        <span class="admin-meta-item__icon">${_icon('camera')}</span>
        <span>${group.photoCount} photo${group.photoCount !== 1 ? 's' : ''} this week</span>
      </div>
      <div class="admin-meta-item">
        <span class="admin-meta-item__icon">${_icon('calendar')}</span>
        <span>${group.totalWeeks} week${group.totalWeeks !== 1 ? 's' : ''} total</span>
      </div>
    </div>

    ${quest ? `
    <div class="admin-group-card__prompt-bar" style="background:${color}18; border-left: 3px solid ${color}">
      <span class="admin-prompt-dot" style="background:${color}"></span>
      <span class="admin-prompt-name">${_escHtml(quest.prompt_name)}</span>
      <span class="admin-prompt-week">Week ${weekNum}</span>
    </div>` : ''}

    <div class="admin-group-card__actions">
      <button class="admin-btn admin-btn--blue" data-action="end-week" data-group-id="${group.id}" data-group-name="${_escHtml(group.name)}" title="End this week now — generates collage and starts a new quest">
        ${_icon('skip-forward')} End Week
      </button>
      <button class="admin-btn admin-btn--orange" data-action="reset" data-group-id="${group.id}" data-group-name="${_escHtml(group.name)}" title="Full reset — deletes ALL photos and history">
        ${_icon('refresh')} Reset
      </button>
      ${isClosed
        ? `<button class="admin-btn admin-btn--green" data-action="reopen" data-group-id="${group.id}" data-group-name="${_escHtml(group.name)}">${_icon('unlock')} Reopen</button>`
        : `<button class="admin-btn admin-btn--grey" data-action="close" data-group-id="${group.id}" data-group-name="${_escHtml(group.name)}">${_icon('lock')} Close</button>`
      }
      <button class="admin-btn admin-btn--red" data-action="delete" data-group-id="${group.id}" data-group-name="${_escHtml(group.name)}" title="Permanently delete this group">
        ${_icon('trash')} Delete
      </button>
    </div>

    <button class="admin-members-toggle" data-group-id="${group.id}">
      <span>${_icon('users')} View members</span>
      <svg class="admin-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="admin-members-list" id="members-${group.id}" hidden></div>
  `

  // Bind action buttons
  card.querySelectorAll('.admin-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => _handleAction(e, btn))
  })

  // Members toggle
  const toggle = card.querySelector('.admin-members-toggle')
  const membersList = card.querySelector('.admin-members-list')
  toggle.addEventListener('click', async () => {
    const open = !membersList.hidden
    membersList.hidden = open
    toggle.classList.toggle('admin-members-toggle--open', !open)
    if (!open) {
      await _renderMembersList(group.id, membersList)
    }
  })

  return card
}

async function _renderMembersList(groupId, container) {
  container.innerHTML = '<div class="admin-members-loading">Loading…</div>'
  const members = await loadGroupMembers(groupId)

  if (members.length === 0) {
    container.innerHTML = '<p class="admin-members-empty">No members in this group.</p>'
    return
  }

  container.innerHTML = members.map(m => `
    <div class="admin-member-row" data-user-id="${m.user_id}">
      <div class="admin-member-info">
        <span class="admin-member-id">${m.user_id.slice(0, 8)}…</span>
        <span class="admin-member-joined">Joined ${_formatDate(m.created_at)}</span>
      </div>
      <button class="admin-btn admin-btn--red admin-btn--sm" data-action="remove-member" data-user-id="${m.user_id}">
        ${_icon('x')} Remove
      </button>
    </div>
  `).join('')

  container.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId
      await _showDangerConfirm({
        title: 'Remove Member',
        message: 'This member will be removed from the group. They can rejoin with the group code.',
        confirmLabel: 'Remove',
        confirmClass: 'admin-danger-btn--red',
        onConfirm: async () => {
          try {
            await removeMember(userId)
            btn.closest('.admin-member-row').remove()
            showToast('Member removed.')
            await _refreshCard(groupId)
          } catch {
            showToast('Failed to remove member.')
          }
        }
      })
    })
  })
}

async function _handleAction(e, btn) {
  const action    = btn.dataset.action
  const groupId   = btn.dataset.groupId
  const groupName = btn.dataset.groupName || 'this group'

  if (action === 'end-week') {
    await _showDangerConfirm({
      title: 'End Current Week',
      message: `End the week for <strong>${_escHtml(groupName)}</strong>?<br><br>A collage will be generated from this week's photos and a new quest will begin.`,
      confirmLabel: 'End Week',
      confirmClass: 'admin-danger-btn--blue',
      onConfirm: async () => {
        showToast('Ending week… generating collage', 6000)
        await adminEndWeek(groupId)
        await _refreshCard(groupId)
      }
    })

  } else if (action === 'reset') {
    await _showDangerConfirm({
      title: 'Reset Group',
      message: `This will permanently delete ALL photos, collages, and quest history for <strong>${_escHtml(groupName)}</strong>.<br><br>A fresh Week 1 will start. This cannot be undone.`,
      confirmLabel: 'Reset Group',
      confirmClass: 'admin-danger-btn--orange',
      onConfirm: async () => {
        showToast('Resetting group…', 8000)
        await resetGroup(groupId)
        showToast(`"${groupName}" has been reset.`)
        await _refreshCard(groupId)
      }
    })

  } else if (action === 'close') {
    await _showDangerConfirm({
      title: 'Close Group',
      message: `Close <strong>${_escHtml(groupName)}</strong>?<br><br>All members will see the "The Hunt is Over" screen and won't be able to use the group until it's reopened.`,
      confirmLabel: 'Close Group',
      confirmClass: 'admin-danger-btn--grey',
      onConfirm: async () => {
        await closeGroup(groupId)
        showToast(`"${groupName}" closed.`)
        await _refreshCard(groupId)
      }
    })

  } else if (action === 'reopen') {
    await _showDangerConfirm({
      title: 'Reopen Group',
      message: `Reopen <strong>${_escHtml(groupName)}</strong>?<br><br>Members will be able to access the group again.`,
      confirmLabel: 'Reopen',
      confirmClass: 'admin-danger-btn--green',
      onConfirm: async () => {
        await reopenGroup(groupId)
        showToast(`"${groupName}" reopened.`)
        await _refreshCard(groupId)
      }
    })

  } else if (action === 'delete') {
    await _showDangerConfirm({
      title: 'Delete Group',
      message: `This will <strong>permanently delete</strong> all data for <strong>${_escHtml(groupName)}</strong> including all photos, quests, and memberships.<br><br>This cannot be undone.`,
      confirmLabel: 'Delete Group',
      confirmClass: 'admin-danger-btn--red',
      onConfirm: async () => {
        showToast('Deleting group…', 8000)
        await deleteGroup(groupId)
        showToast(`"${groupName}" deleted.`)
        const card = document.querySelector(`.admin-group-card[data-group-id="${groupId}"]`)
        if (card) card.remove()
        await _renderAdminScreen()
      }
    })
  }
}

/**
 * Re-fetch and re-render a single group card in place.
 */
async function _refreshCard(groupId) {
  const groups = await loadAllGroups()
  const group  = groups.find(g => g.id === groupId)
  if (!group) return

  const oldCard = document.querySelector(`.admin-group-card[data-group-id="${groupId}"]`)
  if (!oldCard) return

  const newCard = _buildGroupCard(group)
  oldCard.replaceWith(newCard)

  // Also refresh stats
  const statsEl = document.getElementById('admin-stats')
  if (statsEl) {
    const totalMembers = groups.reduce((sum, g) => sum + g.memberCount, 0)
    const totalPhotos  = groups.reduce((sum, g) => sum + g.photoCount, 0)
    statsEl.innerHTML = `
      <div class="admin-stat">
        <span class="admin-stat__value">${groups.length}</span>
        <span class="admin-stat__label">Groups</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat__value">${totalMembers}</span>
        <span class="admin-stat__label">Members</span>
      </div>
      <div class="admin-stat">
        <span class="admin-stat__value">${totalPhotos}</span>
        <span class="admin-stat__label">Photos this week</span>
      </div>
    `
  }
}

// ── Confirmation Modal ────────────────────────────────────────

function _showDangerConfirm({ title, message, confirmLabel, confirmClass, onConfirm }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'admin-danger-overlay'
    overlay.innerHTML = `
      <div class="admin-danger-modal">
        <div class="admin-danger-modal__title">${title}</div>
        <div class="admin-danger-modal__message">${message}</div>
        <div class="admin-danger-modal__actions">
          <button class="admin-danger-btn admin-danger-btn--cancel">Cancel</button>
          <button class="admin-danger-btn ${confirmClass}">${confirmLabel}</button>
        </div>
      </div>
    `

    const confirmBtn = overlay.querySelector(`.${confirmClass}`)
    const cancelBtn  = overlay.querySelector('.admin-danger-btn--cancel')

    cancelBtn.addEventListener('click', () => {
      overlay.remove()
      resolve(false)
    })

    confirmBtn.addEventListener('click', async () => {
      overlay.remove()
      await onConfirm()
      resolve(true)
    })

    // Click outside to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove()
        resolve(false)
      }
    })

    document.body.appendChild(overlay)
  })
}

// ── Back button ───────────────────────────────────────────────

function _bindBackButton() {
  const btn = document.getElementById('admin-back-btn')
  if (!btn) return
  // Remove old listener to avoid stacking
  const fresh = btn.cloneNode(true)
  btn.replaceWith(fresh)
  fresh.addEventListener('click', () => showScreen('main'))
}

// ── Helpers ───────────────────────────────────────────────────

function _escHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function _formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── SVG Icon Library ──────────────────────────────────────────

const ICONS = {
  users: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  target: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  camera: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  calendar: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  'skip-forward': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
  refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  unlock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  globe: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  x: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
}

function _icon(name) {
  return ICONS[name] || ''
}
