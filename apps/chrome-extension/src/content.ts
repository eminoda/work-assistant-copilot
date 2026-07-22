import type { RecordingEvent } from '@workcopilot/browser-recorder'

function selectorFor(element: HTMLElement) {
  const role = element.getAttribute('role') || (element.tagName === 'BUTTON' ? 'button' : undefined)
  const stable = ['data-testid', 'name', 'id'].map((name) => [name, element.getAttribute(name)] as const).find(([, value]) => value)
  return {
    ...(element.getAttribute('aria-label') ? { ariaLabel: element.getAttribute('aria-label')! } : {}),
    ...(role ? { role } : {}),
    ...(element.textContent?.trim() ? { text: element.textContent.trim().slice(0, 160) } : {}),
    ...(element.getAttribute('placeholder') ? { placeholder: element.getAttribute('placeholder')! } : {}),
    ...(stable ? { stableAttribute: { name: stable[0], value: stable[1]! } } : {}),
    confidence: stable || role ? 0.9 : 0.6,
  }
}
function snapshot(element: HTMLElement) {
  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
    attributes: Object.fromEntries([...element.attributes].filter((attribute) => !attribute.name.startsWith('on')).map((attribute) => [attribute.name, attribute.value]).slice(0, 30)),
    text: element.textContent?.trim().slice(0, 500),
    html: element.outerHTML.slice(0, 20_000),
  }
}
function emit(event: Omit<RecordingEvent, 'id'>) {
  void chrome.runtime.sendMessage({ type: 'recorder.event', event })
}
window.addEventListener('click', (raw) => {
  const element = raw.target instanceof HTMLElement ? raw.target : undefined
  if (element) emit({ type: 'click', url: location.href, timestamp: new Date().toISOString(), element: snapshot(element) })
}, true)
window.addEventListener('change', (raw) => {
  const element = raw.target instanceof HTMLInputElement || raw.target instanceof HTMLTextAreaElement ? raw.target : undefined
  if (!element) return
  const password = element instanceof HTMLInputElement && element.type === 'password'
  emit({
    type: 'input', url: location.href, timestamp: new Date().toISOString(), element: snapshot(element),
    ...(password ? { credentialKey: `${location.hostname}.password` } : { value: element.value }),
  })
}, true)
window.addEventListener('submit', (raw) => {
  const element = raw.target instanceof HTMLElement ? raw.target : undefined
  if (element) emit({ type: 'submit', url: location.href, timestamp: new Date().toISOString(), element: snapshot(element) })
}, true)
emit({ type: 'navigation', url: location.href, timestamp: new Date().toISOString() })
