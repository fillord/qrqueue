import i18n from 'i18next'

export class ApiError extends Error {
  status: number
  code: string
  ticketId?: string
  row?: number

  constructor(status: number, code: string, ticketId?: string, row?: number) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.ticketId = ticketId
    this.row = row
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function parseErrorDetail(response: Response): Promise<{ code: string; ticketId?: string }> {
  try {
    const body: unknown = await response.json()
    const detail = isRecord(body) ? body.detail : undefined

    if (typeof detail === 'string') {
      return { code: detail }
    }
    if (isRecord(detail)) {
      const code = typeof detail.code === 'string' ? detail.code : 'unknown_error'
      const ticketId = typeof detail.ticket_id === 'string' ? detail.ticket_id : undefined
      return { code, ticketId }
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
    const { code, ticketId } = await parseErrorDetail(response)
    if (response.status === 401) {
      window.dispatchEvent(new Event('api:unauthorized'))
    }
    throw new ApiError(response.status, code, ticketId)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export function apiGet<T>(path: string, headers?: HeadersInit): Promise<T> {
  return request<T>(path, { headers })
}

export function apiPost<T>(path: string, body?: unknown, headers?: HeadersInit): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers,
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

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
