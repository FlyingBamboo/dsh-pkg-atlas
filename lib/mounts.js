const NAME_LINE = /^\s*-?\s*name:\s*['"]?([\w@./-]+)['"]?\s*$/

/**
 * Best-effort extraction of mounted package names from cordis patch YAML text.
 * Heuristic by design (spec §6.6): every `name:` line at any depth counts,
 * `#`-commented lines are skipped, `disabled` semantics are NOT parsed.
 * @param text - raw patch file content
 * @returns deduplicated names in first-seen order
 */
export function extractPatchNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue
    const m = NAME_LINE.exec(line)
    if (m) out.add(m[1])
  }
  return [...out]
}
