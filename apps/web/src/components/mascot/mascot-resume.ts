const resumeListeners = new Set<() => void>()
let resumeCycle = 0
let resumeAttached = false
let backgrounded = false

function markBackgrounded() {
  backgrounded = true
}

function emitResume() {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden'
  ) {
    return
  }
  if (!backgrounded) return
  backgrounded = false
  resumeCycle += 1
  for (const listener of resumeListeners) listener()
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    markBackgrounded()
    return
  }
  emitResume()
}

function attachResumeListeners() {
  if (resumeAttached || typeof window === 'undefined') return
  resumeAttached = true
  window.addEventListener('blur', markBackgrounded)
  window.addEventListener('pagehide', markBackgrounded)
  window.addEventListener('focus', emitResume)
  window.addEventListener('pageshow', emitResume)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function detachResumeListeners() {
  if (
    !resumeAttached ||
    resumeListeners.size > 0 ||
    typeof window === 'undefined'
  ) {
    return
  }
  resumeAttached = false
  backgrounded = false
  window.removeEventListener('blur', markBackgrounded)
  window.removeEventListener('pagehide', markBackgrounded)
  window.removeEventListener('focus', emitResume)
  window.removeEventListener('pageshow', emitResume)
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

export function subscribeMascotResume(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined
  resumeListeners.add(callback)
  attachResumeListeners()
  return () => {
    resumeListeners.delete(callback)
    detachResumeListeners()
  }
}

export function getMascotResumeCycle() {
  return resumeCycle
}
