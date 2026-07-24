import type { CookieRecord, RecordingEvent } from '@workcopilot/browser-recorder'
import type { RecorderMessage } from './types'

const WAIT_TIMEOUT_MS = 90_000

let active = false
let paused = false
let extractArmed = false
let events: RecordingEvent[] = []
let seq = 0
let lastNavigationKey = ''
let lastHttpUrl = ''
let activeTabId: number | undefined
const touchedOrigins = new Set<string>()
let cookieFlushTimer: ReturnType<typeof setTimeout> | undefined
/** When set, the next navigation fills expectedUrl on this wait event. */
let pendingWaitEventId: string | undefined

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId })
})

function sortEvents(list: RecordingEvent[]) {
  return [...list].sort((left, right) => {
    const seqDelta = (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER)
    if (seqDelta !== 0) return seqDelta
    return left.timestamp.localeCompare(right.timestamp)
  })
}

function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:/i.test(url))
}

function navigationKey(url: string) {
  try {
    const parsed = new URL(url)
    let hash = parsed.hash
    if (hash === '#' || hash === '#/') hash = ''
    parsed.hash = hash
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

function rememberOrigin(url: string) {
  try {
    touchedOrigins.add(new URL(url).origin)
  } catch {
    // ignore
  }
}

function mapSameSite(value: string | undefined): CookieRecord['sameSite'] {
  if (value === 'strict') return 'Strict'
  if (value === 'lax') return 'Lax'
  if (value === 'no_restriction') return 'None'
  return undefined
}

function toCookieRecord(cookie: chrome.cookies.Cookie): CookieRecord {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    ...(cookie.expirationDate ? { expires: cookie.expirationDate } : {}),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(mapSameSite(cookie.sameSite) ? { sameSite: mapSameSite(cookie.sameSite) } : {}),
  }
}

function sessionCredentialKey(url: string) {
  try {
    return `${new URL(url).hostname}.session`
  } catch {
    return 'unknown.session'
  }
}

function persistState() {
  void chrome.storage.session.set({
    recordingEvents: events,
    recordingActive: active,
    recordingPaused: paused,
    extractArmed,
    activeTabId,
  })
}

function broadcastStatus() {
  void chrome.runtime.sendMessage({
    type: 'recorder.status',
    active,
    paused,
    extractArmed,
    events: sortEvents(events),
  }).catch(() => undefined)
}

function pushEvent(partial: Omit<RecordingEvent, 'id' | 'seq'> & { id?: string; seq?: number }) {
  if (!active) return
  if (paused && partial.type !== 'waitNavigation' && partial.type !== 'extract') return

  if (partial.type === 'navigation' || (partial.type === 'tab' && partial.tabAction !== 'removed')) {
    const key = navigationKey(partial.url)
    if (key === lastNavigationKey) return
    lastNavigationKey = key
    lastHttpUrl = partial.url
    rememberOrigin(partial.url)

    if (pendingWaitEventId) {
      const wait = events.find((event) => event.id === pendingWaitEventId && event.type === 'waitNavigation')
      if (wait && partial.url !== wait.fromUrl) {
        wait.expectedUrl = partial.url
        pendingWaitEventId = undefined
        persistState()
        broadcastStatus()
      }
    }
  }

  if (partial.type === 'cookies') {
    rememberOrigin(partial.url)
    const hostKey = sessionCredentialKey(partial.url)
    const index = [...events].reverse().findIndex(
      (event) => event.type === 'cookies' && event.cookieCredentialKey === hostKey,
    )
    const resolvedIndex = index >= 0 ? events.length - 1 - index : -1
    const event: RecordingEvent = {
      ...partial,
      id: partial.id || crypto.randomUUID(),
      seq: resolvedIndex >= 0 ? events[resolvedIndex]!.seq! : ++seq,
      timestamp: partial.timestamp || new Date().toISOString(),
      cookieCredentialKey: partial.cookieCredentialKey || hostKey,
    }
    if (resolvedIndex >= 0) events[resolvedIndex] = event
    else events.push(event)
    persistState()
    broadcastStatus()
    return
  }

  const event: RecordingEvent = {
    ...partial,
    id: partial.id || crypto.randomUUID(),
    seq: ++seq,
    timestamp: partial.timestamp || new Date().toISOString(),
  }
  events.push(event)
  persistState()
  broadcastStatus()
}

async function snapshotCookiesForUrl(url: string) {
  if (!isHttpUrl(url)) return
  const list = await chrome.cookies.getAll({ url })
  if (!list.length) return
  pushEvent({
    type: 'cookies',
    url,
    timestamp: new Date().toISOString(),
    cookies: list.map(toCookieRecord),
    cookieCredentialKey: sessionCredentialKey(url),
    ...(activeTabId !== undefined ? { tabId: activeTabId } : {}),
  })
}

async function snapshotTouchedOrigins() {
  const origins = [...touchedOrigins]
  if (lastHttpUrl) rememberOrigin(lastHttpUrl)
  for (const origin of origins.length ? origins : lastHttpUrl ? [new URL(lastHttpUrl).origin] : []) {
    await snapshotCookiesForUrl(`${origin}/`)
  }
}

function scheduleCookieSnapshot(url?: string) {
  if (cookieFlushTimer) clearTimeout(cookieFlushTimer)
  cookieFlushTimer = setTimeout(() => {
    void (url ? snapshotCookiesForUrl(url) : snapshotTouchedOrigins())
  }, 400)
}

async function captureCurrentNavigation() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !isHttpUrl(tab.url)) return
  activeTabId = tab.id
  pushEvent({ type: 'navigation', url: tab.url, timestamp: new Date().toISOString(), tabId: tab.id })
  scheduleCookieSnapshot(tab.url)
}

async function ensureContentScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await chrome.tabs.sendMessage(tabId, {
      type: 'recorder.config',
      active,
      paused,
      extractArmed,
    }).catch(() => undefined)
  } catch {
    // Restricted pages cannot be scripted.
  }
}

async function syncContentConfig() {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id === undefined || !isHttpUrl(tab.url)) continue
    await chrome.tabs.sendMessage(tab.id, {
      type: 'recorder.config',
      active,
      paused,
      extractArmed,
    }).catch(() => undefined)
  }
}

async function recordTabChange(
  tabId: number,
  tabAction: 'activated' | 'created' | 'removed',
  url?: string,
) {
  if (!active || paused) return
  if (tabAction === 'removed') {
    if (!lastHttpUrl) return
    pushEvent({
      type: 'tab',
      tabAction,
      tabId,
      url: lastHttpUrl,
      timestamp: new Date().toISOString(),
    })
    return
  }
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  const resolved = url || tab?.url
  if (!isHttpUrl(resolved)) return
  activeTabId = tabId
  await ensureContentScript(tabId)
  pushEvent({
    type: 'tab',
    tabAction,
    tabId,
    url: resolved,
    timestamp: new Date().toISOString(),
  })
  scheduleCookieSnapshot(resolved)
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!active || paused || details.frameId !== 0) return
  if (!isHttpUrl(details.url)) return
  pushEvent({
    type: 'navigation',
    url: details.url,
    tabId: details.tabId,
    timestamp: new Date().toISOString(),
  })
  scheduleCookieSnapshot(details.url)
})

/** SPA hash / fragment updates (e.g. /selfcare/#/appList) — not always in onCommitted. */
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  if (!active || paused || details.frameId !== 0) return
  if (!isHttpUrl(details.url)) return
  pushEvent({
    type: 'navigation',
    url: details.url,
    tabId: details.tabId,
    timestamp: new Date().toISOString(),
  })
  scheduleCookieSnapshot(details.url)
})

/** SPA history.pushState / replaceState URL updates. */
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (!active || paused || details.frameId !== 0) return
  if (!isHttpUrl(details.url)) return
  pushEvent({
    type: 'navigation',
    url: details.url,
    tabId: details.tabId,
    timestamp: new Date().toISOString(),
  })
  scheduleCookieSnapshot(details.url)
})

chrome.webNavigation.onCompleted.addListener((details) => {
  if (!active || paused || details.frameId !== 0) return
  if (!isHttpUrl(details.url)) return
  scheduleCookieSnapshot(details.url)
})

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!active || paused || changeInfo.removed) return
  const domain = changeInfo.cookie.domain.replace(/^\./, '')
  const scheme = changeInfo.cookie.secure ? 'https' : 'http'
  scheduleCookieSnapshot(`${scheme}://${domain}${changeInfo.cookie.path || '/'}`)
})

chrome.tabs.onActivated.addListener((info) => {
  void recordTabChange(info.tabId, 'activated')
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined) return
  void recordTabChange(tab.id, 'created', tab.pendingUrl || tab.url)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void recordTabChange(tabId, 'removed')
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!active || paused) return
  if (changeInfo.status === 'complete' && tab.active && isHttpUrl(tab.url)) {
    void ensureContentScript(tabId)
    scheduleCookieSnapshot(tab.url)
  }
})

chrome.runtime.onMessage.addListener((message: RecorderMessage, sender, sendResponse) => {
  if (message.type === 'recorder.start') {
    void (async () => {
      active = true
      paused = false
      extractArmed = false
      pendingWaitEventId = undefined
      events = []
      seq = 0
      lastNavigationKey = ''
      lastHttpUrl = ''
      activeTabId = undefined
      touchedOrigins.clear()
      persistState()
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        activeTabId = tab.id
        await ensureContentScript(tab.id)
      }
      await captureCurrentNavigation()
      const payload = { active, paused, extractArmed, events: sortEvents(events) }
      sendResponse(payload)
      broadcastStatus()
    })()
    return true
  }

  if (message.type === 'recorder.stop') {
    void (async () => {
      if (cookieFlushTimer) clearTimeout(cookieFlushTimer)
      await snapshotTouchedOrigins()
      active = false
      paused = false
      extractArmed = false
      pendingWaitEventId = undefined
      persistState()
      await syncContentConfig()
      const ordered = sortEvents(events)
      events = ordered
      sendResponse({ active, paused, extractArmed, events: ordered })
      broadcastStatus()
    })()
    return true
  }

  if (message.type === 'recorder.pause') {
    paused = true
    persistState()
    void syncContentConfig()
    sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    broadcastStatus()
    return false
  }

  if (message.type === 'recorder.resume') {
    paused = false
    persistState()
    void syncContentConfig()
    sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    broadcastStatus()
    return false
  }

  if (message.type === 'recorder.waitNavigation') {
    void (async () => {
      if (!active) {
        sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
        return
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const url = (isHttpUrl(tab?.url) ? tab.url : lastHttpUrl) || 'https://example.invalid/'
      const id = crypto.randomUUID()
      pendingWaitEventId = id
      pushEvent({
        id,
        type: 'waitNavigation',
        url,
        fromUrl: url,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        timestamp: new Date().toISOString(),
        ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
      })
      sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    })()
    return true
  }

  if (message.type === 'recorder.armExtract') {
    extractArmed = message.armed
    persistState()
    void syncContentConfig()
    sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    broadcastStatus()
    return false
  }

  if (message.type === 'recorder.confirmExtract') {
    pushEvent({
      type: 'extract',
      url: message.url,
      timestamp: new Date().toISOString(),
      extractLabel: message.label,
      extractText: message.text,
      value: message.text,
    })
    extractArmed = false
    persistState()
    void syncContentConfig()
    sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    return false
  }

  if (message.type === 'recorder.event') {
    if (message.event.type === 'extract' && !message.event.extractLabel) {
      // Forward unnamed extract to side panel for naming.
      void chrome.runtime.sendMessage({
        type: 'recorder.extractPending',
        text: message.event.extractText || message.event.value || '',
        url: message.event.url,
      }).catch(() => undefined)
      extractArmed = false
      persistState()
      void syncContentConfig()
      return false
    }
    const { seq: _ignored, ...rest } = message.event
    pushEvent({
      ...rest,
      ...(sender.tab?.id !== undefined ? { tabId: rest.tabId ?? sender.tab.id } : {}),
    })
    if (rest.url) rememberOrigin(rest.url)
    return false
  }

  if (message.type === 'recorder.status') {
    sendResponse({ active, paused, extractArmed, events: sortEvents(events) })
    return false
  }

  return false
})
