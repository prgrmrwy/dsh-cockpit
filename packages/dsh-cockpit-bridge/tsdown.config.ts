import { defineConfig } from 'tsdown'

const external = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
]

/**
 * Two independent halves, built with different targets:
 *
 * - `host`: the loader entry (`lib/index.js`). package.json declares
 *   `type: module` and `main: ./lib/index.js`, and `cordis.patch.yml` inserts
 *   this package as a profile bundle row — so DSH imports it as ESM at boot.
 *   Shipping the package without this file makes the DSH process fail to start
 *   with ERR_MODULE_NOT_FOUND, which is exactly what v0.1.0 did.
 * - `client`: the browser bundle (`lib/client.js`), wrapped in the DSH web
 *   module-loader banner and therefore CJS-in-a-function, not ESM.
 */
export default defineConfig([
  {
    name: 'dsh-cockpit-bridge/host',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'neutral',
    dts: true,
    clean: false,
    sourcemap: true,
    external,
    outputOptions: {
      entryFileNames: 'index.js',
      // Without this the dts chunk lands as `index-<hash>.d.ts`, while
      // package.json points `types` at `./lib/index.d.ts` — a dangling path.
      chunkFileNames: '[name].d.ts',
    },
  },
  {
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
  },
])
