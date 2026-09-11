export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'neutral'

export default function StatusBadge({ tone, label }: { tone: StatusBadgeTone; label: string }) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>
}
