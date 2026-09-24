/**
 * Task V2.12 (1) — vendor sha256 pin.
 *
 * `web/vendor/cytoscape.min.js` is a FROZEN third-party dist that is committed
 * into this repo on purpose (zero-runtime-deps doctrine: the patch bundle must
 * never reach for a CDN). Several of this project's rendering doctrines are
 * facts ABOUT THAT DIST'S BUGS, not about cytoscape in general — e.g. the
 * flattened dist has no `:not()` selector support (hence the CARD/CONTAINER
 * split is keyed on the model `collapsed` class), the property is
 * `text-max-width` (a `max-text-width` typo is silently dropped), and style
 * rules that the dist dislikes are dropped with a console.warn instead of an
 * error. All of those guards live in test/render-smoke.test.mjs and were
 * derived from THIS byte sequence.
 *
 * FROZEN CONTRACT: changing these bytes is not a dependency bump, it is a
 * doctrine change. Updating the hash below is only allowed AFTER re-validating
 * every dist-quirk doctrine (render-smoke dist-validity + app-level static
 * contract guards) against the new dist — never by re-running the test and
 * pasting whatever hash the new file happens to have.
 *
 * So a silent vendor swap (accidental re-vendor, a "helpful" CDN refresh, a
 * partially written file) must fail here, loudly, on its own — not surface
 * later as a rendering behaviour nobody reviewed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const VENDOR_PATH = join(here, '..', 'web', 'vendor', 'cytoscape.min.js')

// Measured with Get-FileHash -Algorithm SHA256 / node crypto over the committed
// bytes of cytoscape 3.34.1 (435503 bytes). See the freeze doctrine above:
// this constant is re-derived only as part of a vendor re-freeze.
const PINNED_SHA256 = '5141892eb19898946e5af8300e14cec15a63a22186a4ca56d76819a91e2a3fe6'

function sha256 (file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

test('V2.12 vendor pin: vendored cytoscape dist is byte-for-byte the pinned dist', () => {
  assert.equal(sha256(VENDOR_PATH), PINNED_SHA256,
    'web/vendor/cytoscape.min.js differs from its pinned sha256 — a vendor ' +
    'change requires re-validating every dist-quirk doctrine first (see header)')
})

test('V2.12 vendor pin is non-vacuous: one mutated byte of a copy turns the guard red', () => {
  const copy = join(tmpdir(), `v212-vendor-mutation-${process.pid}.min.js`)
  try {
    copyFileSync(VENDOR_PATH, copy)
    assert.equal(sha256(copy), PINNED_SHA256, 'the copy must start byte-identical')
    const bytes = readFileSync(copy)
    bytes[0] ^= 0x01
    writeFileSync(copy, bytes)
    assert.notEqual(sha256(copy), PINNED_SHA256,
      'a single flipped byte must break the pin — if this fails the guard is measuring nothing')
  } finally {
    rmSync(copy, { force: true })
  }
})
