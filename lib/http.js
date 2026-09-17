import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

export const PREFIX = '/dsh-pkg-atlas'

const ASSET_ROUTES = new Map([
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', csp: true }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
  ['/vendor/cytoscape.min.js', { file: 'vendor/cytoscape.min.js', type: 'text/javascript; charset=utf-8' }],
  ['/vendor/LICENSE-cytoscape.txt', { file: 'vendor/LICENSE-cytoscape.txt', type: 'text/plain; charset=utf-8' }],
])

/** Read the fixed asset table from the plugin's web/ dir (startup, sync). */
export function loadAssets(webDir) {
  const assets = new Map()
  for (const [route, meta] of ASSET_ROUTES) {
    assets.set(route, { body: readFileSync(join(webDir, meta.file)), type: meta.type, csp: meta.csp === true })
  }
  return assets
}

// NAME_RE carries the leading `@?`: scoped ids (`@deepseek-ai/core@1.0.0`) are the
// whole official universe, so a scope-hostile name class rejects every real node.
const NAME_RE = /^@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/
const VER_RE = /^[A-Za-z0-9._~+-]+$/
const ID_RE = /^(@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?)@([A-Za-z0-9._~+-]+)$/
// broken ids key on the full ref (R16), so they can be scoped: broken:@deepseek-ai/pkg-broken
const META_ID_RE = /^(profile|broken):(@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?)$/

/** Id hygiene only — path safety comes from snapshot lookup (spec §9). */
function validId(id) {
  // leading `@` stripped first, else `@..` would slip past the exact-segment check
  const hasBadSegment = (s) => s.replace(/^@/, '').split('/').some((x) => x === '.' || x === '..')
  const m = ID_RE.exec(id)
  if (m) return NAME_RE.test(m[1]) && VER_RE.test(m[2]) && !hasBadSegment(m[1]) && !hasBadSegment(m[2])
  const p = META_ID_RE.exec(id)
  return !!p && NAME_RE.test(p[2]) && !hasBadSegment(p[2])
}

const sendJson = (res, code, obj, headers = {}) => {
  const body = JSON.stringify(obj)
  // explicit Content-Length (P1#6): byte-accurate (multi-byte CJK), never rely on
  // the server's chunked fallback
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(body)
}

/** Strip `_`-prefixed internal fields; cached by object identity. */
const cleanCache = new WeakMap()
function publicGraph(graph) {
  const hit = cleanCache.get(graph)
  if (hit) return hit
  const clean = JSON.parse(JSON.stringify(graph, (k, v) => (k.startsWith('_') ? undefined : v)))
  cleanCache.set(graph, clean)
  return clean
}

/**
 * @param deps - `{ getGraph, assets, logger? }`; `logger` (`{ error }`) receives
 *  internal errors verbatim (I-5/T-1) — the response stays opaque (R19).
 */
export function createRequestHandler({ getGraph, assets, logger }) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      // bare PREFIX (no trailing slash) maps to '' — it must 301 to `${PREFIX}/` (R21),
      // else relative asset refs (`app.js`, `vendor/…`) would resolve outside the prefix.
      const sub = url.pathname === PREFIX ? '' : url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : null
      if (sub === null) return sendJson(res, 404, { error: 'not-found' })
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD' })
      if (sub === '') {
        res.writeHead(301, { Location: `${PREFIX}/${url.search}` })
        return res.end()
      }
      if (sub === '/' || sub === '/index.html') {
        const a = assets.get('/index.html')
        res.writeHead(200, {
          'Content-Type': a.type, 'X-Content-Type-Options': 'nosniff',
          // node drops HEAD bodies without auto-computing the length: state it (R18)
          'Content-Length': String(a.body.length),
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
        })
        return res.end(a.body)
      }
      const asset = assets.get(sub)
      if (asset) {
        res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': String(asset.body.length), 'X-Content-Type-Options': 'nosniff' })
        return res.end(asset.body)
      }
      if (sub.startsWith('/api/') && req.method === 'HEAD') {
        // P1#6: HEAD on API routes answers headers-only (200, JSON type, no body).
        // Deliberately NOT treated as a bodiless GET: getGraph() would pay/trigger a
        // scan() side-effect for a request that can never show a body. Content-Length
        // is omitted — the graph length is unknown without scanning, and lying is worse.
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        return res.end()
      }
      if (sub === '/api/graph') {
        const graph = await getGraph(url.searchParams.get('refresh') === '1')
        return sendJson(res, 200, publicGraph(graph))
      }
      if (sub === '/api/readme') {
        const id = url.searchParams.get('id') ?? ''
        if (!validId(id)) return sendJson(res, 400, { error: 'invalid-id' })
        const graph = await getGraph(false)
        const node = graph.nodes.find((n) => n.id === id)
        if (!node) return sendJson(res, 404, { error: 'unknown-id' })
        if (node.kind !== 'package') return sendJson(res, 404, { error: 'not-a-package' })
        for (const cand of ['README.md', 'README.zh.md']) {
          try {
            const text = await readFile(join(node._dir, cand), 'utf8')
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
            return res.end(text)
          } catch { /* try next candidate */ }
        }
        return sendJson(res, 404, { error: 'no-readme' })
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (err) {
      // observability (I-5/T-1): the real error (message + stack) goes to the host logger…
      logger?.error?.(err)
      // …never into the response: messages carry absolute local paths (R19)
      try { sendJson(res, 500, { error: 'internal-error' }) } catch { /* already sent */ }
    }
  }
}
