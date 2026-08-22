/**
 * Archive bottom sheet — drag-to-expand gesture + card rendering.
 */

const sheetEl        = document.getElementById('archive-sheet')
const handleEl       = document.getElementById('archive-handle')
const toggleBtn      = document.getElementById('archive-toggle')
const listEl         = document.getElementById('archive-list')
const lightboxEl     = document.getElementById('collage-lightbox')
const lightboxImg    = document.getElementById('collage-lightbox-img')
const lightboxClose  = document.getElementById('collage-lightbox-close')

let _isOpen      = false
let _isDragging  = false
let _startY      = 0
let _currentY    = 0
let _sheetHeight = 0
let _listenersAttached = false   // guard against duplicate setup

// ── Public API ───────────────────────────────────────────────

/**
 * Initialise the archive sheet with past quests data.
 * @param {object[]} quests  — from loadArchive()
 */
export function initArchive(quests) {
  renderArchiveList(quests)
  if (!_listenersAttached) {
    setupGestures()
    setupToggleButton()
    setupDownloadListener()
    setupLightbox()
    _listenersAttached = true
  }
}

/**
 * Re-render the archive list with fresh data.
 * @param {object[]} quests
 */
export function updateArchive(quests) {
  renderArchiveList(quests)
}

// ── Rendering ────────────────────────────────────────────────

function renderArchiveList(quests) {
  listEl.innerHTML = ''

  if (!quests || quests.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'archive__empty'
    empty.innerHTML = `
      <div class="archive__empty-icon">📷</div>
      <p class="archive__empty-text">No completed quests yet.<br>Fill your grid and wait for the week to end!</p>
    `
    listEl.appendChild(empty)
    return
  }

  for (const quest of quests) {
    const card = document.createElement('article')
    card.className = 'archive-card'
    card.setAttribute('role', 'listitem')

    const hasCollage = !!quest.collage_url
    const weekLabel  = `Week ${quest.week_number}`

    card.innerHTML = `
      <div class="archive-card__meta">
        <div>
          <div class="archive-card__week">${weekLabel}</div>
          <div class="archive-card__prompt">${quest.prompt_name}</div>
        </div>
        ${hasCollage ? `
        <button class="archive-card__download-btn" data-url="${quest.collage_url}" data-filename="${quest.prompt_name} Collage.jpg" aria-label="Download collage" title="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
        ` : ''}
      </div>
      ${hasCollage
        ? `<img
            class="archive-card__collage archive-card__collage--clickable"
            src="${quest.collage_url}"
            alt="Group collage for ${weekLabel}: ${quest.prompt_name}"
            data-lightbox-src="${quest.collage_url}"
            data-lightbox-alt="${weekLabel}: ${quest.prompt_name}"
            loading="lazy"
            role="button"
            tabindex="0"
            title="View full size"
          />`
        : `<div class="archive-card__collage-placeholder">Collage coming soon…</div>`
      }
    `

    listEl.appendChild(card)
  }
}

// ── Lightbox ─────────────────────────────────────────────────

function openLightbox(src, alt) {
  lightboxImg.src = src
  lightboxImg.alt = alt || 'Collage'
  lightboxEl.removeAttribute('hidden')
  document.body.style.overflow = 'hidden'
}

function closeLightbox() {
  lightboxEl.setAttribute('hidden', '')
  lightboxImg.src = ''
  // Restore scroll only if archive is also closed
  if (!_isOpen) document.body.style.overflow = ''
}

function setupLightbox() {
  // Click on a collage image → open lightbox
  listEl.addEventListener('click', (e) => {
    const img = e.target.closest('.archive-card__collage--clickable')
    if (!img) return
    e.stopPropagation()
    openLightbox(img.dataset.lightboxSrc, img.dataset.lightboxAlt)
  })

  // Keyboard access (Enter / Space) on collage images
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const img = e.target.closest('.archive-card__collage--clickable')
    if (!img) return
    e.preventDefault()
    openLightbox(img.dataset.lightboxSrc, img.dataset.lightboxAlt)
  })

  // Close via × button
  lightboxClose.addEventListener('click', closeLightbox)

  // Close by clicking the backdrop (but NOT the image itself)
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl) closeLightbox()
  })

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightboxEl.hasAttribute('hidden')) closeLightbox()
  })
}

// ── Gestures & Actions ────────────────────────────────────────

function setupDownloadListener() {
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.archive-card__download-btn')
    if (!btn) return
    
    e.preventDefault()
    e.stopPropagation()
    
    const url = btn.dataset.url
    const filename = btn.dataset.filename
    if (!url) return
    
    try {
      btn.style.opacity = '0.5' // visual feedback
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename || 'collage.jpg'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      btn.style.opacity = '1'
    } catch (err) {
      console.error('[archive] Download failed:', err)
      // Fallback: open in new tab
      window.open(url, '_blank')
      btn.style.opacity = '1'
    }
  })
}

function setupGestures() {
  // Touch/pointer drag on handle
  handleEl.addEventListener('pointerdown', onDragStart)
  handleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') toggle()
  })

  // Also allow dragging from the header area
  const headerArea = sheetEl.querySelector('.archive__header')
  if (headerArea) {
    headerArea.addEventListener('pointerdown', onDragStart)
  }
}

function setupToggleButton() {
  // Stop pointerdown from propagating to the header drag handler —
  // otherwise a tap on the chevron starts a drag AND fires the toggle.
  toggleBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
  })
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    toggle()
  })
}

function onDragStart(e) {
  // Ignore events that originated from the toggle button
  if (e.target === toggleBtn || toggleBtn.contains(e.target)) return

  _isDragging  = true
  _startY      = e.clientY
  _currentY    = 0
  _sheetHeight = sheetEl.offsetHeight

  // Capture pointer so we keep receiving events even when
  // the finger moves outside the element (critical on mobile)
  try { e.target.setPointerCapture(e.pointerId) } catch (_) {}

  // Remove transition during drag for snappiness
  sheetEl.style.transition = 'none'

  document.addEventListener('pointermove', onDragMove)
  document.addEventListener('pointerup',   onDragEnd)
  document.addEventListener('pointercancel', onDragEnd)
}

function onDragMove(e) {
  if (!_isDragging) return

  const delta = e.clientY - _startY
  _currentY = delta

  // In open state: only allow dragging down (positive delta)
  // In closed state: only allow dragging up (negative delta)
  if (_isOpen) {
    if (delta < 0) return
    const pct = Math.min(delta / _sheetHeight, 1)
    sheetEl.style.transform = `translateX(-50%) translateY(${pct * (100 - peekPercent())}%)`
  } else {
    if (delta > 0) return
    const openY = (_sheetHeight - peekPx())
    const pct = Math.max(0, Math.min(1, -delta / openY))
    sheetEl.style.transform = `translateX(-50%) translateY(${(1 - pct) * (100 - peekPercent())}%)`
  }
}

function onDragEnd() {
  if (!_isDragging) return
  _isDragging = false

  document.removeEventListener('pointermove', onDragMove)
  document.removeEventListener('pointerup',   onDragEnd)
  document.removeEventListener('pointercancel', onDragEnd)

  // Restore spring transition
  sheetEl.style.transition = ''
  sheetEl.style.transform  = ''

  // Snap decision: 30% threshold
  const threshold = _sheetHeight * 0.3

  if (_isOpen) {
    if (_currentY > threshold) {
      close()
    } else {
      open()
    }
  } else {
    if (_currentY < -threshold) {
      open()
    } else {
      close()
    }
  }
}

function peekPx() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ch-sheet-peek')) || 72
}

function peekPercent() {
  return (peekPx() / sheetEl.offsetHeight) * 100
}

// ── Open / Close ─────────────────────────────────────────────

export function open() {
  _isOpen = true
  sheetEl.classList.add('archive--open')
  document.body.style.overflow = 'hidden'
  sheetEl.style.transform = ''
}

export function close() {
  _isOpen = false
  sheetEl.classList.remove('archive--open')
  document.body.style.overflow = ''
  sheetEl.style.transform = ''
}

export function toggle() {
  _isOpen ? close() : open()
}

export function isOpen() {
  return _isOpen
}
