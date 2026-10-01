import { apiGet, apiPost } from './client'

export interface AssistantStatus {
  available: boolean
}

export interface AssistantAnswer {
  answer: string
  source: 'gemini'
}

export const getAssistantStatus = () => apiGet<AssistantStatus>('/api/assistant/status')

export const askAssistant = (message: string, path: string, locale: 'ru' | 'kk' | 'en') =>
  apiPost<AssistantAnswer>('/api/assistant/chat', { message, path, locale })
