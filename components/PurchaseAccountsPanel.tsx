'use client'

import { useState } from 'react'
import { Badge, Button, Card, Input, Label, Modal, Select, cn } from './ui'
import type { AccountSource, PurchaseAccount, SyncAccountResult } from '@/lib/purchase-types'

const SOURCE_LABEL: Record<AccountSource, string> = {
  lcsc: '立创商城',
  taobao: '淘宝',
}

function syncBadge(account: PurchaseAccount) {
  if (!account.enabled) return <Badge color="gray">已暂停</Badge>
  if (account.lastSyncStatus === 'ok') return <Badge color="green">同步正常</Badge>
  if (account.lastSyncStatus === 'cookie_expired') return <Badge color="red">Cookie 已过期</Badge>
  if (account.lastSyncStatus === 'error') return <Badge color="amber">同步失败</Badge>
  return <Badge color="gray">待同步</Badge>
}

function fmtTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 采购账号面板：同一个平台可以配多个账号，各自一份 Cookie。
 *
 * Cookie 是账号凭证，列表只显示末尾 6 位；换 Cookie 时才需要重新粘贴。
 * 立创 / 淘宝都要在登录状态下从浏览器开发者工具复制整条 Cookie 请求头。
 */
export function PurchaseAccountsPanel({
  accounts,
  onChanged,
}: {
  accounts: PurchaseAccount[]
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 正在同步的账号 id；'all' 表示全部同步中 */
  const [syncing, setSyncing] = useState<number | 'all' | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    source: 'lcsc' as AccountSource,
    label: '',
    username: '',
    cookie: '',
  })
  const [editing, setEditing] = useState<PurchaseAccount | null>(null)
  const [editCookie, setEditCookie] = useState('')

  async function call(method: string, body?: unknown, query = '') {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/accounts${query}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || `操作失败（HTTP ${res.status}）`)
      await onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  /** 触发平台同步：不传 id 就同步全部启用中的账号 */
  async function sync(accountId?: number) {
    setSyncing(accountId ?? 'all')
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountId ? { accountId } : {}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || `同步失败（HTTP ${res.status}）`)

      const results = (data.results ?? []) as SyncAccountResult[]
      if (!results.length) {
        setNotice('没有启用中的账号可同步')
        return
      }

      const failed = results.filter((item) => item.status !== 'ok')
      setNotice(results.map((item) => `${item.label}：${item.message}`).join('　|　'))
      if (failed.length) {
        setError(
          failed.some((item) => item.status === 'cookie_expired')
            ? '有账号 Cookie 已失效，重新复制粘贴后即可继续同步'
            : failed.map((item) => `${item.label}：${item.message}`).join('；'),
        )
      }
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败')
    } finally {
      setSyncing(null)
    }
  }

  async function submitCreate() {
    const ok = await call('POST', {
      source: form.source,
      label: form.label,
      username: form.username || null,
      cookie: form.cookie,
    })
    if (ok) {
      setForm({ source: form.source, label: '', username: '', cookie: '' })
      setCreating(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-500">采购账号（多账户 Cookie）</h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={syncing !== null || accounts.length === 0}
            onClick={() => sync()}
          >
            {syncing === 'all' ? '同步中…' : '同步全部'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? '收起' : '新增账号'}
          </Button>
        </div>
      </div>

      <p className="mb-3 text-xs text-neutral-400">
        Cookie 等同账号凭证，只存在本机数据库、界面只显示末 6 位。取法：浏览器登录后按 F12 →
        Network → 任选一个请求 → 复制整条 <span className="font-mono">Cookie</span> 请求头。
      </p>

      {creating && (
        <div className="mb-4 space-y-2 rounded-lg border border-neutral-200 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label>平台</Label>
              <Select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as AccountSource })}
              >
                <option value="lcsc">立创商城</option>
                <option value="taobao">淘宝</option>
              </Select>
            </div>
            <div>
              <Label>账号名称</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="如：个人号 / 公司采购号"
              />
            </div>
            <div>
              <Label>账号标识（可选）</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="登录名或手机号后四位"
              />
            </div>
          </div>
          <div>
            <Label>Cookie</Label>
            <textarea
              value={form.cookie}
              onChange={(e) => setForm({ ...form, cookie: e.target.value })}
              rows={3}
              placeholder="粘贴整条 Cookie 字符串（形如 a=1; b=2; ...）"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <Button onClick={submitCreate} disabled={busy || !form.label.trim() || !form.cookie.trim()}>
            {busy ? '保存中…' : '保存账号'}
          </Button>
        </div>
      )}

      {notice && <p className="mb-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{notice}</p>}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {accounts.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400">还没有配置采购账号</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="px-2 py-2">平台</th>
                <th className="px-2 py-2">名称</th>
                <th className="px-2 py-2">账号</th>
                <th className="px-2 py-2">Cookie</th>
                <th className="px-2 py-2">上次同步</th>
                <th className="px-2 py-2">状态</th>
                <th className="px-2 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-2 py-1.5">{SOURCE_LABEL[account.source]}</td>
                  <td className="px-2 py-1.5 font-medium text-neutral-700">{account.label}</td>
                  <td className="px-2 py-1.5 text-neutral-500">{account.username || '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-neutral-400">
                    {account.cookieSet ? `••••${account.cookieTail}` : '未配置'}
                  </td>
                  <td className="px-2 py-1.5 text-neutral-500">{fmtTime(account.lastSyncAt)}</td>
                  <td className="px-2 py-1.5">{syncBadge(account)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="font-medium text-blue-600 hover:bg-blue-50"
                        disabled={syncing !== null || !account.cookieSet || !account.enabled}
                        onClick={() => sync(account.id)}
                      >
                        {syncing === account.id ? '同步中…' : '同步'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(account)
                          setEditCookie('')
                        }}
                      >
                        换 Cookie
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => call('PATCH', { id: account.id, enabled: !account.enabled })}
                      >
                        {account.enabled ? '暂停' : '启用'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`删除账号「${account.label}」？已同步的订单会保留。`)) {
                            call('DELETE', undefined, `?id=${account.id}`)
                          }
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editing !== null}
        title={`更新 Cookie · ${editing?.label ?? ''}`}
        onClose={() => setEditing(null)}
      >
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            旧的 Cookie 会被覆盖。更新后同步状态会重置为「待同步」。
          </p>
          <textarea
            value={editCookie}
            onChange={(e) => setEditCookie(e.target.value)}
            rows={5}
            placeholder="粘贴新的整条 Cookie"
            className={cn(
              'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs',
              'outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
            )}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
            <Button
              disabled={busy || !editCookie.trim()}
              onClick={async () => {
                if (!editing) return
                const ok = await call('PATCH', { id: editing.id, cookie: editCookie })
                if (ok) setEditing(null)
              }}
            >
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
