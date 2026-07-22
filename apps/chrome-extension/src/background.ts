import type { RecordingEvent } from '@workcopilot/browser-recorder'
import type { RecorderMessage } from './types'

let active = false
let events: RecordingEvent[] = []
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId })
})
chrome.runtime.onMessage.addListener((message: RecorderMessage, _sender, sendResponse) => {
  if (message.type === 'recorder.start') { active = true; events = []; sendResponse({ active, events }) }
  if (message.type === 'recorder.stop') { active = false; sendResponse({ active, events }) }
  if (message.type === 'recorder.event' && active) { events.push(message.event); void chrome.storage.session.set({ recordingEvents: events }) }
  if (message.type === 'recorder.status') sendResponse({ active, events })
  return true
})
