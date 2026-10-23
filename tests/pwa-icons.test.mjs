import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { URL } from 'node:url'
import vm from 'node:vm'

const web = new URL('../packages/cockpit-web/', import.meta.url)
const read = (path) => readFileSync(new URL(path, web))

test('PWA icon references resolve to PNGs with the declared dimensions', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'))
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
  ])
  for (const [path, size] of [
    ...manifest.icons.map(({ src, sizes }) => [`public${src}`, Number(sizes.split('x')[0])]),
    ['public/icons/apple-touch-icon.png', 180],
  ]) {
    const png = read(path)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
  }
  assert.deepEqual(read('public/favicon.svg'), read('icons-src/icon.svg'))
  const html = read('index.html').toString()
  assert.match(html, /href="\/favicon.svg" type="image\/svg\+xml"/)
  assert.match(html, /href="\/icons\/icon-192.png" type="image\/png"/)
})

test('SW precaches every icon, serves favicon offline, and bypasses SSE/cross-origin', async () => {
  const handlers = {}
  const added = []
  const cached = { ok: true }
  const cache = { add: async (url) => added.push(url), match: async () => cached }
  vm.runInNewContext(read('public/sw.js').toString(), {
    self: {
      location: { origin: 'http://127.0.0.1:3090' },
      addEventListener: (name, handler) => { handlers[name] = handler },
      skipWaiting: async () => {},
    },
    caches: { open: async () => cache },
    URL,
  })
  let installed
  handlers.install({ waitUntil: (promise) => { installed = promise } })
  await installed
  for (const path of ['/favicon.svg', '/icons/apple-touch-icon.png', '/icons/icon-maskable-512.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
    assert.ok(added.includes(path), `${path} must be precached`)
  }
  const request = (url, accept = '') => ({ method: 'GET', url, headers: { get: () => accept } })
  let response
  handlers.fetch({ request: request('http://127.0.0.1:3090/favicon.svg'), respondWith: (promise) => { response = promise } })
  assert.equal(await response, cached)
  for (const req of [request('http://127.0.0.1:3080/favicon.svg'), request('http://127.0.0.1:3090/api/events', 'text/event-stream')]) {
    handlers.fetch({ request: req, respondWith: () => assert.fail('Must bypass service worker') })
  }
})
