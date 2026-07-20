import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Keep this module dependency-free because it lives outside Baserow's
 * web-frontend directory and therefore cannot resolve @nuxt/kit by walking
 * parent node_modules directories on Windows.
 */
export default function liangceSsoModule(_options, nuxt) {
  const here = dirname(fileURLToPath(import.meta.url))
  nuxt.options.plugins.push({
    src: resolve(here, 'plugin.client.js'),
    mode: 'client',
  })
  // eslint-disable-next-line no-console
  console.log('[liangce-sso] Nuxt module registered')
}

liangceSsoModule.meta = {
  name: 'liangce-sso',
  configKey: 'liangceSso',
}
