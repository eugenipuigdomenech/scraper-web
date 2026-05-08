const defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8000`
const ACTIVITY_API_URL = (
  import.meta.env.VITE_ACTIVITY_LOGGER_API_URL
  || `${(import.meta.env.VITE_API_URL || defaultApiBase).replace(/\/$/, '')}/api/activity/log`
).trim()
const DEBUG_LOGGER = import.meta.env.DEV || (import.meta.env.VITE_ACTIVITY_LOGGER_DEBUG === '1')
const GOOGLE_SESSION_KEY = 'upc-google-session-id'
let visitSentForCurrentPage = false
const SESSION_ID_KEY = 'scraper-web-session-id'
const SESSION_START_TS_KEY = 'scraper-web-session-start-ts'
const CLICK_COUNT_KEY = 'scraper-web-click-count'
const MAX_URL_LENGTH = 2000
const MAX_REFERRER_LENGTH = 2000

function ensureSessionId() {
  const current = window.sessionStorage.getItem(SESSION_ID_KEY)
  if (current) return current

  const next = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  window.sessionStorage.setItem(SESSION_ID_KEY, next)
  return next
}

function ensureSessionStartTimestamp() {
  const current = window.sessionStorage.getItem(SESSION_START_TS_KEY)
  if (current) return Number(current) || Date.now()
  const now = Date.now()
  window.sessionStorage.setItem(SESSION_START_TS_KEY, String(now))
  return now
}

function getSessionClickCount() {
  return Number(window.sessionStorage.getItem(CLICK_COUNT_KEY) || '0') || 0
}

function setSessionClickCount(value) {
  window.sessionStorage.setItem(CLICK_COUNT_KEY, String(Math.max(0, value)))
}

function truncate(value, maxLength) {
  const text = `${value || ''}`
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength)
}

function getUtmParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    utmSource: params.get('utm_source') || '',
    utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || '',
    utmTerm: params.get('utm_term') || '',
    utmContent: params.get('utm_content') || '',
  }
}

function getGoogleSessionId() {
  let current = window.localStorage.getItem(GOOGLE_SESSION_KEY)
  if (current) return current
  current = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `gsess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  window.localStorage.setItem(GOOGLE_SESSION_KEY, current)
  return current
}

function getBasePayload(eventType) {
  const sessionId = ensureSessionId()
  const sessionStart = ensureSessionStartTimestamp()
  const durationSeconds = Math.max(0, Math.round((Date.now() - sessionStart) / 1000))

  return {
    eventType,
    sessionId,
    url: truncate(window.location.href, MAX_URL_LENGTH),
    path: window.location.pathname,
    title: document.title || '',
    referrer: truncate(document.referrer || 'direct', MAX_REFERRER_LENGTH),
    userAgent: navigator.userAgent || '',
    language: navigator.language || '',
    platform: navigator.platform || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screenWidth: window.screen?.width || null,
    screenHeight: window.screen?.height || null,
    viewportWidth: window.innerWidth || null,
    viewportHeight: window.innerHeight || null,
    durationSeconds,
    clickCount: getSessionClickCount(),
    ...getUtmParams(),
  }
}

async function postPayload(payload) {
  if (!ACTIVITY_API_URL) return

  try {
    if (DEBUG_LOGGER) {
      console.info('[activityLogger] sending event', { activityApiUrl: ACTIVITY_API_URL, payload })
    }
    const response = await fetch(ACTIVITY_API_URL, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Google-Session-Id': getGoogleSessionId(),
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok && DEBUG_LOGGER) {
      const detail = await response.text()
      console.warn('[activityLogger] backend log rejected', response.status, detail)
    }
  } catch (error) {
    console.error('Error registrant activitat:', error)
  }
}

function postPayloadBeaconSafe(payload) {
  if (!ACTIVITY_API_URL) return

  const body = JSON.stringify(payload)
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    navigator.sendBeacon(ACTIVITY_API_URL, blob)
    return
  }

  void fetch(ACTIVITY_API_URL, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Google-Session-Id': getGoogleSessionId(),
    },
    body,
  })
}

function registerClickCounter() {
  const onClick = () => {
    setSessionClickCount(getSessionClickCount() + 1)
  }

  window.addEventListener('click', onClick, { passive: true })
  return () => window.removeEventListener('click', onClick)
}

function registerLeaveTracking() {
  const logLeave = () => {
    postPayloadBeaconSafe(getBasePayload('leave'))
  }

  const onPageHide = () => logLeave()
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') logLeave()
  }

  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

export function setupActivityTracking() {
  if (!ACTIVITY_API_URL) {
    if (DEBUG_LOGGER) console.warn('[activityLogger] disabled: activity API URL is empty')
    return () => {}
  }

  ensureSessionId()
  ensureSessionStartTimestamp()
  if (!window.sessionStorage.getItem(CLICK_COUNT_KEY)) setSessionClickCount(0)

  // React StrictMode in dev mounts components twice; guard to avoid duplicate visit rows.
  if (!visitSentForCurrentPage) {
    visitSentForCurrentPage = true
    void postPayload(getBasePayload('visit'))
  }

  const cleanupClickCounter = registerClickCounter()
  const cleanupLeaveTracking = registerLeaveTracking()

  return () => {
    cleanupClickCounter()
    cleanupLeaveTracking()
  }
}
