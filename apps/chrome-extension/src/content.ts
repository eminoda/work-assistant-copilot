import type { RecordingEvent } from '@workcopilot/browser-recorder'

declare global {
  interface Window {
    __workcopilotRecorderInstalled?: boolean
  }
}

if (!window.__workcopilotRecorderInstalled) {
  window.__workcopilotRecorderInstalled = true
  installRecorder()
}

function installRecorder() {
  const flushed = new WeakSet<Element>()
  let recordingActive = false
  let recordingPaused = false
  let extractArmed = false
  let lastSelectionKey = ''
  const FRAME_ID = 'workcopilot-rec-frame'
  const STYLE_ID = 'workcopilot-rec-frame-style'

  function ensureRecordingFrameStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @property --wc-rec-angle {
        syntax: "<angle>";
        initial-value: 0deg;
        inherits: false;
      }
      #${FRAME_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        border-radius: 0;
      }
      #${FRAME_ID}::before {
        content: "";
        position: absolute;
        inset: 0;
        padding: 3px;
        border-radius: inherit;
        background: conic-gradient(
          from var(--wc-rec-angle),
          #1ecf9a 0deg,
          rgba(30, 207, 154, 0.15) 70deg,
          #7be0c8 140deg,
          rgba(30, 207, 154, 0.2) 210deg,
          #31d3b2 280deg,
          rgba(30, 207, 154, 0.15) 330deg,
          #1ecf9a 360deg
        );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        mask-composite: exclude;
        animation: wc-rec-spin 2.4s linear infinite;
        box-shadow:
          inset 0 0 18px rgba(49, 211, 178, 0.28),
          0 0 14px rgba(49, 211, 178, 0.35);
      }
      #${FRAME_ID}[data-paused="true"]::before {
        animation-play-state: paused;
        filter: grayscale(0.35) opacity(0.55);
      }
      @keyframes wc-rec-spin {
        to { --wc-rec-angle: 360deg; }
      }
    `
    document.documentElement.appendChild(style)
  }

  function syncRecordingFrame() {
    const show = recordingActive
    let frame = document.getElementById(FRAME_ID)
    if (!show) {
      frame?.remove()
      return
    }
    ensureRecordingFrameStyles()
    if (!frame) {
      frame = document.createElement('div')
      frame.id = FRAME_ID
      frame.setAttribute('aria-hidden', 'true')
      ;(document.documentElement || document.body).appendChild(frame)
    }
    frame.dataset.paused = recordingPaused ? 'true' : 'false'
  }

  function applyRecorderConfig(next: { active?: boolean; paused?: boolean; extractArmed?: boolean }) {
    recordingActive = Boolean(next.active)
    recordingPaused = Boolean(next.paused)
    extractArmed = Boolean(next.extractArmed)
    if (!extractArmed) lastSelectionKey = ''
    syncRecordingFrame()
  }
  function normalizeText(value: string | null | undefined) {
    const text = value?.replace(/\s+/g, ' ').trim()
    if (!text || text.length > 80) return undefined
    return text
  }

  function cssEscape(value: string) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
    return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
  }

  function meaningfulClass(element: HTMLElement, allowGeneric = false) {
    const classes = [...element.classList].filter((name) => {
      if (name.length < 3 || name.length > 48) return false
      if (/^(css|sc|emotion|jsx|svelte)-/i.test(name)) return false
      if (/^[a-z]?[a-f0-9]{6,}$/i.test(name)) return false
      if (/^\d/.test(name)) return false
      return true
    })
    const preferred = classes.find((name) =>
      /login|form|modal|dialog|panel|content|main|nav|header|footer|container|wrap|back|btn|button|input|field/i.test(name),
    )
    return preferred || (allowGeneric ? classes[0] : undefined)
  }

  function ownText(element: HTMLElement) {
    const aria = normalizeText(element.getAttribute('aria-label'))
    if (aria) return aria
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeText(element.getAttribute('placeholder'))
    }
    if (element instanceof HTMLButtonElement || element.tagName === 'A' || element.getAttribute('role') === 'button') {
      return normalizeText(element.innerText || element.textContent)
    }
    return normalizeText(element.innerText || element.textContent)
  }

  function stableAttr(element: HTMLElement) {
    return (['data-testid', 'name', 'id'] as const)
      .map((name) => [name, element.getAttribute(name)] as const)
      .find(([, value]) => value)
  }

  function scopeHint(element: HTMLElement) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') return undefined
    const role = element.getAttribute('role')
      || (element.tagName === 'BUTTON' ? 'button' : undefined)
      || (element.tagName === 'FORM' ? 'form' : undefined)
    const stable = stableAttr(element)
    const cls = meaningfulClass(element, true)
    const ariaLabel = normalizeText(element.getAttribute('aria-label'))
    if (!stable && !cls && !role && !ariaLabel) return undefined
    return {
      tag,
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(role ? { role } : {}),
      ...(stable ? { stableAttribute: { name: stable[0], value: stable[1]! } } : {}),
      ...(cls ? { css: `${tag}.${cssEscape(cls)}` } : {}),
    }
  }

  function collectParents(element: HTMLElement, max = 2, maxWalk = 8) {
    const parents: NonNullable<ReturnType<typeof scopeHint>>[] = []
    let current = element.parentElement
    let walked = 0
    while (current && parents.length < max && walked < maxWalk) {
      walked += 1
      if (current.tagName === 'BODY' || current.tagName === 'HTML') break
      const hint = scopeHint(current)
      if (hint) parents.push(hint)
      current = current.parentElement
    }
    return parents
  }

  function selectorFor(element: HTMLElement) {
    const role = element.getAttribute('role')
      || (element.tagName === 'BUTTON' ? 'button' : undefined)
      || (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button') ? 'button' : undefined)
    const stable = stableAttr(element)
    const text = ownText(element)
    const cls = !stable ? meaningfulClass(element, false) : undefined
    const tag = element.tagName.toLowerCase()
    const parents = collectParents(element)
    return {
      ...(element.getAttribute('aria-label') ? { ariaLabel: element.getAttribute('aria-label')! } : {}),
      ...(role ? { role } : {}),
      ...(text ? { text } : {}),
      ...(element.getAttribute('placeholder') ? { placeholder: element.getAttribute('placeholder')! } : {}),
      ...(stable ? { stableAttribute: { name: stable[0], value: stable[1]! } } : {}),
      ...(cls ? { css: `${tag}.${cssEscape(cls)}` } : {}),
      ...(parents.length ? { parents } : {}),
      confidence: stable || role || cls || parents.length ? 0.9 : 0.6,
    }
  }
  function snapshot(element: HTMLElement) {
    return {
      tag: element.tagName.toLowerCase(),
      selector: selectorFor(element),
      attributes: Object.fromEntries(
        [...element.attributes]
          .filter((attribute) => !attribute.name.startsWith('on'))
          .map((attribute) => [attribute.name, attribute.value])
          .slice(0, 30),
      ),
      text: normalizeText(element.innerText || element.textContent)?.slice(0, 500),
      html: element.outerHTML.slice(0, 20_000),
    }
  }

  function isFormField(element: Element) {
    return element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
  }

  function canCapture() {
    return recordingActive && !recordingPaused
  }

  function emit(event: Omit<RecordingEvent, 'id' | 'seq'>) {
    if (!recordingActive) return
    if (!canCapture() && event.type !== 'extract') return
    try {
      void chrome.runtime.sendMessage({
        type: 'recorder.event',
        event: {
          ...event,
          id: crypto.randomUUID(),
          timestamp: event.timestamp || new Date().toISOString(),
        },
      })
    } catch {
      // Extension context invalidated during navigation.
    }
  }

  function emitField(element: HTMLInputElement | HTMLTextAreaElement) {
    if (flushed.has(element)) return
    if (element instanceof HTMLInputElement) {
      const skip = ['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset']
      if (skip.includes(element.type)) return
    }
    const password = element instanceof HTMLInputElement && element.type === 'password'
    if (!password && !element.value) return
    flushed.add(element)
    emit({
      type: 'input',
      url: location.href,
      timestamp: new Date().toISOString(),
      element: snapshot(element),
      ...(password ? { credentialKey: `${location.hostname}.password` } : { value: element.value }),
    })
  }

  function flushFields(root: ParentNode = document) {
    for (const element of root.querySelectorAll('input, textarea')) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        emitField(element)
      }
    }
  }

  function interactiveFrom(target: EventTarget | null) {
    if (!(target instanceof Element)) return undefined
    const preferred = target.closest(
      'button, a, [role="button"], input[type="submit"], input[type="button"], .login-btn, .login-back-btn, [class*="submit"], [class*="login-btn"]',
    ) as HTMLElement | null
    if (preferred) return preferred
    if (target instanceof HTMLElement && !isFormField(target) && target.onclick) return target
    return undefined
  }

  function isSubmitLike(element: HTMLElement) {
    if (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button')) return true
    if (element.tagName === 'BUTTON') return true
    const signal = `${element.className} ${element.id} ${element.textContent || ''}`
    return /login-btn|submit|sign[\s-]?in|登\s*录|登錄|登录/i.test(signal)
  }

  function captureSelection() {
    if (!recordingActive || recordingPaused || !extractArmed) return
    const selection = window.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim()
    if (!text || text.length < 1) return
    const key = `${text}@@${location.href}`
    if (key === lastSelectionKey) return
    lastSelectionKey = key
    emit({
      type: 'extract',
      url: location.href,
      timestamp: new Date().toISOString(),
      extractText: text.slice(0, 2000),
      value: text.slice(0, 2000),
    })
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'recorder.config') return
    applyRecorderConfig(message)
  })

  void chrome.storage.session.get(['recordingActive', 'recordingPaused', 'extractArmed']).then((state) => {
    applyRecorderConfig({
      active: Boolean(state.recordingActive),
      paused: Boolean(state.recordingPaused),
      extractArmed: Boolean(state.extractArmed),
    })
  })

  chrome.storage.session.onChanged.addListener((changes) => {
    if (!changes.recordingActive && !changes.recordingPaused && !changes.extractArmed) return
    applyRecorderConfig({
      active: changes.recordingActive ? Boolean(changes.recordingActive.newValue) : recordingActive,
      paused: changes.recordingPaused ? Boolean(changes.recordingPaused.newValue) : recordingPaused,
      extractArmed: changes.extractArmed ? Boolean(changes.extractArmed.newValue) : extractArmed,
    })
  })

  // SPA / late body: keep frame attached after navigations within the same document.
  const mo = new MutationObserver(() => {
    if (recordingActive && !document.getElementById(FRAME_ID)) syncRecordingFrame()
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('pointerdown', (raw) => {
    if (!canCapture()) return
    if (raw.button !== 0) return
    const element = interactiveFrom(raw.target)
    if (!element) return

    if (!isSubmitLike(element)) {
      emit({
        type: 'click',
        url: location.href,
        timestamp: new Date().toISOString(),
        element: snapshot(element),
      })
      return
    }

    const form = element.closest('form')
    flushFields(form ?? document)
    emit({
      type: 'click',
      url: location.href,
      timestamp: new Date().toISOString(),
      element: snapshot(element),
    })
  }, true)

  window.addEventListener('submit', (raw) => {
    if (!canCapture()) return
    const form = raw.target instanceof HTMLFormElement ? raw.target : undefined
    if (!form) return
    flushFields(form)
    emit({
      type: 'submit',
      url: location.href,
      timestamp: new Date().toISOString(),
      element: snapshot(form),
    })
  }, true)

  document.addEventListener('mouseup', () => {
    window.setTimeout(captureSelection, 0)
  }, true)

  // Hash-router SPAs (Vue/React): fragment changes often skip full document navigation.
  const emitLocationNavigation = () => {
    if (!canCapture()) return
    if (!/^https?:/i.test(location.href)) return
    emit({
      type: 'navigation',
      url: location.href,
      timestamp: new Date().toISOString(),
    })
  }
  window.addEventListener('hashchange', emitLocationNavigation)
  window.addEventListener('popstate', emitLocationNavigation)
}
