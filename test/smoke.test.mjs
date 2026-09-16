import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('package.json declares zero runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.dependencies ?? {}, {})
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
})
