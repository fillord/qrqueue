import i18n from 'i18next'

export class ApiError extends Error {
  status: number
  code: string
  ticketId?: string
  row?: number
  lastKind?: 'in' | 'out'
  retryAt?: string
  employeeName?: string

  constructor(status: number, code: string, ticketId?: string, row?: number,
    attendance?: { lastKind?: 'in' | 'out'; retryAt?: string; employeeName?: string }) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.ticketId = ticketId
    this.row = row
    this.lastKind = attendance?.lastKind
    this.retryAt = attendance?.retryAt
    this.employeeName = attendance?.employeeName
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function parseErrorDetail(response: Response): Promise<{ code: string; ticketId?: string; row?: number; lastKind?: 'in' | 'out'; retryAt?: string; employeeName?: string }> {
  try {
    const body: unknown = await response.json()
    const detail = isRecord(body) ? body.detail : undefined

    if (typeof detail === 'string') {
      return { code: detail }
    }
    if (isRecord(detail)) {
      const code = typeof detail.code === 'string' ? detail.code : 'unknown_error'
      const ticketId = typeof detail.ticket_id === 'string' ? detail.ticket_id : undefined
      const row = typeof detail.row === 'number' ? detail.row : undefined
      const lastKind = detail.last_kind === 'in' || detail.last_kind === 'out' ? detail.last_kind : undefined
      const retryAt = typeof detail.retry_at === 'string' ? detail.retry_at : undefined
      const employeeName = typeof detail.employee_name === 'string' ? detail.employee_name : undefined
      return { code, ticketId, row, lastKind, retryAt, employeeName }
    }
  } catch {
    // response body wasn't JSON — fall through to the generic code
  }
  return { code: 'unknown_error' }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': i18n.language || 'ru', ...(init?.headers ?? {}) },
  })

  if (!response.ok) {
    const { code, ticketId, row, lastKind, retryAt, employeeName } = await parseErrorDetail(response)
    if (response.status === 401 && !new Headers(init?.headers).has('X-Queue-Kiosk-Token')) {
      window.dispatchEvent(new Event('api:unauthorized'))
    }
    throw new ApiError(response.status, code, ticketId, row, { lastKind, retryAt, employeeName })
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export function apiGet<T>(path: string, headers?: HeadersInit, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { headers, signal })
}

export function apiPost<T>(path: string, body?: unknown, headers?: HeadersInit, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers,
    signal,
  })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function apiPutBinary<T>(path: string, body: Blob): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': body.type },
  })
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
