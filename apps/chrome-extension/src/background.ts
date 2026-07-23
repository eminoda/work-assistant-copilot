import type { CookieRecord, RecordingEvent } from '@workcopilot/browser-recorder'
import type { RecorderMessage } from './types'

let active = false
let events: RecordingEvent[] = []
let seq = 0
let lastNavigationKey = ''
let lastHttpUrl = ''
let activeTabId: number | undefined
const touchedOrigins = new Set<string>()
let cookieFlushTimer: ReturnType<typeof setTimeout> | undefined

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

function pushEvent(partial: Omit<RecordingEvent, 'id' | 'seq'> & { id?: string; seq?: number }) {
  if (!active) return

  if (partial.type === 'navigation' || (partial.type === 'tab' && partial.tabAction !== 'removed')) {
    const key = navigationKey(partial.url)
    if (key === lastNavigationKey) return
    lastNavigationKey = key
    lastHttpUrl = partial.url
    rememberOrigin(partial.url)
  }

  if (partial.type === 'cookies') {
    rememberOrigin(partial.url)
    // Replace the previous cookies snapshot for the same host instead of stacking noise.
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
    void chrome.storage.session.set({ recordingEvents: events, recordingActive: active, activeTabId })
    return
  }

  const event: RecordingEvent = {
    ...partial,
    id: partial.id || crypto.randomUUID(),
    seq: ++seq,
    timestamp: partial.timestamp || new Date().toISOString(),
  }
  events.push(event)
  void chrome.storage.session.set({ recordingEvents: events, recordingActive: active, activeTabId })
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
  } catch {
    // Restricted pages cannot be scripted.
  }
}

async function recordTabChange(
  tabId: number,
  tabAction: 'activated' | 'created' | 'removed',
  url?: string,
) {
  if (!active) return
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
  if (!active || details.frameId !== 0) return
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
  if (!active || details.frameId !== 0) return
  if (!isHttpUrl(details.url)) return
  scheduleCookieSnapshot(details.url)
})

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (!active || changeInfo.removed) return
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
  if (!active) return
  if (changeInfo.status === 'complete' && tab.active && isHttpUrl(tab.url)) {
    void ensureContentScript(tabId)
    scheduleCookieSnapshot(tab.url)
  }
})

chrome.runtime.onMessage.addListener((message: RecorderMessage, sender, sendResponse) => {
  if (message.type === 'recorder.start') {
    void (async () => {
      active = true
      events = []
      seq = 0
      lastNavigationKey = ''
      lastHttpUrl = ''
      activeTabId = undefined
      touchedOrigins.clear()
      await chrome.storage.session.set({ recordingActive: true, recordingEvents: [] })
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        activeTabId = tab.id
        await ensureContentScript(tab.id)
      }
      await captureCurrentNavigation()
      sendResponse({ active, events: sortEvents(events) })
    })()
    return true
  }

  if (message.type === 'recorder.stop') {
    void (async () => {
      if (cookieFlushTimer) clearTimeout(cookieFlushTimer)
      await snapshotTouchedOrigins()
      active = false
      void chrome.storage.session.set({ recordingActive: false })
      const ordered = sortEvents(events)
      events = ordered
      sendResponse({ active, events: ordered })
    })()
    return true
  }

  if (message.type === 'recorder.event') {
    const { seq: _ignored, ...rest } = message.event
    pushEvent({
      ...rest,
      ...(sender.tab?.id !== undefined ? { tabId: rest.tabId ?? sender.tab.id } : {}),
    })
    if (rest.url) rememberOrigin(rest.url)
    return false
  }

  if (message.type === 'recorder.status') {
    sendResponse({ active, events: sortEvents(events) })
    return false
  }

  return false
})
