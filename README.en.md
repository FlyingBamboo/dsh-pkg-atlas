# dsh-pkg-atlas

English · [中文](README.md)

A local dependency atlas for DSH packages. It is one standalone HTTP page showing how
the official `@deepseek-ai/*` packages and third-party plugins installed under the
current DSH_HOME depend on and mount each other. The first screen shows scan progress.
The graph groups packages into functional zones, renders each group as a compound
card, and lays the packages out in a grid inside it. There are no runtime dependencies,
all data comes from this machine, the page is read-only, and it works offline.

Page URL (after installing and restarting): `http://127.0.0.1:3080/dsh-pkg-atlas/`

## What it answers

- Where a tool or plugin sits in the DSH ecosystem: which zone and which group it
  belongs to, who depends on it, and which bundles it mounts.
- Which packages an official bundle (say `dsh-base`) actually mounts into a profile:
  a BFS expansion over the `name:` lines in `cordis.patch.yml`.
- Which directories have broken links (broken junction, red pseudo-node), and which
  version ranges cannot resolve to a satisfying version (red unsatisfied edge).

## Install (web profile)

Install straight from GitHub (pnpm resolves owner/repo):

    dsh plugin --profile web add FlyingBamboo/dsh-pkg-atlas

Or search `dsh-pkg-atlas` in the DSH Web GUI's market and install it with one click.
Restart DSH, then open `http://127.0.0.1:3080/dsh-pkg-atlas/`.

## Uninstall

    dsh plugin --profile web remove dsh-pkg-atlas
    # After the restart, check by hand that profiles/web/package.json carries no
    # leftover "dsh-pkg-atlas" line in dsh.profile.bundles (the plugin itself keeps
    # no runtime state, so there is no other residue)

## What to look at first

- The header carries a two-state granularity switch, groups | packages, and it starts
  on groups. What you see then: zones, group cards, and opened packages inside them.
- In a cold state (no focus yet), a plain left click on any node only selects it and
  shows its details. Packages and groups behave the same here.
- Double-click depends on the tier. At the groups tier, double-clicking a group card expands
  or collapses it, and double-clicking a zone title folds the whole zone. At the packages
  tier, both double-clicks are deliberate no-ops.
- Right-click any target and you get that target's own command list. On the blank
  canvas: reset view / exit focus / auto-arrange.
- Search takes a package name or a Chinese description. Click the item marked Enter to
  jump to it; its ancestors open automatically.
- Two buttons in the header: reset view fits the current render set back into the
  viewport, and auto-arrange drops every manual drag position.
- The legend sits in the lower left corner and collapses: 4 node shapes, 5 edge
  kinds, and the two focus colors (depends paths ↓ / depended-on paths ↑).

## Usage in detail

### View and granularity

- The graph has three tiers: zone → group → package, packages in a grid inside their
  group. A zone is a functional category: Kernel & Assembly, Session & State, UI &
  Interaction, Model Calling, Orchestration & Subagents, Platform & Security, Tools &
  Execution, Integrations, Infrastructure, plus the four special zones Plugins,
  Profiles, Broken, and Uncategorized. A group is derived from `repository.directory`
  and renders as a compound container card.
- Granularity has exactly two states and there is no auto tier. Groups shows zone →
  card → expanded packages; packages expands every group at once. The wheel only
  zooms the picture, it never changes tiers.
- A granularity switch counts as a structural change: full rebuild, camera stays
  where it is. The packages tier forces the real cross edges on; switching back
  restores the checkbox's own value.
- The view model assigns all coordinates ahead of time from the expansion state.
  There is no layout engine. Expanding, collapsing, filtering, and switching tiers
  only rebuild the element set, so nothing re-lays out and positions stay stable
  between interactions.
- The camera moves in exactly four situations: the first-screen fit, a search or
  deep-link jump, reset view, and auto-arrange. reset view (the header button or the
  right-click on the blank canvas) fits the whole render set back into view (padding
  40, a 250 ms tween). It only moves the camera and leaves focus, selection, folding,
  and snapshots alone. Every repaint keeps the viewport, and a rescan does not move
  the camera either.
- The first screen shows scan progress. The scan runs the three phases listing
  directories → reading manifests → assembling graph, and the bar reports scanned/total
  live through `/api/status` polling. The server warms the cache at startup, so the
  first screen is usually ready from cache.

### Focus and paths

- Focus is what the UI calls the dependency graph. Once you enter it, both directions
  light up along its depends paths and depended-on paths: amber for the packages it
  depends on, teal for the ones that depend on it, magenta for members related both
  ways or in a cycle. Everything off a path fades, and ancestor containers do not
  fade along with it; they turn into dashed, semi-transparent context frames.
- Every door into it is an explicit navigation: right-click a package and pick
  dependency graph, double-click a package, a path row, mount row, or jump button in
  the details panel, a table row, a search hit, or the deep link `#node=<id>`. Only a
  package node can root a path: clicking a group card turns into that group's group
  focus, and a click on blank space, a type, or a profile exits.
- While focused, clicking another package walks the path. The previous root goes into
  the header breadcrumb "← back (a → b → c)", which steps back one level at a time
  (up to 20 recorded steps, the last 4 levels shown). A blank click, Esc, or the
  exit dependency graph button ends it.
- Depth defaults to unlimited and takes 1-3. An edge kind you uncheck while inside a
  path is hidden outright, which is how it differs from a faded non-member.
- `mount` is not a downward direction. X→mount→Y reads as "Y climbs up to X through
  the mount", so what a package mounts is listed on its own under mounts ↓ in the
  details.
- Group focus: right-click a group card and pick focus neighborhood (1 hop), or share
  one directly with the deep link `#node=g:<group name>`. Aggregate edges appear only
  inside a group focus (width ∝ touched-edge count), and the depth is fixed at 1 hop.
- Inside a group focus, the neighbor cards (member packages when the group is open or
  when you are on the packages tier) are colored by direction: amber for groups this
  one depends on, teal for groups that depend on it (mount climbs included), magenta
  for both directions. The root card keeps its gold selection ring but takes no
  direction color, and ancestors become dashed context. Clicking a neighbor card
  walks the stack and re-roots; clicking a member package switches into the
  dependency graph; a blank click or Esc exits, camera unmoved.
- During a group focus the details panel gains two sections, related groups (N) and
  related packages (N). Each row is a direction arrow, a name ×count, edge-kind
  badges, and (in the Broken zone) a ⚠, sorted down → up → both, then by name. A
  group row walks into that group; a package row re-roots the dependency graph on it.

### Switches and filters

- Zone chips: a single click hides that zone, and clicking again brings it back. A
  double click shows only that zone and hides the rest; double-clicking the same chip
  restores everything. The buttons at the row tail, show all and hide all, switch
  zones in bulk.
- Everything else lives in the header: the official/third-party scope, the edge kinds
  filter (mount/peer/dep/peer-optional), the profile mount surface, the real cross
  edges toggle, light/dark theme, zh/en, and the granularity switch.

### Dragging

- Anything you drag by hand (zones, group frames, packages) is recorded in a
  render-layer override table. Tier switches, filters, expand/merge, and entering or
  leaving a focus never clear it. Only a rescan drops entries for elements that no
  longer exist.
- Dragging a parent frame translates its whole rendered subtree live (zone → card →
  package, group frame → member packages). On drop, the parent and each moved child
  record their own absolute position. Dragging a child moves only the child; the
  parent frame stays where it is.
- What you see stays where you left it, on every tier. A group card you dragged is no
  longer re-centered by its members when you switch to the packages tier, and a member
  you never dragged follows its parent by "parent render position + the child's
  relative slot offset inside the model".
- To hand the layout back to the model: press auto-arrange in the header (or
  the same-named row in the blank-canvas menu, greyed when nothing was dragged). It
  clears the override, everything drops back onto the zone-band grid, and one fit
  sweeps across the restored layout.

### Details panel

- Hover peek: dwell 250 ms on any node, including nodes inside a path, and a small
  card appears with name@version, zone · group, a truncated description, the counts
  of direct depends and depended-by (counted with path semantics; mount does not
  count downward), and ⚠ flags for unsatisfied edges or a broken package. The card is
  read-only. It never touches focus or selection, and it closes when you move away,
  pan, zoom, or click.
- Package details: a three-level breadcrumb (zone / group / kind), the description,
  and two lists, depends paths ↓ and depended-on paths ↑. They fold by BFS layer: d1
  (direct hits) is open by default, and d2 onward waits behind a "d2 (N)" tier header
  you can click open and shut. Each layer lists at most 60 rows with a "+N more"
  tail. A row reads `name@version · d{layer} · edge-kind badges · ⚠`. Clicking a row
  enters the dependency graph from it or re-roots on it (a profile row is not a legal
  path root; clicking one exits the dependency graph). Also there: mounts ↓, external
  dependencies, and the README source text.
- Group card and zone details: the member package list. The N in the "member packages
  (N)" header is always the true total, whether or not the list is truncated. A row
  reads `name@version [kind] [third-party] ⚠broken ⚠unsatisfied`, sorted by name →
  version → id, capped at 200 rendered rows with a "+N more" tail. Clicking any
  member row takes the same door as a search jump: it opens the row's zone and group,
  roots the dependency graph on the package, flashes it in the center, and dismisses
  the peek card. Illegal path roots such as a broken package are selected and the
  path ends. Zone details divide members into sections by group, sections in
  alphabetical order. A section header "group name ×group total" is a plain selection
  of that group (zero navigation), each group lists at most 10 rows, and the rest
  hides behind an "N more" tail.
- Names and versions inside the panel: when the members share one npm scope prefix
  (say `@deepseek-ai/`), rows drop the prefix and the full prefix shows once as a
  badge on the panel head; the full name@version is available on hover. When every
  version in a group is identical it lifts into the group header (`· ver`) and stays
  out of the rows. When most agree, the header takes the majority version and the odd
  rows are marked amber. When all differ, versions show inline. The zone, group, and
  package detail containers each carry a title badge and a left color band, so you
  can tell at a glance which level the panel sits at.

### General

- The right-click menu opens at the click point and flips into the frame near an
  edge. Closing it is only a close: the click that dismisses the menu is swallowed,
  and the next click works normally. Panning, zooming, window resizing, or any
  structural repaint dismisses it. Right-clicking an edge brings up nothing, since
  edges have no commands. Rows that do not apply are kept, greyed out, never hidden.
- What each target's menu carries: a group card gets expand/merge, focus neighborhood
  (1 hop), and show only this zone. A zone gets collapse zone / expand zone, show
  only this zone, and hide this zone. A package gets dependency graph. The blank
  canvas gets reset view, exit focus, and auto-arrange.
- Esc closes the right-click menu first, then the search results panel, then (when
  you are not typing in a field) exits the focus. Otherwise it does nothing.
- Package labels clamp at 50 px and end in an ellipsis. The graph does not chase
  readable full names; the peek card and the details panel carry them. Wheel zoom
  sensitivity is 2.5.
- The zh/en switch and the light/dark theme are in the header. The page works fully
  offline: unplug the network and reopen it, it still runs.

## Low coupling

DSH moves fast, and a plugin wired to its internal APIs breaks along with it, over
and over. So this one keeps its coupling surface close to zero:

- Zero runtime dependencies. The node side uses only the Node standard library. The
  page's one third party is the vendored cytoscape file, pinned by sha256 (see
  `test/vendor-pinned.test.mjs`), and it does not come through npm install.
- It calls no internal module of the host. All data comes from scanning the installed
  content on the DSH_HOME disk (package.json, cordis.patch.yml, directory junctions).
  It imports nothing from DSH and hooks nothing in it.
- One mount point, and it is optional. The routes register only when the host
  webserver is present (`ctx.inject(['webServer'], …)`). If it is not, the inject
  never fills, the plugin stays quietly inactive, and host startup is unaffected. The
  peerDependency is marked optional, and a refused route registration only logs; it
  does not throw.
- No build step. The browser code is plain script, and the repository is what runs.

The consequence: if a DSH upgrade still manages to break this plugin, the breakage is
usually in the input format, and the fix lands in the scan layer. The page and its
rendering are not affected by host changes.

## Security model

- There are no write operations. The routes are read-only (GET/HEAD), and every
  other method gets 405 with `Allow: GET, HEAD`.
- The `id` on `/api/readme` only looks a node up in the scan snapshot. The file path
  comes from an internal field of the scan result (`_dir`; outgoing JSON always
  strips `_`-prefixed fields), so user input never joins a path. A hostile id dies at
  the regex hygiene layer with a 400.
- Responses never echo internal error text (a 500 is the fixed
  `{error:'internal-error'}`, and the real error goes only to the host logger). Page
  and API/asset responses carry `X-Content-Type-Options: nosniff`, and the page CSP is
  `default-src 'self'`, with `'unsafe-inline'` allowed additionally for style.
- Paths in the graph data are always relativized to `$DSH_HOME/...`; absolute paths
  are not leaked.
- The page rides on the host's web port and has no authentication of its own. If you
  turn on DSH remote access (tailscale, pairing, or the like), this page and the
  package inventory behind `/api/graph` are exposed to whoever can reach them. Treat
  that as an informed choice.

## Known limits (user's view)

- The cache is a 60 s TTL plus the manual rescan: after an install or uninstall done
  elsewhere, the view can stay stale for up to 60 s.
- The mount surface is a heuristic extraction of `name:` lines from bundle/patch
  files. It does not parse YAML structure, `disabled` semantics, or nested values.
  Inline comments at line end are tolerated. A key named exactly `name` under
  `config:` can be picked up by mistake.
- Non-semver install specifiers (`github:`/`git:`/`link:`/`file:`/`npm:`/`workspace:`/
  `catalog:`/URL) get no version verdict: the highest version is attached and nothing
  is marked unsatisfied.
- semver support is a minimal implementation. A space-compound range
  (`">=1.0.0 <2.0.0"`) takes only its lower bound, and a prerelease can satisfy a
  range that never mentions it. For the DSH rc ecosystem this is deliberate, and
  tests pin it.
- A third-party plugin's own bundle members are not expanded recursively. Only
  official package patches are.
- An official package whose `repository.directory` does not start with `packages/`
  lands in the Uncategorized zone: the group derivation only recognizes the
  `packages/<group>` pattern.
- The browser fallback table (when cytoscape fails to load) is one-shot. Recovering
  takes a page refresh.
- The DSH Desktop profile is unverified (the CLI refuses to boot desktop).
- The data source is the installed content under DSH_HOME. There is no online registry
  of any kind, no telemetry, and the API is GET-only.

## Development

    npm test          # node:test; every fixture is synthetic, nothing reads the real ~/.dsh
    npm run check     # node --check over all lib + web scripts

For the isolated on-machine verification flow, the manual browser checklist, layout
notes, and the maintainer-facing boundaries, see docs/DEVELOPMENT.md.

## License

MIT (see `LICENSE`). The vendored cytoscape.min.js 3.34.1 is MIT as well; see
`web/vendor/LICENSE-cytoscape.txt`.
