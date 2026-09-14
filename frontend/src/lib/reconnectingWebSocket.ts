const INITIAL_DELAY_MS = 500
const MAX_DELAY_MS = 15000

export interface ReconnectingSocketOptions {
  url: string
  onMessage: (data: unknown) => void
  /** Fired after the socket actually opens — good place to fire a one-off
   * REST GET as a safety net against any event missed during the gap. */
  onOpen?: () => void
  onClose?: () => void
}

export interface ReconnectingSocketHandle {
  close: () => void
}

/**
 * Opens `url` and keeps it open, reconnecting with exponential backoff
 * (capped at 15s) whenever the connection drops, until `close()` is called.
 * The backend always sends a fresh snapshot right after accepting a
 * connection, so every (re)connect already delivers current state on its
 * own — `onOpen` is purely an extra safety net on top of that.
 */
export function openReconnectingSocket(options: ReconnectingSocketOptions): ReconnectingSocketHandle {
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function connect() {
    if (closed) return
    socket = new WebSocket(options.url)

    socket.onopen = () => {
      attempt = 0
      options.onOpen?.()
    }
    socket.onmessage = (event) => {
      try {
        options.onMessage(JSON.parse(event.data as string))
      } catch {
        // malformed frame — ignore, next one will be fine
      }
    }
    socket.onclose = scheduleReconnect
    socket.onerror = () => socket?.close()
  }

  function scheduleReconnect() {
    if (closed) return
    options.onClose?.()
    const delay = Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
    attempt += 1
    reconnectTimer = setTimeout(connect, delay)
  }

  connect()

  return {
    close: () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    },
  }
}

export function wsBaseUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}
