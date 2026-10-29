import { useLayoutEffect, useRef, useState } from 'react'
import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export function DeviceMenu({ device, anchor, first, last, onClose, onMove, onToggle }: {
  device: DeviceStatusFacts; anchor: HTMLButtonElement; first: boolean; last: boolean
  onClose: (restoreFocus?: boolean) => void; onMove: (direction: number) => void; onToggle: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect(), box = menu.current!.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.height - 8)) })
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false)
    }
    const dismiss = () => onClose(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', dismiss, true) }
  }, [anchor, onClose])
  return <div ref={menu} className="console-device-menu" role="menu" aria-label={`${device.displayName} 操作`} style={position} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key === 'Tab') { onClose(false); return }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }}>
    <button role="menuitem" aria-label={`上移${device.displayName}`} disabled={first} onClick={() => { onClose(); onMove(-1) }}>上移</button>
    <button role="menuitem" aria-label={`下移${device.displayName}`} disabled={last} onClick={() => { onClose(); onMove(1) }}>下移</button>
    <button role="menuitem" aria-label={`${device.enabled ? '禁用' : '启用'}${device.displayName}`} onClick={() => { onClose(); onToggle() }}>{device.enabled ? '禁用' : '启用'}</button>
  </div>
}
