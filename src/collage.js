import { supabase } from './supabase.js'
import { loadAllQuestPhotos } from './state.js'

const CANVAS_WIDTH  = 1080
const CANVAS_HEIGHT = 1920
const GAP           = 0   // px gap between tiles

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

// ── Aspect-Ratio–Aware Strip Packing ──────────────────────────
//
// Algorithm (same technique used by Google Photos / Flickr):
//
//  1. Compute each image's aspect ratio  r_i = w / h.
//  2. Pick the number of rows R that minimises total ratio-distortion.
//  3. Partition the image sequence into R contiguous groups using DP so
//     each row's "ideal height" is as uniform as possible.
//  4. For each row: scale all images so they share a common row height
//     and together span exactly CANVAS_WIDTH (minus gaps).
//  5. Draw. No white space, variable tile sizes, minimum cropping.

/**
 * Returns the aspect ratio of an image element.
 */
function ar(img) {
  return img.naturalWidth / img.naturalHeight
}

/**
 * For a set of images sharing a single row of width W, the "natural"
 * common row height is  H = W / Σ(r_i).  The distortion score for
 * each image is how far its cell ratio deviates from its natural ratio
 * (always 0 with this algorithm – each image fills its exact width).
 * We instead score by how extreme the row height is relative to the
 * target row height: we want rows of roughly equal height.
 *
 * @param {HTMLImageElement[]} rowImgs
 * @param {number} targetRowH   ideal row height (CANVAS_HEIGHT / R)
 * @param {number} rowW         usable canvas width
 * @returns {number} cost
 */
function rowCost(rowImgs, targetRowH, rowW) {
  const sumAr = rowImgs.reduce((s, img) => s + ar(img), 0)
  const actualH = rowW / sumAr
  // penalise rows that deviate from the target height
  return Math.abs(Math.log(actualH / targetRowH)) * rowImgs.length
}

/**
 * Dynamic-programming optimal partition of `images` into exactly
 * `numRows` contiguous groups, minimising total rowCost.
 *
 * Returns an array of row arrays (each is a slice of images).
 *
 * For large counts we fall back to a greedy approach to keep it fast.
 */
function partitionIntoRows(images, numRows) {
  const n = images.length

  if (numRows === 1) return [images]
  if (numRows >= n)  return images.map(img => [img])

  // Usable width (subtract gaps between columns; they're per-row)
  const usableW = CANVAS_WIDTH - GAP * (n - 1)  // rough upper bound
  const targetH = CANVAS_HEIGHT / numRows

  // Use greedy for large image counts (>30) for performance
  if (n > 30) {
    return greedyPartition(images, numRows, targetH)
  }

  // DP table:  dp[i][r] = min cost to place first i images into r rows
  const INF = 1e18
  const dp    = Array.from({ length: n + 1 }, () => new Array(numRows + 1).fill(INF))
  const split = Array.from({ length: n + 1 }, () => new Array(numRows + 1).fill(0))

  dp[0][0] = 0

  for (let r = 1; r <= numRows; r++) {
    for (let i = r; i <= n - (numRows - r); i++) {
      for (let j = r - 1; j < i; j++) {
        if (dp[j][r - 1] === INF) continue
        const rowImgs = images.slice(j, i)
        // usable width for this row = total width minus gaps between its images
        const rW = CANVAS_WIDTH - GAP * (rowImgs.length - 1)
        const cost = dp[j][r - 1] + rowCost(rowImgs, targetH, rW)
        if (cost < dp[i][r]) {
          dp[i][r] = cost
          split[i][r] = j
        }
      }
    }
  }

  // Backtrack
  const rows = []
  let i = n, r = numRows
  while (r > 0) {
    const j = split[i][r]
    rows.unshift(images.slice(j, i))
    i = j
    r--
  }
  return rows
}

/**
 * Greedy partition: iteratively assign images to a row until adding
 * the next image would make the row taller than targetH.
 */
function greedyPartition(images, numRows, targetH) {
  const rows = []
  let current = []
  let currentSumAr = 0

  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx]
    const remaining = images.length - idx
    const rowsLeft  = numRows - rows.length

    current.push(img)
    currentSumAr += ar(img)

    const rW = CANVAS_WIDTH - GAP * (current.length - 1)
    const h  = rW / currentSumAr

    // Flush row if: row is full-height or we must finish to have enough rows
    const mustFlush = rowsLeft === remaining
    const wantFlush = h <= targetH || mustFlush

    if (wantFlush && (rowsLeft > 1 || idx === images.length - 1)) {
      rows.push(current)
      current = []
      currentSumAr = 0
    }
  }

  if (current.length > 0) {
    if (rows.length > 0) {
      // Append leftovers to the last row
      rows[rows.length - 1].push(...current)
    } else {
      rows.push(current)
    }
  }

  return rows
}

/**
 * Try row counts from 1 to ceil(sqrt(N)*1.5) and return the count
 * that minimises the total partition cost.
 */
function findOptimalRowCount(images) {
  const n = images.length
  if (n === 1) return 1
  if (n === 2) return 1   // side-by-side looks great for 2

  const maxRows = Math.min(n, Math.ceil(Math.sqrt(n) * 1.8))
  let bestCount = 1
  let bestCost  = Infinity

  for (let r = 1; r <= maxRows; r++) {
    const partition = partitionIntoRows(images, r)
    const targetH   = CANVAS_HEIGHT / r
    let totalCost   = 0
    for (const row of partition) {
      const rW = CANVAS_WIDTH - GAP * (row.length - 1)
      totalCost += rowCost(row, targetH, rW)
    }
    if (totalCost < bestCost) {
      bestCost  = totalCost
      bestCount = r
    }
  }

  return bestCount
}

// ── Collage Rendering ─────────────────────────────────────────

async function renderCollage(images, promptName, promptColor) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas')
    canvas.width  = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext('2d')

    // Dark background — eliminates any potential fringe pixels
    ctx.fillStyle = '#111111'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // ── 1. Find the best row count ────────────────────────────
    const numRows  = findOptimalRowCount(images)
    const partition = partitionIntoRows(images, numRows)

    // ── 2. Calculate each row's actual height ─────────────────
    // We first compute the "natural" height of each row given the canvas
    // width, then scale all row heights so they sum to CANVAS_HEIGHT.
    const naturalHeights = partition.map(rowImgs => {
      const sumAr = rowImgs.reduce((s, img) => s + ar(img), 0)
      const rW    = CANVAS_WIDTH - GAP * (rowImgs.length - 1)
      return rW / sumAr   // h = w / Σr
    })

    const totalNatural = naturalHeights.reduce((s, h) => s + h, 0)
    // Account for vertical gaps between rows
    const totalGaps    = GAP * (partition.length - 1)
    const scaleFactor  = (CANVAS_HEIGHT - totalGaps) / totalNatural
    const rowHeights   = naturalHeights.map(h => h * scaleFactor)

    // ── 3. Draw each row ──────────────────────────────────────
    let y = 0
    for (let r = 0; r < partition.length; r++) {
      const rowImgs = partition[r]
      const rowH    = rowHeights[r]

      // Width of each image = proportional to its aspect ratio
      const sumAr = rowImgs.reduce((s, img) => s + ar(img), 0)
      const usableW = CANVAS_WIDTH - GAP * (rowImgs.length - 1)

      let x = 0
      for (let c = 0; c < rowImgs.length; c++) {
        const img  = rowImgs[c]
        const tileW = (ar(img) / sumAr) * usableW

        drawTile(ctx, img, x, y, tileW, rowH)
        x += tileW + GAP
      }

      y += rowH + GAP
    }

    // ── 4. Overlay: prompt text in the middle ─────────────────
    drawPromptOverlay(ctx, promptName, promptColor)

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.90)
  })
}

// ── Tile Drawing ──────────────────────────────────────────────

/**
 * Draws `img` into the rectangle (x, y, w, h) using object-fit:cover
 * semantics — centred, scaled to fill, minimal cropping.
 */
function drawTile(ctx, img, x, y, w, h) {
  ctx.save()

  // Clip to exact tile boundary
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  // Scale to cover the tile while preserving aspect ratio
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw    = img.naturalWidth  * scale
  const sh    = img.naturalHeight * scale

  // Centre the image within the tile
  const dx = x + (w - sw) / 2
  const dy = y + (h - sh) / 2

  ctx.drawImage(img, dx, dy, sw, sh)
  ctx.restore()
}

// ── Prompt Overlay ────────────────────────────────────────────

function drawPromptOverlay(ctx, promptName, promptColor) {
  const cx = CANVAS_WIDTH  / 2
  const cy = CANVAS_HEIGHT / 2

  ctx.save()

  // Start with a smaller base font size
  let fontSize = 140
  ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`

  // Scale down if text is too wide (leave 200px margin on each side)
  const maxWidth = CANVAS_WIDTH - 400
  let textWidth  = ctx.measureText(promptName).width

  if (textWidth > maxWidth) {
    fontSize = Math.floor(fontSize * (maxWidth / textWidth))
    ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`
  }

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'

  // 1. Draw dark shadow
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillText(promptName, cx + 5, cy + 8)

  // 2. Draw white outline
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth   = Math.max(4, Math.floor(fontSize * 0.08))
  ctx.lineJoin    = 'round'
  ctx.strokeText(promptName, cx, cy)

  // 3. Draw inner coloured fill
  ctx.fillStyle = promptColor || '#4169E1'
  ctx.fillText(promptName, cx, cy)

  // 4. Subtle thin black border to crisp up edges
  ctx.strokeStyle = '#000000'
  ctx.lineWidth   = 2
  ctx.strokeText(promptName, cx, cy)

  ctx.restore()
}
