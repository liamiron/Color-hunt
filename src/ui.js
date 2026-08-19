/**
 * Shared UI utilities — toast notifications and misc helpers.
 */

let _toastTimer = null
const toastEl   = document.getElementById('toast')

/**
 * Shows a transient toast message at the bottom of the screen.
 * @param {string} message
 * @param {number} duration  ms before auto-hide
 */
export function showToast(message, duration = 3000) {
  if (!toastEl) return
  toastEl.textContent = message
  toastEl.hidden = false

  // Force reflow so transition plays
  void toastEl.offsetWidth
  toastEl.classList.add('toast--visible')

  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => {
    toastEl.classList.remove('toast--visible')
    setTimeout(() => { toastEl.hidden = true }, 300)
  }, duration)
}
