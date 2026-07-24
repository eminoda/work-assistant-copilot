import type { CookieRecord, RecordingEvent } from '@workcopilot/browser-recorder'

export type RecorderEventPayload = Omit<RecordingEvent, 'id' | 'seq'> & {
  id?: string
  seq?: number
}

export type RecorderState = {
  active: boolean
  paused: boolean
  extractArmed: boolean
  events: RecordingEvent[]
}

export type RecorderMessage =
  | { type: 'recorder.start' }
  | { type: 'recorder.stop' }
  | { type: 'recorder.pause' }
  | { type: 'recorder.resume' }
  | { type: 'recorder.waitNavigation' }
  | { type: 'recorder.armExtract'; armed: boolean }
  | { type: 'recorder.confirmExtract'; label: string; text: string; url: string }
  | { type: 'recorder.event'; event: RecorderEventPayload }
  | { type: 'recorder.status' }
  | { type: 'recorder.extractPending'; text: string; url: string }
  | { type: 'recorder.config'; active: boolean; paused: boolean; extractArmed: boolean }

export type { CookieRecord, RecordingEvent }
