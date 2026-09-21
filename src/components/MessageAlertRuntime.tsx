import { useEffect, useRef } from 'react'
import * as configService from '../services/config'
import type { MessageAlertRecord } from '../types/electron'

// 全局命中运行时：无论当前在哪个页面，命中消息监控规则时都会播放提示音。
// 桌面弹窗由主进程通知窗口负责，这里只处理声音。
export function MessageAlertRuntime() {
  const soundEnabledRef = useRef(true)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastPlayRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const syncSound = async () => {
      try {
        const enabled = await configService.getMessageAlertSound()
        if (!cancelled) soundEnabledRef.current = enabled
      } catch {
        // 读取失败时保持默认开启
      }
    }
    void syncSound()

    // 窗口重新获得焦点时刷新一次配置，保证与设置页同步
    const onFocus = () => { void syncSound() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    const playBeep = () => {
      const now = Date.now()
      // 简单节流，避免批量命中时连续爆音
      if (now - lastPlayRef.current < 400) return
      lastPlayRef.current = now

      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') void ctx.resume()

        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.3)
      } catch {
        // 播放失败时静默降级
      }
    }

    const remove = window.electronAPI?.messageAlert?.onHit?.((record: MessageAlertRecord) => {
      if (soundEnabledRef.current && record.sound !== false) playBeep()
    })
    return () => { remove?.() }
  }, [])

  return null
}

export default MessageAlertRuntime
