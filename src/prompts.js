/**
 * Color Hunt — 50 Visual Prompts
 *
 * Each prompt has:
 *   name  — the "TARGET: ..." text shown in the header
 *   color — accent hex that tints the entire UI for that week
 *
 * ~40 distinct colors across the full spectrum + ~10 iconic
 * visual textures/themes, all photographable in everyday life.
 */

export const PROMPTS = [

  // ── Yellows & Golds ─────────────────────────────────────────
  { name: 'LEMON YELLOW', color: '#D4E000' },
  { name: 'SUNFLOWER YELLOW', color: '#F5C800' },
  { name: 'MUSTARD', color: '#C59A00' },

  // ── Oranges ─────────────────────────────────────────────────
  { name: 'ORANGE', color: '#F97316' },
  { name: 'PEACH', color: '#FDBA74' },
  { name: 'APRICOT', color: '#FCA05A' },

  // ── Reds ────────────────────────────────────────────────────
  { name: 'TOMATO RED', color: '#EF4444' },
  { name: 'CHERRY RED', color: '#DC2626' },
  { name: 'BORDEAUX', color: '#7F1D1D' },

  // ── Pinks ───────────────────────────────────────────────────
  { name: 'HOT PINK', color: '#EC4899' },
  { name: 'BLUSH PINK', color: '#F9A8D4' },
  { name: 'DUSTY ROSE', color: '#D4748C' },

  // ── Purples ─────────────────────────────────────────────────
  { name: 'MAGENTA', color: '#D946EF' },
  { name: 'VIOLET', color: '#8B5CF6' },
  { name: 'DEEP PURPLE', color: '#6D28D9' },
  { name: 'LAVENDER', color: '#C084FC' },

  // ── Blues ───────────────────────────────────────────────────
  { name: 'INDIGO', color: '#4F46E5' },
  { name: 'COBALT BLUE', color: '#1D4ED8' },
  { name: 'OCEAN BLUE', color: '#2B7FDB' },
  { name: 'SKY BLUE', color: '#38BDF8' },
  { name: 'MIDNIGHT NAVY', color: '#1E3A5F' },

  // ── Cyans & Teals ───────────────────────────────────────────
  { name: 'TURQUOISE', color: '#38bdd1' },
  { name: 'TEAL BLUE', color: '#0D9488' },

  // ── Greens ──────────────────────────────────────────────────
  { name: 'MINT GREEN', color: '#2eb483' },
  { name: 'LIME GREEN', color: '#84CC16' },
  { name: 'SAGE GREEN', color: '#7BAF72' },
  { name: 'FOREST GREEN', color: '#166534' },
  { name: 'OLIVE GREEN', color: '#65700C' },

  // ── Neutrals & Browns ───────────────────────────────────────
  { name: 'CARAMEL', color: '#B45309' },
  { name: 'SANDY BEIGE', color: '#C8A96E' },
  { name: 'CREAM WHITE', color: '#D6C9A8' },
  { name: 'SLATE GREY', color: '#64748B' },
  { name: 'CHARCOAL', color: '#374151' },

  // ── Visual Textures (keeps it interesting) ───────────────────
  { name: 'FLORAL PATTERN', color: '#F472B6' },
  { name: 'LEOPARD PRINT', color: '#C2703E' },
]

// ── Accent Color Application ──────────────────────────────────

/**
 * Applies the week's accent color and derives two adaptive companion variables:
 *
 *  --ch-accent       raw accent color (background of pill + badge)
 *  --ch-accent-dark  border color — LIGHTER than accent on dark weeks,
 *                                   DARKER  than accent on light weeks
 *  --ch-accent-text  text color readable on top of --ch-accent
 *                    (light text for dark weeks, dark text for light weeks)
 *
 * @param {string} color  hex color string
 */
export function applyAccentColor(color) {
  const lum = getRelativeLuminance(color)
  const isDark = lum < 0.30

  document.documentElement.style.setProperty('--ch-accent', color)

  if (isDark) {
    document.documentElement.style.setProperty('--ch-accent-dark', shiftLightness(color, +38))
    document.documentElement.style.setProperty('--ch-accent-text', shiftLightness(color, +48))
  } else {
    document.documentElement.style.setProperty('--ch-accent-dark', shiftLightness(color, -24))
    document.documentElement.style.setProperty('--ch-accent-text', shiftLightness(color, -32))
  }

  // --ch-fab-ring: semi-transparent version of the accent for the FAB pulse glow.
  // @keyframes can't read vars that change mid-animation, so we set it on the
  // element directly — the keyframe's var() then picks it up immediately.
  const fabEl = document.getElementById('fab-btn')
  if (fabEl) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    fabEl.style.setProperty('--ch-fab-ring', `rgba(${r},${g},${b},0.22)`)
  }
}

/**
 * WCAG relative luminance (0 = black, 1 = white).
 * Used to decide whether the accent needs light-on-dark or dark-on-light treatment.
 * @param {string} hex
 * @returns {number}
 */
function getRelativeLuminance(hex) {
  const linearize = c => {
    const s = parseInt(hex.slice(c, c + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linearize(1) + 0.7152 * linearize(3) + 0.0722 * linearize(5)
}



/**
 * Picks a random prompt that hasn't been used yet.
 * If all prompts have been used, the cycle resets (only avoiding the very last one).
 *
 * @param {string[]} usedNames  — array of prompt names already used
 * @returns {{ name: string, color: string }}
 */
export function pickNextPrompt(usedNames = []) {
  const usedSet = new Set(usedNames)
  const available = PROMPTS.filter(p => !usedSet.has(p.name))

  // Full cycle complete — start over, only avoid the most recent
  const pool = available.length > 0
    ? available
    : PROMPTS.filter(p => p.name !== usedNames[usedNames.length - 1])

  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Internal: Lightness Shift ─────────────────────────────────

function shiftLightness(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  let h, s, l = (max + min) / 2
  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break
      case gn: h = ((bn - rn) / d + 2) / 6; break
      case bn: h = ((rn - gn) / d + 4) / 6; break
    }
  }
  l = Math.max(0, Math.min(1, l + amount / 100))
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let ro, go, bo
  if (s === 0) { ro = go = bo = l } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    ro = hue2rgb(p, q, h + 1 / 3)
    go = hue2rgb(p, q, h)
    bo = hue2rgb(p, q, h - 1 / 3)
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(ro)}${toHex(go)}${toHex(bo)}`
}
