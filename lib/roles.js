import { readFile } from 'node:fs/promises'

const FM = /^---\r?\n([\s\S]*?)\r?\n---/

/** Extract `description:` value from YAML front-matter; unquotes. */
export function frontMatterDescription(text) {
  const block = FM.exec(text)
  if (!block) return null
  const line = /^description:\s*(.+)\s*$/m.exec(block[1])
  if (!line) return null
  const raw = line[1].trim()
  if (raw.length > 1 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1)
  }
  return raw
}

/** First meaningful prose line: skips front-matter, blanks, headings, badge/image-only lines. */
export function firstProseLine(text) {
  const body = text.replace(FM, '')
  for (const line of body.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#') || s.startsWith('---')) continue
    if (s.startsWith('[!') || s.startsWith('![') || s.startsWith('<')) continue
    return s
  }
  return null
}

const readTextSafe = async (p) => {
  try { return await readFile(p, 'utf8') } catch { return null }
}

/** Merge the spec §6.4 description chain for one package directory. */
export async function resolveDescription(pkg, { dir, read = readTextSafe }) {
  const manifest = pkg['@deepseek-ai/cordis']?.description ?? {}
  const zhReadme = await read(`${dir}/README.zh.md`)
  const md = await read(`${dir}/README.md`)
  const zhFm = zhReadme && frontMatterDescription(zhReadme)
  const zhProse = zhReadme && firstProseLine(zhReadme)
  const mdFm = md && frontMatterDescription(md)
  const mdProse = md && firstProseLine(md)
  const first = (...xs) => { for (const x of xs) if (x) return x; return null }
  const zh = first(manifest.zh, zhFm, zhProse, pkg.description, mdFm, mdProse)
  const en = first(manifest.en, pkg.description, mdFm, mdProse, zhFm, zhProse)
  return { zh: zh ?? null, en: en ?? null }
}
