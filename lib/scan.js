import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveDescription } from './roles.js'
import { extractPatchNames } from './mounts.js'
import { maxSatisfying } from './semver.js'

const readJsonSafe = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')) } catch { return null } }
const readTextSafe = async (p) => { try { return await readFile(p, 'utf8') } catch { return null } }

/** Directory entries incl. junctions; dot entries excluded (`.pnpm`, `.bin`, …). */
const listDirs = async (dir) => {
  try {
    const ents = await readdir(dir, { withFileTypes: true })
    return ents.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => e.name).sort()
  } catch { return [] }
}

/** Spec §6.1 precedence: explicit > non-blank $DSH_HOME > ~/.dsh. */
export function resolveDshHome(explicit) {
  const norm = (v) => (typeof v === 'string' && v.trim() !== '' ? resolve(v.trim()) : null)
  return norm(explicit) ?? norm(process.env.DSH_HOME) ?? join(homedir(), '.dsh')
}

const homeLabel = (home) => home === join(homedir(), '.dsh') ? '~/.dsh' : '$DSH_HOME'

/**
 * Scan one DSH_HOME into the schema-1 graph (spec §6). Official shared-layer
 * packages enter wholesale; everything else only when referenced by a profile
 * manifest/bundles/patch name line. Broken junctions become visible nodes.
 */
export async function scan({ dshHome }) {
  const warnings = []
  const profilesRoot = join(dshHome, 'profiles')
  const sharedNM = join(profilesRoot, 'node_modules')

  // 1) profiles + referenced name set
  const profiles = []
  const referenced = new Set()
  for (const name of await listDirs(profilesRoot)) {
    if (name === 'node_modules') continue
    const dir = join(profilesRoot, name)
    const manifest = await readJsonSafe(join(dir, 'package.json')) ?? {}
    const dependencies = manifest.dependencies ?? {}
    const bundles = manifest.dsh?.profile?.bundles ?? []
    const patchText = await readTextSafe(join(dir, 'cordis.patch.yml'))
    const patchNames = patchText ? extractPatchNames(patchText) : []
    profiles.push({ name, dir, dependenciesRaw: dependencies, bundles, patchNames, patchText })
    for (const n of [...Object.keys(dependencies), ...bundles, ...patchNames]) referenced.add(n)
  }

  // 2) candidate dirs: @deepseek-ai/* enters wholesale at EVERY layer (scoped,
  //    count bounded ~244); everything else only when referenced by a profile
  //    (deps ∪ bundles ∪ patch name lines). .pnpm/.bin/@types hoards excluded:
  //    listDirs skips dot-entries; non-@deepseek-ai needs an explicit reference.
  const candidates = []
  const addLayer = async (base) => {
    for (const entry of await listDirs(base)) {
      if (entry.startsWith('@')) {
        for (const sub of await listDirs(join(base, entry))) {
          const full = `${entry}/${sub}`
          if (entry === '@deepseek-ai' || referenced.has(full)) {
            candidates.push({ dir: join(base, entry, sub), ref: full })
          }
        }
      } else if (referenced.has(entry)) {
        candidates.push({ dir: join(base, entry), ref: entry })
      }
    }
  }
  await addLayer(sharedNM)
  for (const p of profiles) await addLayer(join(p.dir, 'node_modules'))

  // 3) nodes
  const nodes = new Map() // id -> node
  // Same id across layers is normal (pnpm links one package into several
  // layers): silent last-wins; profile layer is scanned after shared, so the
  // profile layer wins (R15).
  const addNode = (node) => { nodes.set(node.id, node) }
  const groupOf = (manifest, scope) => {
    if (scope !== 'official') return 'plugin'
    const dir = manifest.repository?.directory ?? ''
    if (dir.startsWith('packages/') && dir.split('/').length >= 3) return dir.split('/')[1]
    if (dir.startsWith('vendor/')) return 'vendor'
    return 'ungrouped'
  }
  for (const { dir, ref } of candidates) {
    const manifest = await readJsonSafe(join(dir, 'package.json'))
    if (!manifest) {
      const short = ref.split('/').pop()
      const id = `broken:${ref}` // full ref keys the id: no scoped/bare collision, cross-layer dedup correct (R16)
      if (!nodes.has(id)) {
        nodes.set(id, {
          id, kind: 'broken', name: short, version: '-', scope: ref.startsWith('@deepseek-ai') ? 'official' : 'third-party',
          group: 'broken', path: dir.replace(dshHome, '$DSH_HOME'), description: null,
          servicesRequired: [], externalDeps: [], mountedBy: [], flags: { unreadable: true },
        })
        warnings.push({ type: 'unreadable', path: dir.replace(dshHome, '$DSH_HOME'), message: `${ref}: 目录存在但读不到 package.json（断链或损坏）` })
      }
      continue
    }
    const name = manifest.name ?? ref
    const scope = name.startsWith('@deepseek-ai/') ? 'official' : 'third-party'
    const { zh } = await resolveDescription(manifest, { dir })
    addNode({
      id: `${name}@${manifest.version ?? '-'}`, kind: 'package', name, version: manifest.version ?? '-',
      scope, group: groupOf(manifest, scope), path: dir.replace(dshHome, '$DSH_HOME'),
      description: zh, servicesRequired: manifest['@deepseek-ai/cordis']?.services?.required ?? [],
      externalDeps: [], mountedBy: [], flags: { unreadable: false },
      _dir: dir, _manifest: manifest,
      _dshPatchRel: manifest.dsh?.bundle?.patch ?? null,
    })
  }

  // 4) referenced but absent -> missing-install; profile virtual nodes
  const present = new Set([...nodes.values()].map((n) => n.name))
  for (const n of referenced) {
    if (!present.has(n)) warnings.push({ type: 'missing-install', path: '', message: `引用了 ${n}，但本机各层都找不到该目录` })
  }
  for (const p of profiles) {
    nodes.set(`profile:${p.name}`, {
      id: `profile:${p.name}`, kind: 'profile', name: p.name, version: '-', scope: 'meta',
      group: 'profiles', path: p.dir.replace(dshHome, '$DSH_HOME'), description: null,
      servicesRequired: [], externalDeps: [], mountedBy: [], flags: { unreadable: false },
    })
  }

  const pkgNodes = [...nodes.values()].filter((n) => n.kind === 'package')
  const groupIds = [...new Set([...nodes.values()].map((n) => n.group))]
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    dshHome: homeLabel(dshHome),
    warnings,
    profiles: profiles.map(({ name, dependenciesRaw, bundles }) => ({ name, dependencies: dependenciesRaw, bundles })),
    groups: groupIds.map((id) => ({ id, kind: id === 'plugin' ? 'plugin' : id === 'broken' ? 'broken' : id === 'profiles' ? 'profile' : id === 'ungrouped' ? 'ungrouped' : id === 'vendor' ? 'vendor' : 'official', packageCount: [...nodes.values()].filter((n) => n.group === id).length })),
    nodes: [...nodes.values()],
    edges: await collectEdges({ pkgNodes, profiles, nodes, warnings }),
  }
}

/** Resolve a dependency name/range to the best node of that name. */
const resolveTarget = (byName, name, range) => {
  const versions = byName.get(name)
  if (!versions || versions.length === 0) return null
  const hit = maxSatisfying(versions.map((n) => n.version), range ?? '*')
  if (!hit) return null
  return { node: versions.find((n) => n.version === hit.version), satisfied: hit.satisfied }
}

const collectEdges = async ({ pkgNodes, profiles, nodes, warnings }) => {
  const byName = new Map()
  for (const n of pkgNodes) {
    if (!byName.has(n.name)) byName.set(n.name, [])
    byName.get(n.name).push(n)
  }
  const edges = []
  const seen = new Set()
  const add = (from, to, kind, unsatisfied) => {
    if (!to || from === to.id) return
    const key = `${from}->${to.id}->${kind}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push(unsatisfied ? { from, to: to.id, kind, unsatisfied: true } : { from, to: to.id, kind })
  }

  // dep / peer edges + externalDeps
  for (const n of pkgNodes) {
    const m = n._manifest
    for (const [name, range] of Object.entries(m.dependencies ?? {})) {
      const t = resolveTarget(byName, name, range)
      if (!t) { n.externalDeps.push({ name, range }); continue }
      add(n.id, t.node, 'dep', !t.satisfied)
    }
    const meta = m.peerDependenciesMeta ?? {}
    for (const [name, range] of Object.entries(m.peerDependencies ?? {})) {
      const kind = meta[name]?.optional ? 'peer-optional' : 'peer'
      const t = resolveTarget(byName, name, range)
      if (!t) { n.externalDeps.push({ name, range }); continue }
      add(n.id, t.node, kind, !t.satisfied)
    }
  }

  // mount BFS: profile rows + official bundle patches (name-lines only)
  const mountCache = new Map() // node.id -> names[]
  const patchNamesOf = async (node) => {
    if (mountCache.has(node.id)) return mountCache.get(node.id)
    let names = []
    if (node.scope === 'official' && node._dshPatchRel) {
      const rel = node._dshPatchRel
      const p = resolve(node._dir, rel)
      // lexical containment, case-insensitive (Windows), never realpath (spec §9)
      if (p.toLowerCase().startsWith(node._dir.toLowerCase() + '\\') || p.toLowerCase() === node._dir.toLowerCase()) {
        const text = await readTextSafe(p)
        if (text === null) warnings.push({ type: 'parse-fail', path: node.path, message: `bundle patch 不可读: ${rel}` })
        else names = extractPatchNames(text)
      } else {
        warnings.push({ type: 'parse-fail', path: node.path, message: `bundle patch 路径越出包目录: ${rel}` })
      }
    }
    mountCache.set(node.id, names)
    return names
  }
  for (const p of profiles) {
    const queue = []
    const push = (name) => {
      const t = resolveTarget(byName, name, p.dependenciesRaw[name] ?? '*')
      if (!t) return // unresolved mount target: missing-install already warned (§6.2)
      // §6.5/R17: seed resolution uses the profile's declared range; attach-highest
      // (no satisfier) must surface as unsatisfied. BFS expansion below stays '*'.
      add(`profile:${p.name}`, t.node, 'mount', !t.satisfied)
      if (!t.node.mountedBy.includes(p.name)) t.node.mountedBy.push(p.name) // same node reachable via several rows
      queue.push(t.node)
    }
    for (const b of p.bundles) push(b)
    for (const d of Object.keys(p.dependenciesRaw)) push(d)
    for (const name of p.patchNames) push(name)
    const visited = new Set()
    while (queue.length > 0) {
      const node = queue.shift()
      if (visited.has(node.id)) continue
      visited.add(node.id)
      for (const name of await patchNamesOf(node)) {
        const t = resolveTarget(byName, name, '*')
        if (!t) continue
        add(node.id, t.node, 'mount')
        if (!t.node.mountedBy.includes(p.name)) t.node.mountedBy.push(p.name)
        queue.push(t.node)
      }
    }
  }
  return edges
}

const CACHE_TTL_MS = 60_000

/** Cached scanner: 60s TTL snapshot + explicit refresh (spec §6.8 simplified,
 *  documented in README). ~300-file rescans are tens of ms, so freshness is
 *  cheap; the page's 「重扫」 button passes refresh=true. */
export function createScanner({ dshHome }) {
  let cached = null // { at, json }
  return {
    async get(refresh = false) {
      if (cached && !refresh && Date.now() - cached.at < CACHE_TTL_MS) return cached.json
      const json = await scan({ dshHome })
      cached = { at: Date.now(), json }
      return json
    },
  }
}
