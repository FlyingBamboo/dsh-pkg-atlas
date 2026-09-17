# dsh-pkg-atlas

本机 DSH 包依赖图谱：一个独立 HTTP 页面，展示当前 DSH_HOME 已安装的官方
`@deepseek-ai/*` 包与第三方插件之间的依赖与挂载关系。零运行时依赖、纯本机数据、
只读、全离线可用。

页面地址（安装并重启后）：`http://127.0.0.1:3080/dsh-pkg-atlas/`

## 它回答什么问题

- 某个工具/插件在 DSH 生态里的位置：属于哪个功能组、被谁依赖、挂了哪些 bundle。
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

- 组级全景：节点 = 功能组（`repository.directory` 推导），双击组节点展开为单包。
- 搜索：包名或中文描述，回车项点击定位。
- 聚焦：详情面板「聚焦此包」按上下游 BFS 深度 1-3 高亮，URL hash 可分享深链
  （`#node=<id>`）。
- 详情：描述（cordis manifest → README.zh → package.json 链）、挂载方、被依赖、
  依赖、外部依赖、README 原文。
- 顶栏筛选：官方/第三方、mount/peer/dep 边、按 profile 只看其挂载面。
- 「重扫」按钮强制重扫（快照缓存 60s TTL）。

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

浏览器人工清单：组级全景渲染 / 双击展开 plugin 组 / 搜索 `dsh-llm` 定位 /
聚焦上下游与取消 / 详情面板 README / 断链与 unsatisfied 展示（真实 home 约 4 个
broken junction 目录，可与 `Get-ChildItem $env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai`
当场对表）/ 断网重开页面仍可用（全离线）。

注：验证可用**全局安装的 dsh 二进制** + 隔离 DSH_HOME（与真实安装拓扑一致，
无需克隆源码构建）。

## 已知边界（v1）

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
- 图布局在每次筛选/展开后重算（cose 重排），位置不保留。
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
