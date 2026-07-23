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

  function normalizeText(value: string | null | undefined) {
    const text = value?.replace(/\s+/g, ' ').trim()
    if (!text || text.length > 80) return undefined
    return text
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

  function selectorFor(element: HTMLElement) {
    const role = element.getAttribute('role')
      || (element.tagName === 'BUTTON' ? 'button' : undefined)
      || (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button') ? 'button' : undefined)
    const stable = (['data-testid', 'name', 'id'] as const)
      .map((name) => [name, element.getAttribute(name)] as const)
      .find(([, value]) => value)
    const text = ownText(element)
    return {
      ...(element.getAttribute('aria-label') ? { ariaLabel: element.getAttribute('aria-label')! } : {}),
      ...(role ? { role } : {}),
      ...(text ? { text } : {}),
      ...(element.getAttribute('placeholder') ? { placeholder: element.getAttribute('placeholder')! } : {}),
      ...(stable ? { stableAttribute: { name: stable[0], value: stable[1]! } } : {}),
      confidence: stable || role ? 0.9 : 0.6,
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

  function emit(event: Omit<RecordingEvent, 'id' | 'seq'>) {
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

  // Do NOT listen to blur/change for inputs: focusing away to click "返回" would
  // emit inputs before the click and invert the real action order.
  // Capture field values only right before submit-like clicks / form submit.

  window.addEventListener('pointerdown', (raw) => {
    if (raw.button !== 0) return
    const element = interactiveFrom(raw.target)
    if (!element) return

    // Click first for non-submit controls (e.g. 返回), so they stay before later inputs.
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
}
