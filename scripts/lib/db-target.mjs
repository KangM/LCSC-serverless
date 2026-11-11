/**
 * scripts/lib/db-target.mjs — 纯 Node 脚本里定位数据库（与 app 同一套规则）
 *
 * 优先级：显式路径 > DATABASE_MODE=sqlite（读 SQLITE_DATABASE_PATH）> TURSO_* > 本地 data/inventory.db
 * Next.js 只在自身进程加载 .env.local，所以这里要手动读一次。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let envLoaded = false

export async function loadDotEnvLocal() {
  if (envLoaded) return
  envLoaded = true
  try {
    const text = await readFile(path.join(ROOT, '.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const key = t.slice(0, i).trim()
      let value = t.slice(i + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && !process.env[key]) process.env[key] = value
    }
  } catch {
    /* 没有 .env.local 就用默认值 */
  }
}

/** @returns {Promise<{ config: { url: string, authToken?: string }, label: string }>} */
export async function resolveDbTarget(explicitPath) {
  if (explicitPath) {
    const p = path.resolve(explicitPath)
    return { config: { url: pathToFileURL(p).href }, label: path.relative(ROOT, p) || p }
  }
  await loadDotEnvLocal()
  const useTurso =
    process.env.DATABASE_MODE === 'turso' ||
    (process.env.DATABASE_MODE !== 'sqlite' && Boolean(process.env.TURSO_DATABASE_URL))
  if (useTurso) {
    return {
      config: { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN },
      label: 'Turso',
    }
  }
  const p = path.resolve(process.env.SQLITE_DATABASE_PATH ?? path.join(ROOT, 'data/inventory.db'))
  return { config: { url: pathToFileURL(p).href }, label: path.relative(ROOT, p) }
}
