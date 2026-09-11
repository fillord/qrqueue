import type { TFunction } from 'i18next'

import { ApiError } from '../api/client'

export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return t('admin.errors.notFound')
    if (err.status === 409) return t('admin.errors.conflict')
    if (err.status === 422) return t('admin.errors.invalid')
  }
  return t('admin.errors.unknown')
}
