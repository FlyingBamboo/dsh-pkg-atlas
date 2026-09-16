const CORE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/

function parse(v) {
  const m = CORE.exec(v)
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s)) : null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre }
}

function cmpPre(a, b) {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const num = typeof x === 'number' && typeof y === 'number'
    return num ? x - y : String(x) < String(y) ? -1 : 1
  }
  return 0
}

/** Total order over semver-ish versions; unparseable sorts lowest. */
export function compareVersions(a, b) {
  const pa = parse(a), pb = parse(b)
  if (!pa && !pb) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  return cmpPre(pa.pre, pb.pre)
}

const satisfiesOne = (version, range) => {
  // strip the comparator operator before parsing: CORE only matches bare versions
  const base = range.replace(/^(\^|~|>=|<=|>|<)/, '')
  const v = parse(version), r = parse(base)
  if (!v) return false
  if (!r) return false
  const ge = compareVersions(version, base) >= 0
  if (range.startsWith('^')) {
    if (!ge) return false
    if (r.core[0] > 0) return v.core[0] === r.core[0]
    if (r.core[1] > 0) return v.core[0] === 0 && v.core[1] === r.core[1]
    return v.core[0] === 0 && v.core[1] === 0 && v.core[2] === r.core[2] && compareVersions(version, base) <= 0
  }
  if (range.startsWith('~')) {
    return ge && v.core[0] === r.core[0] && (r.core[1] === undefined || v.core[1] === r.core[1])
  }
  if (range.startsWith('>=')) return ge
  if (range.startsWith('>')) return compareVersions(version, base) > 0
  if (range.startsWith('<=')) return compareVersions(version, base) <= 0
  if (range.startsWith('<')) return compareVersions(version, base) < 0
  return compareVersions(version, base) === 0
}

/**
 * Resolve a range against installed versions: exact string hit first, then the
 * highest satisfying; no satisfier -> attach highest (satisfied:false); no
 * versions -> null. Unrecognized range syntax degrades to unsatisfied-attach.
 */
export function maxSatisfying(versions, range) {
  if (versions.length === 0) return null
  const sorted = [...versions].sort(compareVersions)
  const max = sorted[sorted.length - 1]
  const r = (range ?? '').trim()
  if (versions.includes(r)) return { version: r, satisfied: true }
  if (r === '' || r === '*' || r === 'x' || r === 'latest') return { version: max, satisfied: true }
  const hits = r.split('||').flatMap((s) => sorted.filter((v) => satisfiesOne(v, s.trim())))
  if (hits.length) return { version: hits.sort(compareVersions).pop(), satisfied: true }
  return { version: max, satisfied: false }
}
