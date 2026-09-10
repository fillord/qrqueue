const LAST_TICKET_KEY = 'queue.lastTicketId'

export function rememberTicketId(id: string): void {
  try {
    localStorage.setItem(LAST_TICKET_KEY, id)
  } catch {
    // private browsing / storage disabled — nothing to persist, harmless
  }
}

export function forgetTicketId(): void {
  try {
    localStorage.removeItem(LAST_TICKET_KEY)
  } catch {
    // ignore
  }
}
