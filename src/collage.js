import { supabase } from './supabase.js'
import { loadAllQuestPhotos } from './state.js'

const CANVAS_WIDTH = 1080
const CANVAS_HEIGHT = 1920

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
    canvas.width  = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT
    const ctx = canvas.getContext('2d')

    // Background — white
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    const count = images.length
    
    // Dynamically calculate the best row-based layout (no white space)
    let bestRows = 1;
    let bestScore = Infinity;
    let bestDistribution = [];

    for (let r = 1; r <= count; r++) {
      let score = 0;
      let distribution = [];
      for (let i = 0; i < r; i++) {
        const itemsInRow = Math.floor((i + 1) * count / r) - Math.floor(i * count / r);
        distribution.push(itemsInRow);
      }
      
      // Sort distribution descending so rows with MORE items are at the top,
      // and rows with FEWER items (wider cells) are at the bottom for visual stability.
      distribution.sort((a, b) => b - a);

      for (let i = 0; i < r; i++) {
        const itemsInRow = distribution[i];
        const cellW = CANVAS_WIDTH / itemsInRow;
        const cellH = CANVAS_HEIGHT / r;
        const cellRatio = cellW / cellH;
        const ratioDiff = Math.abs(cellRatio - 0.75);
        score += ratioDiff * itemsInRow;
      }
      
      const avgScore = score / count;
      if (avgScore < bestScore) {
        bestScore = avgScore;
        bestRows = r;
        bestDistribution = distribution;
      }
    }

    // Draw the photos using the best layout
    const tileH = CANVAS_HEIGHT / bestRows;
    let photoIndex = 0;

    for (let r = 0; r < bestRows; r++) {
      const itemsInRow = bestDistribution[r];
      const tileW = CANVAS_WIDTH / itemsInRow;
      const y = r * tileH;
      
      for (let c = 0; c < itemsInRow; c++) {
        const img = images[photoIndex];
        const x = c * tileW;
        drawGridTile(ctx, img, x, y, tileW, tileH);
        photoIndex++;
      }
    }

    // Overlay: prompt text in the middle
    drawPromptOverlay(ctx, promptName, promptColor)

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88)
  })
}

function drawGridTile(ctx, img, x, y, w, h) {
  ctx.save()
  
  // Create clipping path for the grid cell
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  // Calculate scaling to cover the cell (object-fit: cover)
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const sw = img.naturalWidth * scale
  const sh = img.naturalHeight * scale
  
  // Center image
  const dx = x + (w - sw) / 2
  const dy = y + (h - sh) / 2
  
  ctx.drawImage(img, dx, dy, sw, sh)
  ctx.restore()
}

function drawPromptOverlay(ctx, promptName, promptColor) {
  const cx = CANVAS_WIDTH / 2
  const cy = CANVAS_HEIGHT / 2

  ctx.save()
  
  // Start with a smaller base font size
  let fontSize = 100;
  ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`;
  
  // Scale down if text is too wide (leave 200px margin on each side)
  const maxWidth = CANVAS_WIDTH - 400;
  let textWidth = ctx.measureText(promptName).width;
  
  if (textWidth > maxWidth) {
    fontSize = Math.floor(fontSize * (maxWidth / textWidth));
    ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`;
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  
  // 1. Draw dark shadow
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillText(promptName, cx + 5, cy + 8)

  // 2. Draw white outline
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(4, Math.floor(fontSize * 0.08)) // scale outline with font
  ctx.lineJoin = 'round'
  ctx.strokeText(promptName, cx, cy)
  
  // 3. Draw inner colored fill
  ctx.fillStyle = promptColor || '#4169E1'
  ctx.fillText(promptName, cx, cy)

  // Optional subtle inner thin border to match the aesthetic better
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  ctx.strokeText(promptName, cx, cy)

  ctx.restore()
}
