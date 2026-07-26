import { serve } from '@hono/node-server'
import type { Server as HttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createApp, createServices } from './app.js'

async function main() {
  const host = process.env.WORKCOPILOT_HOST || '127.0.0.1'
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('WorkCopilot only permits loopback binding')
  const port = Number(process.env.WORKCOPILOT_PORT || 4317)
  const services = await createServices()
  await services.store.connect()
  const app = createApp(services)
  const server = serve({ fetch: app.fetch, hostname: host, port }, ({ port }) => {
    console.log(`WorkCopilot Runtime listening on http://${host}:${port}`)
  })
  const webSockets = new WebSocketServer({ server: server as HttpServer, path: '/ws/events' })
  webSockets.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/ws/events', `http://${host}:${port}`)
    if (url.searchParams.get('token') !== services.token) {
      socket.close(1008, 'Unauthorized')
      return
    }
    const unsubscribe = services.events.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
  })

  async function shutdown() {
    webSockets.close()
    server.close()
    await services.browser.close()
    await services.store.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error) => {
  console.error('WorkCopilot Runtime failed to start', error)
  process.exit(1)
})
