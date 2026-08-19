import { supabase } from './supabase.js'
import { showToast } from './ui.js'

// Per-cell tilt values (degrees) — deterministic, organic feel
const TILTS = [-2, 1, -1.5, 0.5, -1, 2, -0.5, 1.5, -1]

let _questId    = null
let _deviceId   = null
let _photos     = []     // array length 9, null = empty
let _isLocked   = false  // quest locked (end-of-week)
let _pendingSlot = null  // which slot the user clicked

// DOM refs
const gridEl        = document.getElementById('photo-grid')
const fabEl         = document.getElementById('fab-btn')
const fileInputEl   = document.getElementById('file-input')
const deleteTooltip = document.getElementById('delete-tooltip')
const deleteConfirm = document.getElementById('delete-confirm')
const deleteCancel  = document.getElementById('delete-cancel')

/**
 * Initialise the grid controller.
 * @param {string} questId
 * @param {string} deviceId
 * @param {object[]} photos  — from loadMyPhotos()
 * @param {boolean} isLocked
 */
export function initGrid(questId, deviceId, photos, isLocked = false) {
  _questId  = questId
  _deviceId = deviceId
  _isLocked = isLocked

  // Build a 9-slot array (index = slot_index)
  _photos = Array(9).fill(null)
  for (const p of photos) {
    _photos[p.slot_index] = p
  }

  renderGrid()
  setupFileInput()
  setupFab()
  setupDeleteButtons()
}

/**
 * Update photos array and re-render (called after visibility refresh).
 */
export function updateGridPhotos(photos, isLocked = false) {
  _isLocked = isLocked
  _photos = Array(9).fill(null)
  for (const p of photos) {
    _photos[p.slot_index] = p
  }
  renderGrid()
}

// ── Rendering ────────────────────────────────────────────────

function renderGrid() {
  gridEl.innerHTML = ''

  for (let i = 0; i < 9; i++) {
    const photo = _photos[i]
    const slot  = document.createElement('div')
    slot.className = photo ? 'slot slot--filled' : 'slot slot--empty'
    slot.dataset.index = i
    slot.setAttribute('role', 'gridcell')
    slot.style.setProperty('--tilt', `${TILTS[i]}deg`)

    if (photo) {
      // Filled slot
      const img = document.createElement('img')
      img.className   = 'slot__img'
      img.src         = photo.image_url
      img.alt         = `Your photo for slot ${i + 1}`
      img.loading     = 'lazy'
      slot.appendChild(img)

      if (!_isLocked) {
        setupLongPress(slot, i)
      }
    } else {
      // Empty slot
      const plus = document.createElement('span')
      plus.className   = 'slot__plus'
      plus.textContent = '+'
      plus.setAttribute('aria-hidden', 'true')
      slot.appendChild(plus)
      slot.setAttribute('aria-label', `Empty slot ${i + 1} — tap to add a photo`)

      if (!_isLocked) {
        slot.addEventListener('click', () => handleSlotClick(i))
      }
    }

    gridEl.appendChild(slot)
  }

  updateFabVisibility()
}

// ── Slot click → open picker ──────────────────────────────────

function handleSlotClick(slotIndex) {
  if (_isLocked) return
  if (_photos[slotIndex]) return  // filled, skip

  _pendingSlot = slotIndex
  fileInputEl.click()
}

// ── FAB ──────────────────────────────────────────────────────

function setupFab() {
  fabEl.addEventListener('click', () => {
    if (_isLocked) return
    // Find first empty slot
    const first = _photos.findIndex(p => p === null)
    if (first === -1) return
    _pendingSlot = first
    fileInputEl.click()
  })
}

function updateFabVisibility() {
  const full = _photos.every(p => p !== null)
  fabEl.classList.toggle('fab--hidden', full || _isLocked)
}

// ── File input → upload ───────────────────────────────────────

function setupFileInput() {
  fileInputEl.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file || _pendingSlot === null) return
    fileInputEl.value = ''  // reset so same file can be re-selected

    const slotIndex = _pendingSlot
    _pendingSlot = null

    await uploadPhoto(file, slotIndex)
  })
}

async function uploadPhoto(file, slotIndex) {
  // Show uploading state on the slot
  const slotEl = gridEl.children[slotIndex]
  if (slotEl) {
    slotEl.classList.add('slot--uploading')
    const overlay = document.createElement('div')
    overlay.className = 'slot__upload-overlay'
    const spinner = document.createElement('div')
    spinner.className = 'slot__spinner'
    overlay.appendChild(spinner)
    slotEl.appendChild(overlay)
  }

  try {
    // 1. Resize the image client-side
    const blob = await resizeImage(file, 1200)

    // 2. Upload to Supabase Storage
    const storagePath = `${_questId}/${_deviceId}/${slotIndex}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      })

    if (uploadError) throw uploadError

    // 3. Get the public URL
    const { data: urlData } = supabase.storage
      .from('photos')
      .getPublicUrl(storagePath)

    const imageUrl = urlData.publicUrl

    // 4. Insert (or upsert) row in photos table
    const { error: dbError } = await supabase
      .from('photos')
      .upsert({
        quest_id:     _questId,
        device_id:    _deviceId,
        slot_index:   slotIndex,
        storage_path: storagePath,
        image_url:    imageUrl,
      }, { onConflict: 'quest_id,device_id,slot_index' })

    if (dbError) throw dbError

    // 5. Update local state + re-render
    _photos[slotIndex] = { quest_id: _questId, device_id: _deviceId, slot_index: slotIndex, storage_path: storagePath, image_url: imageUrl }
    renderGrid()

    // Apply pop-in animation to the newly filled slot
    const newSlot = gridEl.children[slotIndex]
    if (newSlot) {
      newSlot.style.animation = 'none'
      void newSlot.offsetWidth  // reflow
      newSlot.style.animation = `pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)`
    }

  } catch (err) {
    console.error('[grid] uploadPhoto error:', err)
    showToast('Upload failed — please try again.')
    renderGrid()  // revert the slot back
  }
}

// ── Long press → delete ───────────────────────────────────────

let _longPressTimer  = null
let _deleteSlotIndex = null

function setupLongPress(slotEl, slotIndex) {
  const startHold = () => {
    _longPressTimer = setTimeout(() => {
      slotEl.classList.add('slot--long-press')
      slotEl.style.animation = 'shake 0.45s ease'
      slotEl.addEventListener('animationend', () => {
        slotEl.style.animation = ''
      }, { once: true })
      showDeleteTooltip(slotIndex, slotEl)
    }, 600)
  }

  const cancelHold = () => {
    clearTimeout(_longPressTimer)
    slotEl.classList.remove('slot--long-press')
  }

  slotEl.addEventListener('pointerdown', startHold)
  slotEl.addEventListener('pointerup',   cancelHold)
  slotEl.addEventListener('pointerleave', cancelHold)
  slotEl.addEventListener('contextmenu', e => e.preventDefault())
}

function showDeleteTooltip(slotIndex, slotEl) {
  _deleteSlotIndex = slotIndex

  // Position above the slot
  const rect = slotEl.getBoundingClientRect()
  deleteTooltip.style.left = `${Math.min(rect.left + rect.width / 2 - 90, window.innerWidth - 200)}px`
  deleteTooltip.style.top  = `${Math.max(rect.top - 100, 10)}px`
  deleteTooltip.hidden = false
}

function setupDeleteButtons() {
  deleteConfirm.addEventListener('click', async () => {
    if (_deleteSlotIndex === null) return
    deleteTooltip.hidden = true
    await deletePhoto(_deleteSlotIndex)
    _deleteSlotIndex = null
  })

  deleteCancel.addEventListener('click', () => {
    deleteTooltip.hidden = true
    _deleteSlotIndex = null
  })
}

async function deletePhoto(slotIndex) {
  const photo = _photos[slotIndex]
  if (!photo) return

  try {
    // Remove from Storage
    await supabase.storage
      .from('photos')
      .remove([photo.storage_path])

    // Remove from DB
    const { error } = await supabase
      .from('photos')
      .delete()
      .eq('quest_id', _questId)
      .eq('device_id', _deviceId)
      .eq('slot_index', slotIndex)

    if (error) throw error

    _photos[slotIndex] = null
    renderGrid()

  } catch (err) {
    console.error('[grid] deletePhoto error:', err)
    showToast('Delete failed — please try again.')
  }
}

// ── Image Resizing ────────────────────────────────────────────

/**
 * Resizes an image File to a maximum dimension, returns JPEG Blob.
 * @param {File} file
 * @param {number} maxDim  max width or height in pixels
 * @returns {Promise<Blob>}
 */
function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height / width) * maxDim)
          width  = maxDim
        } else {
          width  = Math.round((width / height) * maxDim)
          height = maxDim
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      }, 'image/jpeg', 0.88)
    }

    img.onerror = reject
    img.src = url
  })
}
