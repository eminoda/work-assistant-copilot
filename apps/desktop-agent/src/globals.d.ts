export {}
declare global {
  interface Window {
    __workcopilotRequest?: <T = unknown>(path: string, options?: RequestInit) => Promise<T>
  }
}
