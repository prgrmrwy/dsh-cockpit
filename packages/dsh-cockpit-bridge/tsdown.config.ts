import { defineConfig } from 'tsdown'

const external = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
]

export default defineConfig({
  name: 'dsh-cockpit-bridge/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-cockpit-bridge", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
