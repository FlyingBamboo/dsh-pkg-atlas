# dsh-pkg-atlas

本机 DSH 包依赖图谱：一个独立 HTTP 页面，展示当前 DSH_HOME 已安装的官方
`@deepseek-ai/*` 包与第三方插件之间的依赖与挂载关系。图谱按功能大类分区、
组为复合节点、包在组内成网格，首屏有扫描进度。零运行时依赖、纯本机数据、
只读、全离线可用。

页面地址（安装并重启后）：`http://127.0.0.1:3080/dsh-pkg-atlas/`

## 图谱三层结构

大类区（功能分类：内核·装配 / 会话·状态 / 界面 / LLM·模型 / 编排 / 平台 / 工具 /
集成 / 基础设施，外加插件、profiles、断链、未归类四个特殊区）→ 组
（`repository.directory` 推导的功能组，复合容器节点）→ 包（组内网格）。
节点坐标由视图模型按展开态维度预分配（无布局引擎）：展开/折叠/筛选不重排、
不移动，只重建元素集合，因此位置在交互间保持稳定。

## 它回答什么问题

- 某个工具/插件在 DSH 生态里的位置：属于哪个大类、哪个功能组、被谁依赖、挂了哪些 bundle。
- 一个官方 bundle（如 `dsh-base`）到底把哪些包挂载进 profile（BFS 展开
  `cordis.patch.yml` 的 `name:` 行）。
- 哪些目录断了链（broken junction，标红伪节点）、哪些版本区间装不到满足版本
  （红色 unsatisfied 边）。

## 安装（web profile）

    dsh plugin --profile web add link:D:/codes/harness-dev/dsh-pkg-atlas
    # 重启 DSH 后打开
    http://127.0.0.1:3080/dsh-pkg-atlas/

## 卸载

    dsh plugin --profile web remove dsh-pkg-atlas
    # 重启后人工核对 profiles/web/package.json 的 dsh.profile.bundles 中
    # 无 "dsh-pkg-atlas" 残留行（本插件自身无运行时状态，无其它残留面）

## 页面用法

- 三层图谱：默认组级视图（大类区展开、组为卡片）；双击组卡片展开为单包网格，
  双击大类区标题折叠整个区。搜索/聚焦命中会自动展开祖先。
- 首屏进度：扫描按 目录清单→manifest 读取→组装 三阶段推进，进度条实时显示
  已扫/总数（`/api/status` 轮询）；服务端启动即预热，通常首屏即缓存就绪。
- 大类筛选 chips：**点击 = 隐藏该区**（再点恢复）；官方/第三方、边类型
  （mount/peer/dep/peer-optional）、profile 挂载面、真实跨包边开关、深浅主题、
  中英切换均在顶栏。
- 搜索：包名或中文描述，回车项点击定位（自动展开祖先）。
- 聚焦：点击包节点即双向高亮其依赖路径与被依赖路径——琥珀色为它依赖的下游，
  青色为依赖它的上游，洋红为双向/成环成员；琥珀/青两色同时出现在图例（右下角），
  非路径元素淡出，祖先容器不淡。深度默认「不限」（顶栏可选 1-3），仅包节点可作
  聚焦根（点空白/类型/profile/组卡即清除）；URL hash 可分享深链（`#node=<id>`，
  打开即按不限深度展开定位）。挂载 `mount` 不是向下方向（X→mount→Y 意为 Y 沿
  挂载向上到 X），故某包挂载的内容单列在详情的「挂载 ↓」里。
- 详情：大类/组/类型三级面包屑、描述、依赖路径 ↓ 与被依赖路径 ↑ 两条完整列表
  （每行 `名称@版本 · d{层数} · 边型徽章 · ⚠`，点击即以该行为根重新聚焦）、
  挂载 ↓、外部依赖、README 原文。
- 图例（右下角）：4 种节点形状 + 5 种边类型 + 聚焦两色（依赖路径 ↓ / 被依赖路径 ↑），
  可折叠。
- 「重扫」按钮强制重扫（快照缓存 60s TTL）；扫描中进度条重新走条。

## 开发

    npm test          # node:test，fixture 全部合成，不读真实 ~/.dsh
    npm run check     # node --check 全部 lib + web 脚本

## 隔离真机验证（不影响运行中的 DSH）

每个新终端第一步（先证环境再动手，防污染真实 `~/.dsh`）：

    $env:DSH_HOME = 'D:\codes\harness-dev\dsh-home-test'
    $env:DSH_HOME    # 必须回显测试路径

终端 A：`dsh web --port 3090 --no-open`
终端 B（同 DSH_HOME）：
`dsh plugin --profile web add link:D:/codes/harness-dev/dsh-pkg-atlas`，
重启终端 A 后打开 `http://127.0.0.1:3090/dsh-pkg-atlas/`。

浏览器人工清单：首屏进度条走到就绪 / 三层图谱渲染（大类区→组卡→双击展开包）/
双击大类区标题折叠 / chips 隐藏再恢复 UI 区 / 搜索 `dsh-llm` 定位并展开祖先 /
点击包即双向聚焦（琥珀下游、青上游、洋红成环，图例两色对照）/ 聚焦深度 不限 与
1-3 切换、点空白清除 / 折叠态下聚焦命中落在组卡与大类似然上 / 详情两条路径列表
行点击换根、挂载 ↓ 跳转、README 与依赖跳转 / 断链与 unsatisfied 展示
（真实 home 约 4 个 broken junction 目录，可与
`Get-ChildItem $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai`
当场对表）/ 中英切换 / 深浅主题 / 断网重开页面仍可用（全离线）。

注：验证可用**全局安装的 dsh 二进制** + 隔离 DSH_HOME（与真实安装拓扑一致，
无需克隆源码构建）。

## 已知边界

- 每次视图状态变更（展开/折叠/筛选/聚焦）都整体重建 cytoscape 元素集合，
  无增量动画；换来的是零布局引擎、坐标确定可测（vendored cytoscape 3.x 已无
  compound collapse/expand API）。
- `repository.directory` 不以 `packages/` 开头的官方包（如 `apps/cli`、`apps/web`、
  `native/system/*`）落在「未归类」区：组派生只认 `packages/<组>` 模式。当前
  真实 home 有 3 个：`@deepseek-ai/dsh`、`@deepseek-ai/dsh-web-frontend`、
  `@deepseek-ai/node-addon-system`。
- 大类映射表是维护品（`lib/categories.js`，现 47 个目录组键——当前真实 home 实测 46 组
  在用、1 键为前瞻目录预留）：新增 `packages/*` 目录组未入表时默认落「未归类」，人工补表。
以下限制继承自 v1：

- 挂载面为 bundle/patch 的 `name:` 行启发式抽取：不解析 YAML 结构、`disabled`
  语义、嵌套值；行尾内联注释容忍；`config:` 下恰好叫 `name` 的键可能误抽。
- 非 semver 安装描述（`github:`/`git:`/`link:`/`file:`/`npm:`/`workspace:`/
  `catalog:`/URL）不做版本判定：直接挂最高版本且**不**标 unsatisfied。
- semver 为最小实现：空格复合区间（`">=1.0.0 <2.0.0"`）只取下界；预发布版
  可满足未提及它的区间（对 DSH rc 生态有意为之，已测试钉住）。
- 官方包 package.json 的 cordis 服务清单字段覆盖率约 1/240（cordis vendor 系），
  「消费服务」仅在有值时显示。
- 第三方插件自身 bundle 成员不递归展开（只展开官方包 patch）。
- 缓存 = 60s TTL + 手动「重扫」；外部安装/卸载后最长 60s 视图陈旧。
- 浏览器降级表格模式（cytoscape 加载失败时）为一次性：恢复需刷新页面。
- DSH Desktop profile 未验证（CLI 拒绝 boot desktop）。
- 数据源为 DSH_HOME 已安装内容；不含任何线上目录，无遥测，GET-only。
- vendored cytoscape.min.js 3.34.1（MIT，见 `web/vendor/LICENSE-cytoscape.txt`）。

## 安全模型

- 无任何写操作；路由只读（GET/HEAD），非 GET 一律 405。
- `/api/readme` 的 `id` 仅用于在扫描快照中查节点，文件路径取自扫描结果内部字段，
  用户输入永不参与路径拼接；恶意 id 在正则卫生层即 400。
- 响应不回显内部错误文本（500 → `{error:'internal-error'}`）；所有响应
  `X-Content-Type-Options: nosniff`；页面 CSP 限定 `default-src 'self'`。
- 图数据中的路径一律相对化为 `$DSH_HOME/...`，不泄露绝对路径。
- 若启用 DSH 远程访问（tailscale/配对等），本页面与 `/api/graph` 的包清单一并
  暴露给可达者，请视为知情选择。
