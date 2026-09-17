/**
 * Category taxonomy (spec §3): pure data, zero imports. Maps scanned group ids
 * to the 9 render-ordered categories; the 4 special zones (plugin, profiles,
 * broken, ungrouped) are their own categories and pass through `categoryOf`.
 * Unknown groups fall back to `ungrouped`, so the mapping can lag the host
 * without ever dropping nodes from the view.
 */

/** Render order of the 9 main categories (major-zone band layout, spec §4). */
export const CATEGORY_ORDER = ['kernel', 'session', 'llm', 'tools', 'orchestration', 'integration', 'ui', 'platform', 'infra']

/** Zones that are categories in their own right, appended after CATEGORY_ORDER. */
export const SPECIAL_ZONES = [
  { id: 'plugin', zh: '第三方插件', en: 'Plugins' },
  { id: 'profiles', zh: 'Profile 挂载面', en: 'Profiles' },
  { id: 'broken', zh: '断链', en: 'Broken' },
  { id: 'ungrouped', zh: '未归类', en: 'Uncategorized' },
]

const CATEGORY_LABELS = [
  { id: 'kernel', zh: '内核与装配', en: 'Kernel & Assembly' },
  { id: 'session', zh: '会话与状态', en: 'Session & State' },
  { id: 'llm', zh: '模型调用', en: 'Model Calling' },
  { id: 'tools', zh: '工具与执行', en: 'Tools & Execution' },
  { id: 'orchestration', zh: '编排与子代理', en: 'Orchestration & Subagents' },
  { id: 'integration', zh: '集成生态', en: 'Integrations' },
  { id: 'ui', zh: '界面与交互', en: 'UI & Interaction' },
  { id: 'platform', zh: '平台与安全', en: 'Platform & Security' },
  { id: 'infra', zh: '基础设施', en: 'Infrastructure' },
]

const SPECIAL_IDS = new Set(SPECIAL_ZONES.map((z) => z.id))

/** Group id -> category id, spec §3 table in full (47 keys, transcribed key by key). */
export const GROUP_TO_CATEGORY = {
  core: 'kernel', boot: 'kernel', bundle: 'kernel', context: 'kernel', preset: 'kernel', feedback: 'kernel', settings: 'kernel', 'runtime-diagnostics': 'kernel',
  session: 'session', 'session-query': 'session', attachment: 'session', compaction: 'session', spill: 'session', storage: 'session',
  llm: 'llm',
  fs: 'tools', shell: 'tools', subprocess: 'tools', terminal: 'tools', 'code-runtime': 'tools', hooks: 'tools', todo: 'tools', schedule: 'tools',
  subagent: 'orchestration', jobs: 'orchestration', workflow: 'orchestration', goal: 'orchestration', plan: 'orchestration', skill: 'orchestration',
  mcp: 'integration', acp: 'integration', sdk: 'integration', extensions: 'integration', webhook: 'integration',
  web: 'ui', client: 'ui', interaction: 'ui', workspace: 'ui', typert: 'ui',
  host: 'platform', api: 'platform', credentials: 'platform', guard: 'platform', sandbox: 'platform', identity: 'platform',
  util: 'infra', vendor: 'infra',
}

/**
 * Category of a scanned group: special zones pass through unchanged,
 * unknown groups fall back to `ungrouped`.
 */
export function categoryOf(group) {
  if (SPECIAL_IDS.has(group)) return group
  return GROUP_TO_CATEGORY[group] ?? 'ungrouped'
}

/** All 13 categories with bilingual labels: CATEGORY_ORDER order + specials appended. */
export const CATEGORIES = [...CATEGORY_LABELS, ...SPECIAL_ZONES]
