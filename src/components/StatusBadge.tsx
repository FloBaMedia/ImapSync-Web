export type Status = 'PENDING' | 'SCHEDULED' | 'RUNNING' | 'SUCCESS' | 'COMPLETED' | 'FAILED' | 'STOPPED' | 'SKIPPED'

const configs: Record<Status, { label: string; classes: string; dot?: boolean }> = {
  PENDING:   { label: 'Draft',      classes: 'bg-gray-800 text-gray-400 border-gray-700' },
  SCHEDULED: { label: 'Scheduled',  classes: 'bg-purple-600/20 text-purple-400 border-purple-600/30' },
  RUNNING:   { label: 'Running',    classes: 'bg-blue-600/20 text-blue-400 border-blue-600/30', dot: true },
  SUCCESS:   { label: 'Success',    classes: 'bg-green-600/20 text-green-400 border-green-600/30' },
  COMPLETED: { label: 'Completed',  classes: 'bg-green-600/20 text-green-400 border-green-600/30' },
  FAILED:    { label: 'Failed',     classes: 'bg-red-600/20 text-red-400 border-red-600/30' },
  STOPPED:   { label: 'Stopped',    classes: 'bg-orange-600/20 text-orange-400 border-orange-600/30' },
  SKIPPED:   { label: 'Skipped',    classes: 'bg-yellow-600/20 text-yellow-500 border-yellow-600/30' },
}

export function StatusBadge({ status }: { status: string }) {
  const cfg = configs[status as Status] ?? { label: status, classes: 'bg-gray-800 text-gray-400 border-gray-700' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}>
      {cfg.dot && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 pulse-dot" />}
      {cfg.label}
    </span>
  )
}
