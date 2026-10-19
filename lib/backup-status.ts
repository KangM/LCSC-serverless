/**
 * lib/backup-status.ts — 读取定时备份脚本写出的 status.json
 *
 * 备份由宿主机 systemd timer 执行（scripts/backup-db.sh），完成后在备份目录里写
 * `status.json`。备份目录默认落在数据库同级的 `backups/`，容器内即挂载的 `/data/backups`。
 *
 * status.json 缺失时（例如还没升级到新版脚本）退化为扫描目录里的 `inventory-*.db.gz`，
 * 仍能显示「最后一次备份时间 / 份数」，只是没有异地推送信息。
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export interface BackupGitStatus {
  enabled: boolean
  committed: boolean
  commit: string | null
  pushed: boolean
  remote: string | null
  remoteUrl: string | null
  branch: string | null
  pendingCommits: number
  error: string | null
}

export type BackupHealth = 'ok' | 'stale' | 'error' | 'unknown' | 'unconfigured'

export interface BackupStatus {
  /** 备份是否已配置（目录存在且有快照或状态文件） */
  configured: boolean
  /** 脚本最近一次执行结果 */
  runStatus: 'ok' | 'error' | 'skipped' | 'unknown'
  runError: string | null
  /** 最近一次执行时间（脚本跑完的时刻，未必产生了新快照） */
  generatedAt: string | null
  lastBackupAt: string | null
  lastBackupFile: string | null
  lastBackupSize: number | null
  backupCount: number
  keepCount: number | null
  schedule: string | null
  durationMs: number | null
  git: BackupGitStatus
  rclone: { enabled: boolean; uploaded: boolean }
  /** 距上次成功备份的小时数 */
  ageHours: number | null
  /** 综合健康度：ok 正常 / stale 逾期 / error 上次失败 / unknown 无状态文件 / unconfigured 未配置 */
  health: BackupHealth
  /** 逾期阈值（小时） */
  staleAfterHours: number
  /** 备份目录（排查用） */
  dir: string | null
}

/** 每天一次 + 5 分钟随机延迟 + 余量，超过这个时长没新快照就提示异常 */
const STALE_AFTER_HOURS = 25

function resolveBackupDir(): string | null {
  const explicit = process.env.BACKUP_DIR?.trim()
  if (explicit) return path.resolve(explicit)
  // 远程库模式下没有本地文件可备份
  if (process.env.DATABASE_MODE === 'turso') return null
  const dbPath =
    process.env.SQLITE_DATABASE_PATH?.trim() || path.join(process.cwd(), 'data/inventory.db')
  return path.join(path.dirname(path.resolve(dbPath)), 'backups')
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 3_600_000
}

/** 扫描目录里的快照文件（status.json 缺失时的兜底） */
async function scanBackups(dir: string) {
  try {
    const names = (await readdir(dir)).filter(
      (n) => n.startsWith('inventory-') && n.endsWith('.db.gz'),
    )
    const stats = await Promise.all(
      names.map(async (name) => {
        const s = await stat(path.join(dir, name)).catch(() => null)
        return s ? { name, mtimeMs: s.mtimeMs, size: s.size } : null
      }),
    )
    const files = stats.filter((f): f is { name: string; mtimeMs: number; size: number } => f !== null)
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return files
  } catch {
    return []
  }
}

const EMPTY_GIT: BackupGitStatus = {
  enabled: false,
  committed: false,
  commit: null,
  pushed: false,
  remote: null,
  remoteUrl: null,
  branch: null,
  pendingCommits: 0,
  error: null,
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const dir = resolveBackupDir()
  const base: BackupStatus = {
    configured: false,
    runStatus: 'unknown',
    runError: null,
    generatedAt: null,
    lastBackupAt: null,
    lastBackupFile: null,
    lastBackupSize: null,
    backupCount: 0,
    keepCount: null,
    schedule: null,
    durationMs: null,
    git: EMPTY_GIT,
    rclone: { enabled: false, uploaded: false },
    ageHours: null,
    health: 'unconfigured',
    staleAfterHours: STALE_AFTER_HOURS,
    dir,
  }
  if (!dir) return base

  // 1. 优先读脚本写出的状态文件
  let raw: Record<string, unknown> | null = null
  try {
    raw = JSON.parse(await readFile(path.join(dir, 'status.json'), 'utf8'))
  } catch {
    raw = null
  }

  const files = await scanBackups(dir)
  if (!raw && files.length === 0) return base

  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const bool = (v: unknown) => v === true

  const gitRaw = (raw?.git ?? {}) as Record<string, unknown>
  const rcloneRaw = (raw?.rclone ?? {}) as Record<string, unknown>

  const lastBackupAt = str(raw?.lastBackupAt) ?? (files[0] ? new Date(files[0].mtimeMs).toISOString() : null)
  const lastBackupFile = str(raw?.lastBackupFile) ?? files[0]?.name ?? null
  const lastBackupSize = num(raw?.lastBackupSize) ?? files[0]?.size ?? null
  const runStatus = (str(raw?.status) as BackupStatus['runStatus'] | null) ?? 'unknown'
  const ageHours = hoursSince(lastBackupAt)

  let health: BackupHealth
  if (runStatus === 'error') health = 'error'
  else if (ageHours === null) health = 'unknown'
  else if (ageHours > STALE_AFTER_HOURS) health = 'stale'
  else health = 'ok'

  return {
    ...base,
    configured: true,
    runStatus,
    runError: str(raw?.error),
    generatedAt: str(raw?.generatedAt),
    lastBackupAt,
    lastBackupFile,
    lastBackupSize,
    backupCount: num(raw?.backupCount) ?? files.length,
    keepCount: num(raw?.keepCount),
    schedule: str(raw?.schedule),
    durationMs: num(raw?.durationMs),
    git: raw
      ? {
          enabled: bool(gitRaw.enabled),
          committed: bool(gitRaw.committed),
          commit: str(gitRaw.commit),
          pushed: bool(gitRaw.pushed),
          remote: str(gitRaw.remote),
          remoteUrl: str(gitRaw.remoteUrl),
          branch: str(gitRaw.branch),
          pendingCommits: num(gitRaw.pendingCommits) ?? 0,
          error: str(gitRaw.error),
        }
      : EMPTY_GIT,
    rclone: { enabled: bool(rcloneRaw.enabled), uploaded: bool(rcloneRaw.uploaded) },
    ageHours,
    health,
  }
}

/** 体积的可读形式 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 距上次备份的可读形式 */
export function formatAgo(hours: number | null): string {
  if (hours === null) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟前`
  if (hours < 48) return `${hours.toFixed(1)} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 本地时间 YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
