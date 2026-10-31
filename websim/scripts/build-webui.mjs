// Builds the web UI (../web) into dist/webui for the simulator: web/vite.config.js as the firmware
// bundle uses it, plus relative asset URLs, hash routing (webui/router.ts stands in for preact-iso)
// and src/webui/bridge.ts inlined at the top of index.html, so /api and /ws reach the simulated
// display instead of the network. Needs web/node_modules (npm ci in web/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SIM = path.resolve(new URL('..', import.meta.url).pathname);
const WEB = path.resolve(SIM, '../web');
const OUT = path.join(SIM, 'dist/webui');
const ROUTER = path.join(SIM, 'webui/router.ts');
const WEB_ENTRY = path.join(WEB, 'src/index.jsx');

if (!fs.existsSync(path.join(WEB, 'node_modules/vite'))) {
  console.error('web/node_modules is missing: run `npm ci` in web/ first');
  process.exit(1);
}
const require = createRequire(path.join(WEB, 'package.json'));
const vite = await import(pathToFileURL(path.join(WEB, 'node_modules/vite/dist/node/index.js')).href);
const esbuild = require('esbuild');

const bridge = await esbuild.build({
  entryPoints: [path.join(SIM, 'src/webui/bridge.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
});

process.chdir(WEB); // Lingui finds its config from the working directory
await vite.build({
  configFile: path.join(WEB, 'vite.config.js'),
  root: WEB,
  mode: 'production',
  base: './',
  logLevel: 'warn',
  build: { outDir: OUT, emptyOutDir: true },
  plugins: [
    {
      name: 'websim-webui',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (source === 'preact-iso' && importer !== ROUTER) return ROUTER;
        // router.ts lives outside web/: resolve its packages from web/node_modules.
        if (importer === ROUTER && !source.startsWith('.')) return this.resolve(source, WEB_ENTRY, { skipSelf: true });
        return null;
      },
      transformIndexHtml: () => [{ tag: 'script', children: bridge.outputFiles[0].text, injectTo: 'head-prepend' }],
    },
  ],
});
console.log(`web UI built into ${path.relative(SIM, OUT)}`);
