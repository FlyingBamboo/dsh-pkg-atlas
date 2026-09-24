/**
 * Task V2.12 (2) — the npm test script must be expansion-proof AND provably
 * non-vacuous.
 *
 * Measured on this machine (git-bash, Node 24.4.1 — see task-V212-report.md for
 * the full probe): with the glob UNQUOTED, a shell with `nullglob` (and no
 * globstar, the common default) expands npm's test glob to ZERO words, so node
 * is launched as a bare `node --test`. Node then falls back to its own cwd
 * discovery and reports `tests 1 / pass 1 / fail 0` with exit code 0 — green —
 * while none of the real suite ran. A test command whose failure mode is
 * "silently green" is worse than no test command.
 *
 * Two halves therefore have to be pinned, and this file pins both:
 *  a) the glob reaches node in QUOTES, so whatever shell npm picks cannot
 *     expand, strip or reorder it — node's own matcher is the only authority;
 *  b) that pattern is not a dead pattern: it must still resolve, through the
 *     very same node glob implementation the runner uses, onto every single
 *     *.test.mjs that exists under test/. A renamed/misplaced/moved test file
 *     now fails here instead of silently dropping out of the run.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const testScript = pkg.scripts.test

// Quoted form only: `node --test "<glob>"` and nothing else on the line.
const QUOTED = /^node --test "([^"]+)"$/
const toPosix = (p) => p.split(sep).join('/')

function listTestFiles (dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listTestFiles(abs))
    else if (entry.name.endsWith('.test.mjs')) out.push(toPosix(relative(repoRoot, abs)))
  }
  return out
}

test('V2.12 test glob: the npm test script quotes its glob so no shell can expand it away', () => {
  const m = QUOTED.exec(testScript)
  assert.ok(m,
    'package.json "test" must be exactly `node --test "<glob>"` (quoted); got: ' + JSON.stringify(testScript))
})

test('V2.12 test glob: the quoted pattern is non-vacuous and covers every test file on disk', () => {
  const m = QUOTED.exec(testScript)
  assert.ok(m, 'blocked on the quoting guard above')
  const pattern = m[1]
  const matched = globSync(pattern, { cwd: repoRoot }).map(toPosix).sort()
  const onDisk = listTestFiles(join(repoRoot, 'test')).sort()

  assert.ok(matched.length >= 10,
    `the test glob resolved to only ${matched.length} files — that is a dead pattern, ` +
    'and a dead pattern is green-by-accident: ' + pattern)
  assert.deepEqual(matched, onDisk,
    'files under test/ that the npm test glob does not select are never run')
})
