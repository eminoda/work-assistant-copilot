import type { RecordingEvent } from '@workcopilot/browser-recorder'

export type RecorderEventPayload = Omit<RecordingEvent, 'id' | 'seq'> & {
  id?: string
  seq?: number
}

export type RecorderMessage =
  | { type: 'recorder.start' }
  | { type: 'recorder.stop' }
  | { type: 'recorder.event'; event: RecorderEventPayload }
  | { type: 'recorder.status'; active: boolean; events: RecordingEvent[] }
