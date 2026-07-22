import type { RecordingEvent } from '@workcopilot/browser-recorder'
export type RecorderMessage =
  | { type: 'recorder.start' }
  | { type: 'recorder.stop' }
  | { type: 'recorder.event'; event: RecordingEvent }
  | { type: 'recorder.status'; active: boolean; events: RecordingEvent[] }
