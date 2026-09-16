import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveDescription } from './roles.js'
import { extractPatchNames } from './mounts.js'

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

const collectEdges = async () => []
