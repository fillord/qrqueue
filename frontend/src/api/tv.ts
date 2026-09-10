import { apiGet, apiPost } from './client'
import type { QrBatch, TvState } from './types'

export function pairDevice(code: string): Promise<{ device_token: string }> {
  return apiPost<{ device_token: string }>('/api/tv/pair', { code })
}

export function getTvState(deviceToken: string): Promise<TvState> {
  return apiGet<TvState>('/api/tv/state', { 'X-Device-Token': deviceToken })
}

export function getTvQrBatch(deviceToken: string): Promise<QrBatch> {
  return apiGet<QrBatch>('/api/tv/qr-batch', { 'X-Device-Token': deviceToken })
}
