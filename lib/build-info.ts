import 'server-only'

/**
 * 镜像里烙进去的 Git 信息（由 docker build --build-arg 注入，见 Dockerfile / deploy-if-updated.sh）。
 * 抽成独立模块，让侧边栏与 /api/health 用同一套取值和格式化逻辑。
 */
export interface BuildInfo {
  /** 短 SHA（侧边栏 7 位，健康检查 12 位） */
  commit: string | null
  message: string | null
  /** 该版本的提交时间，展示为 `YYYY-MM-DD HH:MM` */
  time: string | null
  /** 原始时间串（含提交时区），用于 hover 提示与排查 */
  timeIso: string | null
}

/**
 * `git log -1 --pretty=%cI` 形如 `2026-10-22T02:24:56+08:00`。
 * 直接截取前几位展示，避免把时间换算到容器时区后和提交时区对不上。
 */
function formatCommitTime(value: string | null | undefined): Pick<BuildInfo, 'time' | 'timeIso'> {
  const raw = value?.trim()
  if (!raw) return { time: null, timeIso: null }

  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw)
  if (iso) return { time: `${iso[1]} ${iso[2]}`, timeIso: raw }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return { time: raw, timeIso: raw }
  return { time: date.toISOString().slice(0, 16).replace('T', ' '), timeIso: raw }
}

export function readBuildInfo(commitLength = 7): BuildInfo {
  const sha = process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA
  const message = process.env.GIT_COMMIT_MESSAGE ?? process.env.VERCEL_GIT_COMMIT_MESSAGE
  const { time, timeIso } = formatCommitTime(process.env.GIT_COMMIT_TIME)
  return {
    commit: sha ? sha.slice(0, commitLength) : null,
    message: message?.trim() || null,
    time,
    timeIso,
  }
}
