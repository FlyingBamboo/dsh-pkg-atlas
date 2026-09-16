import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const w = async (root, rel, content) => {
  const p = join(root, ...rel.split('/'))
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, content, 'utf8')
}

/** Synthesized DSH_HOME mirroring the verified local layout (spec §4). */
export async function buildFixture(root) {
  const H = root
  await w(H, 'profiles/web/package.json', JSON.stringify({
    dependencies: { 'plugin-x': '^1.0.0', '@deepseek-ai/base': '^1.0.0', 'patched-plugin': '^9.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/base'] } },
  }))
  await w(H, 'profiles/web/cordis.patch.yml', [
    '- insert:', "    - id: p1", "      name: '@deepseek-ai/extra'",
    '- insert:', "    - id: p2", "      name: 'patched-plugin'",
    '- insert:', "    - id: p3", "      name: '@deepseek-ai/ghost'",
    // M2: escaper 需被挂载才会进 BFS，词法守卫才有机会开火
    '- insert:', "    - id: p4", "      name: '@deepseek-ai/escaper'",
    "# name: 'commented-out-plugin'",
  ].join('\n'))
  // web layer: one referenced plugin + one hoisted lib (must NOT enter universe)
  // I1: plugin-x 自带 dsh.bundle.patch——第三方包自身 patch 在 v1 不展开（scope 守卫）
  await w(H, 'profiles/web/node_modules/plugin-x/package.json', JSON.stringify({
    name: 'plugin-x', version: '1.0.0',
    dependencies: { '@deepseek-ai/util': '^2.0.0', lodash: '^4.0.0' },
    peerDependencies: { '@deepseek-ai/core': '^1.0.0' },
    peerDependenciesMeta: { '@deepseek-ai/core': { optional: true } },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await w(H, 'profiles/web/node_modules/plugin-x/cordis.patch.yml', [
    '- insert:', "    - id: x1", "      name: '@deepseek-ai/core'",
  ].join('\n'))
  await w(H, 'profiles/web/node_modules/plugin-x/README.md', '# plugin-x\n\nX 插件。\n')
  await w(H, 'profiles/web/node_modules/lodash/package.json', JSON.stringify({ name: 'lodash', version: '4.17.21' }))
  await w(H, 'profiles/web/node_modules/@deepseek-ai/util/package.json', JSON.stringify({ name: '@deepseek-ai/util', version: '2.0.0', repository: { directory: 'packages/util/util' } }))
  await w(H, 'profiles/web/node_modules/.pnpm/whatever/package.json', JSON.stringify({ name: 'whatever', version: '1.0.0' }))
  // shared layer
  await w(H, 'profiles/node_modules/@deepseek-ai/base/package.json', JSON.stringify({
    name: '@deepseek-ai/base', version: '1.0.0',
    repository: { directory: 'packages/bundle/base' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: { '@deepseek-ai/util': '^1.0.0' },
  }))
  await w(H, 'profiles/node_modules/@deepseek-ai/base/cordis.patch.yml', [
    '- insert:', "    - id: b1", "      name: '@deepseek-ai/core'",
    "    - id: b2", "      name: '@deepseek-ai/extra'",
    "    - id: b3", "      name: '@deepseek-ai/util'",
  ].join('\n'))
  await w(H, 'profiles/node_modules/@deepseek-ai/core/package.json', JSON.stringify({ name: '@deepseek-ai/core', version: '1.0.0', repository: { directory: 'packages/core/core' }, description: 'pkg-desc-core' }))
  await w(H, 'profiles/node_modules/@deepseek-ai/core/README.zh.md', '---\ndescription: 核心内核\n---\n# core\n')
  await w(H, 'profiles/node_modules/@deepseek-ai/extra/package.json', JSON.stringify({ name: '@deepseek-ai/extra', version: '1.0.0' }))
  await w(H, 'profiles/node_modules/@deepseek-ai/util/package.json', JSON.stringify({ name: '@deepseek-ai/util', version: '1.0.0', repository: { directory: 'packages/util/util' } }))
  // M2: 官方包 bundle patch 用 ../ 越出包目录——词法包含守卫必须拒绝读取该文件
  // （注意：resolve('../escape.yml') 落在 @deepseek-ai/ 层，不是 node_modules/ 层；
  //   文件放这里，守卫若被删除就会被真实读到并展开，测试才非平凡）
  await w(H, 'profiles/node_modules/@deepseek-ai/escaper/package.json', JSON.stringify({
    name: '@deepseek-ai/escaper', version: '1.0.0',
    repository: { directory: 'packages/escaper/escaper' },
    dsh: { bundle: { patch: '../escape.yml' } },
  }))
  await w(H, 'profiles/node_modules/@deepseek-ai/escape.yml', [
    '- insert:', "    - id: esc1", "      name: '@deepseek-ai/core'",
  ].join('\n'))
  // 空目录：无 package.json（w() 的 join 会吃掉尾斜杠并写出 0 字节文件，必须直接 mkdir）
  await mkdir(join(H, 'profiles', 'node_modules', '@deepseek-ai', 'pkg-broken'), { recursive: true })
  await w(H, 'profiles/node_modules/patched-plugin/package.json', JSON.stringify({ name: 'patched-plugin', version: '0.1.0' }))
  await w(H, 'profiles/node_modules/hoisted-lib/package.json', JSON.stringify({ name: 'hoisted-lib', version: '1.0.0' }))
  await w(H, 'profiles/node_modules/@types/node/package.json', JSON.stringify({ name: '@types/node', version: '20.0.0' }))
  return H
}

export const EXPECTED_PACKAGES = [
  '@deepseek-ai/base@1.0.0', '@deepseek-ai/core@1.0.0', '@deepseek-ai/escaper@1.0.0', '@deepseek-ai/extra@1.0.0',
  '@deepseek-ai/util@1.0.0', '@deepseek-ai/util@2.0.0', 'plugin-x@1.0.0', 'patched-plugin@0.1.0',
]
