import { Badge, Card } from './ui'
import { BackupRefreshButton } from './BackupStatusCard'
import {
  formatAgo,
  formatBytes,
  formatDateTime,
  getBackupStatus,
  type BackupHealth,
} from '@/lib/backup-status'

const HEALTH: Record<BackupHealth, { label: string; color: 'green' | 'amber' | 'red' | 'gray' }> = {
  ok: { label: '正常', color: 'green' },
  stale: { label: '已逾期', color: 'amber' },
  error: { label: '上次执行失败', color: 'red' },
  unknown: { label: '状态未知', color: 'gray' },
  unconfigured: { label: '未配置', color: 'gray' },
}

/** 按 schedule（如「每日 03:30」）推算下一次触发时间 */
function nextRunText(schedule: string | null): string | null {
  if (!schedule) return null
  const m = /(\d{1,2}):(\d{2})/.exec(schedule)
  if (!m) return null
  const next = new Date()
  next.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
  return formatDateTime(next.toISOString())
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-24 shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="text-sm text-neutral-800">{children}</span>
    </div>
  )
}

export async function BackupStatusPanel() {
  const s = await getBackupStatus()
  const health = HEALTH[s.health]
  const nextRun = nextRunText(s.schedule)

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-500">数据库备份</h2>
        <div className="flex items-center gap-2">
          <Badge color={health.color}>{health.label}</Badge>
          {s.configured && <BackupRefreshButton />}
        </div>
      </div>

      {!s.configured ? (
        <p className="text-sm text-neutral-600">
          未发现备份。备份由宿主机的 <code className="rounded bg-neutral-100 px-1">systemd timer</code>
          执行（每天 03:30），安装方法见{' '}
          <code className="rounded bg-neutral-100 px-1">deploy/README.md</code> 的「数据库定时备份」一节。
        </p>
      ) : (
        <div className="space-y-4">
          <div className="divide-y divide-neutral-100">
            <Row label="上次备份">
              {s.lastBackupAt ? (
                <>
                  {formatDateTime(s.lastBackupAt)}
                  <span className="ml-1 text-xs text-neutral-500">（{formatAgo(s.ageHours)}）</span>
                </>
              ) : (
                '从未成功生成快照'
              )}
            </Row>
            <Row label="计划">{s.schedule ?? '—'}</Row>
            {nextRun && <Row label="下次预计">{nextRun}</Row>}
            <Row label="保留">
              {s.backupCount} 份
              {s.keepCount ? `（上限 ${s.keepCount} 份）` : ''}
            </Row>
            <Row label="最新快照">
              {s.lastBackupFile ?? '—'}
              {s.lastBackupSize !== null && (
                <span className="ml-1 text-xs text-neutral-500">{formatBytes(s.lastBackupSize)}</span>
              )}
            </Row>
            <Row label="上次执行">
              {s.generatedAt ? (
                <>
                  {formatDateTime(s.generatedAt)}
                  {s.durationMs !== null && (
                    <span className="ml-1 text-xs text-neutral-500">
                      耗时 {(s.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </Row>
          </div>

          {s.runError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{s.runError}</p>
          )}

          <div className="border-t border-neutral-100 pt-3">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-xs font-semibold text-neutral-500">异地留存（git）</h3>
              {!s.git.enabled ? (
                <Badge color="gray">未配置</Badge>
              ) : s.git.pushed ? (
                <Badge color="green">已推送</Badge>
              ) : (
                <Badge color="amber">未推送</Badge>
              )}
            </div>

            {!s.git.enabled ? (
              <p className="text-xs text-neutral-600">
                在 <code className="rounded bg-neutral-100 px-1">lcsc-inventory-backup.service</code> 里设置{' '}
                <code className="rounded bg-neutral-100 px-1">BACKUP_GIT_DIR</code> 并配好远端，即可把快照提交推送到异地。
              </p>
            ) : (
              <div className="divide-y divide-neutral-100">
                <Row label="远端">
                  {s.git.remoteUrl ?? '—'}
                  {s.git.branch && <span className="ml-1 text-xs text-neutral-500">（{s.git.branch}）</span>}
                </Row>
                <Row label="最新提交">{s.git.commit ?? '—'}</Row>
                <Row label="待推送">
                  {s.git.pendingCommits > 0 ? (
                    <span className="text-amber-600">{s.git.pendingCommits} 个本地提交未推送</span>
                  ) : (
                    '无积压'
                  )}
                </Row>
                {s.git.error && (
                  <Row label="说明">
                    <span className="text-amber-600">{s.git.error}</span>
                  </Row>
                )}
              </div>
            )}
          </div>

          {s.health === 'stale' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              已超过 {s.staleAfterHours} 小时没有新快照，检查定时器是否在跑：
              <code className="mx-1 rounded bg-amber-100 px-1">systemctl list-timers lcsc-inventory-backup.timer</code>
            </p>
          )}

          <p className="text-xs text-neutral-400">
            状态来自 <code className="rounded bg-neutral-100 px-1">{s.dir}/status.json</code>
            ，由宿主机备份脚本在每次执行后写入。
          </p>
        </div>
      )}
    </Card>
  )
}
