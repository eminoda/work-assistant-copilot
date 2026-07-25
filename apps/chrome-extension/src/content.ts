import type { RecordingEvent } from '@workcopilot/browser-recorder'
import { normalizeMatchText } from '@workcopilot/workflow-engine/html-text'

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
  let highlightEl: HTMLElement | null = null
  let highlightHost: HTMLElement | null = null
  let highlightRoot: ShadowRoot | null = null
  let highlightBoxEl: HTMLElement | null = null
  let highlightBannerEl: HTMLElement | null = null
  const FRAME_ID = 'workcopilot-rec-frame'
  const STYLE_ID = 'workcopilot-rec-frame-style'
  const EXTRACT_STYLE_ID = 'workcopilot-extract-style'
  const EXTRACT_HL_CLASS = 'workcopilot-extract-hl'
  const EXTRACT_HOST_ID = 'workcopilot-extract-host'

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

  function ensureExtractStyles() {
    let style = document.getElementById(EXTRACT_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = EXTRACT_STYLE_ID
      document.documentElement.appendChild(style)
    }
    style.textContent = `
      html.workcopilot-extract-armed,
      html.workcopilot-extract-armed * {
        cursor: crosshair !important;
      }
      .${EXTRACT_HL_CLASS} {
        outline: 2px solid #1ecf9a !important;
        outline-offset: 2px !important;
      }
    `
  }

  function ensureHighlightOverlay() {
    if (highlightHost?.isConnected && highlightRoot && highlightBoxEl && highlightBannerEl) {
      return { box: highlightBoxEl, banner: highlightBannerEl }
    }
    document.getElementById(EXTRACT_HOST_ID)?.remove()
    const host = document.createElement('div')
    host.id = EXTRACT_HOST_ID
    host.setAttribute('aria-hidden', 'true')
    // Isolate from page CSS that may hide/override plain divs.
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'width: 100vw',
      'height: 100vh',
      'z-index: 2147483647',
      'pointer-events: none',
      'overflow: visible',
    ].join(';')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `
      <style>
        .banner {
          position: fixed;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(16, 24, 22, 0.92);
          color: #7be0c8;
          font: 600 13px/1.2 system-ui, sans-serif;
          box-shadow: 0 8px 24px rgba(0,0,0,0.28);
          white-space: nowrap;
        }
        .box {
          position: fixed;
          z-index: 1;
          box-sizing: border-box;
          border: 2px solid #1ecf9a;
          border-radius: 3px;
          background: rgba(30, 207, 154, 0.12);
          box-shadow: 0 0 0 3px rgba(30, 207, 154, 0.25);
          display: none;
        }
      </style>
      <div class="banner" hidden>信息抓取中 — 移动鼠标选择文字，点击确认</div>
      <div class="box"></div>
    `
    const banner = root.querySelector('.banner') as HTMLElement
    const box = root.querySelector('.box') as HTMLElement
    ;(document.documentElement || document.body).appendChild(host)
    highlightHost = host
    highlightRoot = root
    highlightBannerEl = banner
    highlightBoxEl = box
    return { box, banner }
  }

  function setExtractArmedUi(armed: boolean) {
    ensureExtractStyles()
    document.documentElement.classList.toggle('workcopilot-extract-armed', armed)
    const frame = document.getElementById(FRAME_ID) as HTMLElement | null
    if (frame) frame.style.zIndex = armed ? '2147483640' : ''
    if (!armed) {
      clearExtractHighlight()
      highlightHost?.remove()
      highlightHost = null
      highlightRoot = null
      highlightBoxEl = null
      highlightBannerEl = null
      return
    }
    const { banner, box } = ensureHighlightOverlay()
    banner.hidden = false
    // Proof-of-life box at viewport center until the first pointer move.
    box.style.display = 'block'
    box.style.left = 'calc(50% - 40px)'
    box.style.top = '72px'
    box.style.width = '80px'
    box.style.height = '36px'
  }

  function clearExtractHighlight() {
    if (highlightEl) {
      highlightEl.classList.remove(EXTRACT_HL_CLASS)
      highlightEl = null
    }
    if (highlightBoxEl) highlightBoxEl.style.display = 'none'
  }

  function paintExtractHighlight(element: HTMLElement | null, clientX?: number, clientY?: number) {
    const { box } = ensureHighlightOverlay()
    if (element) {
      const rect = element.getBoundingClientRect()
      if (rect.width >= 1 || rect.height >= 1) {
        if (highlightEl !== element) {
          if (highlightEl) highlightEl.classList.remove(EXTRACT_HL_CLASS)
          try { element.classList.add(EXTRACT_HL_CLASS) } catch { /* ignore */ }
          highlightEl = element
        }
        const pad = 3
        box.style.display = 'block'
        box.style.left = `${Math.max(0, rect.left - pad)}px`
        box.style.top = `${Math.max(0, rect.top - pad)}px`
        box.style.width = `${Math.max(rect.width + pad * 2, 12)}px`
        box.style.height = `${Math.max(rect.height + pad * 2, 12)}px`
        return
      }
    }
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      if (highlightEl) {
        highlightEl.classList.remove(EXTRACT_HL_CLASS)
        highlightEl = null
      }
      box.style.display = 'block'
      box.style.left = `${Math.max(0, clientX - 18)}px`
      box.style.top = `${Math.max(0, clientY - 18)}px`
      box.style.width = '36px'
      box.style.height = '36px'
    }
  }

  function elementText(element: HTMLElement) {
    return normalizeMatchText(element.innerText || element.textContent || '').slice(0, 2000)
  }

  function containsPoint(element: HTMLElement, clientX: number, clientY: number) {
    const rect = element.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  /**
   * Shrink wrappers down to the text leaf under the pointer.
   * Prefer the child that actually contains (x,y) — never "shortest text on the row".
   */
  function tightestTextElement(
    element: HTMLElement,
    clientX?: number,
    clientY?: number,
  ): HTMLElement {
    let current = element
    for (let depth = 0; depth < 10; depth += 1) {
      const full = elementText(current)
      if (!full) return current

      let next: HTMLElement | null = null
      const children = [...current.children].filter((child): child is HTMLElement => (
        child instanceof HTMLElement
        && child.getAttribute('aria-hidden') !== 'true'
      ))

      if (typeof clientX === 'number' && typeof clientY === 'number') {
        const underPointer = children.find((child) => (
          containsPoint(child, clientX, clientY) && Boolean(elementText(child))
        ))
        if (underPointer) next = underPointer
      }

      if (!next) {
        for (const child of children) {
          const childText = elementText(child)
          if (!childText) continue
          if (childText === full) {
            next = child
            break
          }
        }
      }

      if (!next) return current
      current = next
    }
    return current
  }

  function isExtractChrome(node: HTMLElement) {
    return node.id === FRAME_ID
      || node.id === EXTRACT_HOST_ID
      || Boolean(node.closest(`#${FRAME_ID}, #${EXTRACT_HOST_ID}`))
  }

  /**
   * Pick the topmost element under the cursor, then tighten to its text leaf.
   * Do NOT rank by shortest label — that wrongly preferred「写邮件」/「孙勇」over subject lines.
   */
  function resolveExtractElement(
    raw: EventTarget | null,
    clientX?: number,
    clientY?: number,
    event?: Event,
  ): HTMLElement | null {
    const hits: HTMLElement[] = []
    const seen = new Set<Element>()
    const pushHit = (node: EventTarget | null | undefined) => {
      if (!(node instanceof HTMLElement)) return
      if (seen.has(node) || isExtractChrome(node)) return
      seen.add(node)
      hits.push(node)
    }

    // elementsFromPoint is topmost-first — trust that order.
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      for (const node of document.elementsFromPoint(clientX, clientY)) pushHit(node)
    }
    if (event && typeof event.composedPath === 'function') {
      for (const node of event.composedPath()) pushHit(node)
    }
    pushHit(raw)
    if (raw instanceof Element) pushHit(raw.parentElement)

    for (const hit of hits) {
      if (!hit.closest('body') || hit === document.body || hit === document.documentElement) continue
      const leaf = tightestTextElement(hit, clientX, clientY)
      if (elementText(leaf)) return leaf
    }

    return hits.find((hit) => hit.closest('body') && hit !== document.body && hit !== document.documentElement) ?? null
  }

  function highlightExtractTarget(raw: EventTarget | null, clientX?: number, clientY?: number, event?: Event) {
    if (!extractArmed || !recordingActive) {
      clearExtractHighlight()
      return
    }
    try {
      const element = resolveExtractElement(raw, clientX, clientY, event)
      paintExtractHighlight(element, clientX, clientY)
    } catch (error) {
      console.warn('[workcopilot] extract highlight failed', error)
      paintExtractHighlight(null, clientX, clientY)
    }
  }

  function captureExtractClick(raw: MouseEvent) {
    if (!recordingActive || !extractArmed) return false
    raw.preventDefault()
    raw.stopPropagation()
    raw.stopImmediatePropagation()
    const element = resolveExtractElement(raw.target, raw.clientX, raw.clientY, raw)
    if (!element) return true
    const text = elementText(element)
    if (!text) return true
    clearExtractHighlight()
    emit({
      type: 'extract',
      url: location.href,
      timestamp: new Date().toISOString(),
      element: snapshot(element, { genericCss: true }),
      extractText: text,
      value: text,
    })
    return true
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
    if (extractArmed && recordingActive) setExtractArmedUi(true)
    else setExtractArmedUi(false)
    syncRecordingFrame()
  }
  function normalizeText(value: string | null | undefined) {
    if (!value) return undefined
    const text = normalizeMatchText(value)
    return text || undefined
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
      /^(?:btn|button|link|submit|input|field|form|modal|dialog|menu|nav|tab|item|card|row|cell|back|close|icon)/i.test(name)
      || /(?:^|-)(?:btn|button|link|submit|input|field)(?:-|$)/i.test(name),
    )
    return preferred || (allowGeneric ? classes[0] : undefined)
  }

  /** Prefer a short, complete label — not the whole card's concatenated copy. */
  function labelText(element: HTMLElement) {
    const aria = normalizeText(element.getAttribute('aria-label'))
    if (aria) return aria
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeText(element.getAttribute('placeholder'))
    }
    const titleEl = element.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')
    if (titleEl) {
      const title = normalizeText(titleEl.textContent)
      if (title) return title
    }

    const raw = element.innerText || element.textContent || ''
    const lines = raw
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    for (const line of lines) {
      if (line.length >= 2 && line.length <= 40) return line
    }

    for (const child of element.children) {
      if (!(child instanceof HTMLElement)) continue
      if (child.getAttribute('aria-hidden') === 'true') continue
      const childText = normalizeText(child.innerText || child.textContent)
      if (childText && childText.length >= 2 && childText.length <= 40) return childText
    }

    // Last resort: first visual line even if longer, never the full multi-block blob.
    if (lines[0]) return lines[0]
    return normalizeText(raw)
  }

  function ownText(element: HTMLElement) {
    return labelText(element)
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

  function selectorFor(element: HTMLElement, options?: { genericCss?: boolean }) {
    const role = element.getAttribute('role')
      || (element.tagName === 'BUTTON' ? 'button' : undefined)
      || (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button') ? 'button' : undefined)
    const stable = stableAttr(element)
    const text = ownText(element)
    const cls = !stable ? meaningfulClass(element, Boolean(options?.genericCss)) : undefined
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
  function snapshot(element: HTMLElement, options?: { genericCss?: boolean }) {
    return {
      tag: element.tagName.toLowerCase(),
      selector: selectorFor(element, options),
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

  const INTERACTIVE_SEL =
    'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="submit"], input[type="button"], summary, [contenteditable="true"]'

  function isNoiseNode(element: Element) {
    const role = element.getAttribute('role')
    if (role === 'tooltip' || role === 'presentation' || role === 'none') return true
    if (element.getAttribute('aria-hidden') === 'true') return true
    return Boolean(element.closest('[role="tooltip"], [aria-hidden="true"]'))
  }

  function looksClickable(element: HTMLElement) {
    if (element.matches(INTERACTIVE_SEL)) return true
    if (element.tabIndex >= 0) return true
    if (typeof element.onclick === 'function' || element.hasAttribute('onclick')) return true
    if ([...element.attributes].some((attr) => /^data-(testid|test-id|id|key)$/i.test(attr.name))) return true
    try {
      if (getComputedStyle(element).cursor === 'pointer') return true
    } catch {
      // ignore
    }
    return false
  }

  function interactiveFrom(target: EventTarget | null) {
    if (!(target instanceof Element)) return undefined
    const preferred = target.closest(INTERACTIVE_SEL) as HTMLElement | null
    if (preferred) return preferred
    if (target instanceof HTMLElement && !isFormField(target) && target.onclick) return target
    return undefined
  }

  /**
   * Prefer a real interactive / pointer host over a deep text leaf (e.g. description inside a tile).
   * Heuristics only — no site-specific class names.
   */
  function clickTargetFrom(target: EventTarget | null): HTMLElement | undefined {
    if (!(target instanceof Element)) return undefined
    const start = isNoiseNode(target)
      ? (target.parentElement ?? target)
      : target

    const preferred = interactiveFrom(start)
    if (preferred) return preferred

    let best: HTMLElement | undefined
    let current: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement
    let depth = 0
    while (current && depth < 8 && current !== document.body && current !== document.documentElement) {
      if (isFormField(current)) break
      if (looksClickable(current)) best = current
      current = current.parentElement
      depth += 1
    }
    if (best) return best

    const host = start.closest('div, span, li, section, article, main') as HTMLElement | null
    if (host && host !== document.body && host !== document.documentElement) {
      if ((host.innerText || host.textContent || '').trim().length > 0 || host.getAttribute('role')) {
        return host
      }
    }
    if (start instanceof HTMLElement && start !== document.body && start !== document.documentElement) {
      return start
    }
    return undefined
  }

  function isSubmitLike(element: HTMLElement) {
    if (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button')) return true
    if (element.tagName === 'BUTTON') return true
    const signal = `${element.className} ${element.id} ${element.textContent || ''}`
    return /login-btn|submit|sign[\s-]?in|登\s*录|登錄|登录/i.test(signal)
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

  const onExtractPointerMove = (raw: PointerEvent | MouseEvent) => {
    if (!extractArmed || !recordingActive) return
    highlightExtractTarget(raw.target, raw.clientX, raw.clientY, raw)
  }
  window.addEventListener('pointermove', onExtractPointerMove, true)
  window.addEventListener('mousemove', onExtractPointerMove, true)
  document.addEventListener('pointermove', onExtractPointerMove, true)

  window.addEventListener('scroll', () => {
    if (!extractArmed || !recordingActive || !highlightEl) return
    try {
      paintExtractHighlight(highlightEl)
    } catch {
      // ignore
    }
  }, true)

  window.addEventListener('pointerdown', (raw) => {
    if (extractArmed && recordingActive) {
      if (captureExtractClick(raw as MouseEvent)) return
    }
    if (!canCapture()) return
    if (raw.button !== 0) return
    const element = clickTargetFrom(raw.target)
    if (!element) return
    if (isFormField(element)) return

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

  window.addEventListener('click', (raw) => {
    if (!extractArmed || !recordingActive) return
    raw.preventDefault()
    raw.stopPropagation()
    raw.stopImmediatePropagation()
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
