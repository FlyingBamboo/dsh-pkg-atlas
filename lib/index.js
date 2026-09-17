import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScanner, resolveDshHome } from './scan.js'
import { createRequestHandler, loadAssets, PREFIX } from './http.js'

export const name = 'dsh-pkg-atlas'

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Mount the atlas routes. The only host surface used is `webServer.register`
 * (node:http handler, spec §5): if webServer is absent (headless profile) the
 * inject never satisfies and apply stays inert — the host is unaffected.
 * @param ctx - cordis context
 * @param config - `{ dshHome?: string }`, default resolved per spec §6.1
 */
export function apply(ctx, config = {}) {
  ctx.inject(['webServer'], (c) => {
    c.effect(() => {
      const assets = loadAssets(join(pluginDir, 'web'))
      const scanner = createScanner({ dshHome: resolveDshHome(config.dshHome) })
      const handler = createRequestHandler({ getGraph: scanner.get, getStatus: () => scanner.status(), assets, logger: c.logger })
      // 启动预热（V3）：fire-and-forget 首轮扫描，页面首请求直接吃缓存；
      // 失败只进 logger，status 自然停在 failed（页面轮询 /api/status 可见）
      scanner.get().catch((err) => c.logger?.error?.(err))
      try {
        return c.webServer.register({ kind: 'prefix', path: PREFIX, handler })
      } catch (err) {
        // duplicate (kind, path) or host refusal: log and stay inert, never crash the host
        c.logger?.error?.(`${name}: route registration failed (prefix occupied?)`, err)
        return () => {}
      }
    }, `${name}: routes`)
  })
}
