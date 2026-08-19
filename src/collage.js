import { supabase } from './supabase.js'
import { loadAllQuestPhotos } from './state.js'

const CANVAS_SIZE = 1200

/**
 * Generates an artistic mosaic collage from all group photos,
 * uploads it to Supabase Storage, and returns the public URL.
 *
 * @param {string} questId
 * @param {string} promptName
 * @param {string} promptColor
 * @returns {Promise<string|null>}  public URL of the uploaded collage
 */
export async function generateAndUploadCollage(questId, promptName, promptColor) {
  // 1. Load all photos for this quest (all users)
  const photos = await loadAllQuestPhotos(questId)
  if (photos.length === 0) return null

  // 2. Load all images into Image objects
  const images = await loadImages(photos.map(p => p.image_url))
  if (images.length === 0) return null

  // 3. Render artistic collage onto canvas
  const blob = await renderCollage(images, promptName, promptColor)
  if (!blob) return null

  // 4. Upload to Supabase Storage
  const storagePath = `collages/${questId}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    console.error('[collage] upload error:', uploadError)
    return null
  }

  const { data } = supabase.storage.from('photos').getPublicUrl(storagePath)
  return data.publicUrl
}

// ── Image Loading ─────────────────────────────────────────────

async function loadImages(urls) {
  const results = await Promise.allSettled(
    urls.map(url => new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload  = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed: ${url}`))
      img.src = url
    }))
  )

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
}

// ── Collage Rendering ─────────────────────────────────────────

async function renderCollage(images, promptName, promptColor) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width  = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const ctx = canvas.getContext('2d')

    // Background — off-white
    ctx.fillStyle = '#F5F3EE'
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    const count = images.length
    const layouts = computeLayout(count)

    // Draw each photo tile
    for (let i = 0; i < Math.min(count, layouts.length); i++) {
      const img    = images[i]
      const layout = layouts[i]
      drawTile(ctx, img, layout)
    }

    // Overlay: large decorative prompt text at the bottom
    drawPromptOverlay(ctx, promptName, promptColor)

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88)
  })
}

/**
 * Computes positions/sizes for each tile in an artistic mosaic layout.
 * Photos overlap slightly with varied rotation.
 */
function computeLayout(count) {
  const layouts = []
  const tileSize = count <= 4 ? 520 : count <= 9 ? 380 : 280
  const margin   = 80

  // Deterministic pseudo-random positions seeded by index
  for (let i = 0; i < count; i++) {
    const seed = i * 137.5  // golden angle
    const col  = i % 3
    const row  = Math.floor(i / 3)

    const baseX = margin + col * ((CANVAS_SIZE - 2 * margin - tileSize) / 2)
    const baseY = margin + row * ((CANVAS_SIZE - 2 * margin - tileSize) / 2)

    // Add jitter so photos aren't perfectly aligned
    const jitterX = Math.sin(seed) * 30
    const jitterY = Math.cos(seed) * 30
    const rotation = Math.sin(seed * 2.3) * 6  // ±6 degrees

    layouts.push({
      x:        baseX + jitterX,
      y:        baseY + jitterY,
      size:     tileSize + Math.sin(seed * 1.7) * 30,
      rotation,
    })
  }

  return layouts
}

function drawTile(ctx, img, { x, y, size, rotation }) {
  ctx.save()

  // Move to center of tile, rotate, then draw
  ctx.translate(x + size / 2, y + size / 2)
  ctx.rotate((rotation * Math.PI) / 180)

  // Drop shadow
  ctx.shadowColor   = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur    = 20
  ctx.shadowOffsetX = 4
  ctx.shadowOffsetY = 6

  // Rounded rect clip
  roundedRect(ctx, -size / 2, -size / 2, size, size, 16)
  ctx.clip()

  ctx.shadowColor = 'transparent'  // reset shadow inside clip

  // Draw image centered & cropped to square
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight)
  const sw    = img.naturalWidth * scale
  const sh    = img.naturalHeight * scale
  ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh)

  // Subtle border
  ctx.strokeStyle = 'rgba(61,78,26,0.6)'
  ctx.lineWidth   = 3
  roundedRect(ctx, -size / 2, -size / 2, size, size, 16)
  ctx.stroke()

  ctx.restore()
}

function drawPromptOverlay(ctx, promptName, promptColor) {
  const y = CANVAS_SIZE - 100

  // Semi-transparent highlight band
  const grad = ctx.createLinearGradient(0, y - 80, 0, CANVAS_SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = grad
  ctx.fillRect(0, y - 80, CANVAS_SIZE, CANVAS_SIZE - y + 80)

  // Prompt text
  ctx.font         = 'bold 96px Nunito, sans-serif'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = `${promptColor}CC`  // accent color, semi-transparent
  ctx.fillText(promptName, CANVAS_SIZE / 2, y + 10)

  // Subtle white outline for legibility
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth   = 2
  ctx.strokeText(promptName, CANVAS_SIZE / 2, y + 10)
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
