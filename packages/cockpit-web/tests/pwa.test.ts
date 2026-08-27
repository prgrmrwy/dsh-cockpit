import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const readPublic = (rel: string): string => readFileSync(path.join(root, 'public', rel), 'utf8')

describe('PWA assets', () => {
  it('manifest exposes installable metadata', () => {
    const manifest = JSON.parse(readPublic('manifest.webmanifest')) as Record<string, unknown>
    expect(manifest.name).toBe('DSH Cockpit')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    const icons = manifest.icons as Array<{ src: string; sizes: string }>
    expect(icons.map(i => i.sizes).sort()).toEqual(['192x192', '512x512'])
  })

  it('manifest-referenced icons exist on disk', () => {
    const manifest = JSON.parse(readPublic('manifest.webmanifest')) as { icons: Array<{ src: string }> }
    for (const icon of manifest.icons) {
      expect(() => readFileSync(path.join(root, 'public', icon.src.replace(/^\//, '')))).not.toThrow()
    }
  })

  it('index.html links manifest, system-following theme and apple touch icon', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8')
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    // Theme follows the system: color-scheme meta + media-scoped theme colors.
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#f6f8fa"')
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#101214"')
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"')
    expect(readFileSync(path.join(root, 'public/icons/apple-touch-icon.png')).length).toBeGreaterThan(0)
  })

  it('service worker implements the offline policy', () => {
    const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8')
    // Shell precache carries the manifest + icons.
    expect(sw).toContain('manifest.webmanifest')
    expect(sw).toContain('icon-512.png')
    // Navigations and /api/* are network-first with cache fallback.
    expect(sw).toContain("request.mode === 'navigate' || isApi(request)")
    // SSE streams must never be answered from cache.
    expect(sw).toContain('text/event-stream')
    expect(sw).toContain('never cached')
    // Cross-origin iframes (device workbenches) are out of scope.
    expect(sw).toContain('new URL(request.url).origin !== self.location.origin')
  })
})