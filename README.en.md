# WebLockShot (v2.3)

> English edition. The Chinese [`README.md`](./README.md) is canonical and may carry extra detail.

An **industrial-grade, multi-Agent video production and CapCut/Jianying project delivery workbench** for
e-commerce creators and vertical-video teams — now extended with an **Agent Canvas** that turns it into a
general-purpose creative studio.

- **🎨 Agent Canvas (new · free-form creative space)**: a third workspace mode on a tldraw infinite canvas.
  One sentence in the chat bar (or one of five scene templates: commerce video / brand visuals / drama
  storyboard / game promo / App UI) → LLM or demo orchestration lays out an Agent node graph (single-click
  batch undo) → script writing (ScriptWriter + Critic) → 9:16 GSAP storyboard preview → mock multi-engine
  shot-by-shot rendering (two-phase wallet transactions on the canvas) → artifact cards → one-click CapCut
  draft zip. Box-select nodes to **distill them into a Skill workflow package** (manifest JSON: node topology
  + parameter slots + input/output declarations, with artifacts and heavy assets stripped); importing rebuilds
  the node group so you only fill in new input (two official Skills ship built in: “six-step commerce flow”
  and “single-image quick shot”). The memory system weights script sampling by per-structure / per-hook /
  per-category win rates (Laplace smoothing). Edges are validated against a type-compatibility contract, and
  the whole canvas persists to localStorage with cross-tab sync.
- **🛒 Full six-step commerce workflow**: multimodal product import (link / image / video frame extraction) →
  5 proven structures + golden-3-second hook library (JSON data assets + category routing + win-rate weighted
  sampling) → dual-Agent script writing with adversarial review → 9:16 GSAP storyboard preview → visual prompt
  compilation → concurrent task-queue rendering → CapCut/Jianying draft export with microsecond-level
  audio/video/subtitle alignment (plus a full asset zip).
- **⚡ Single-Agent fast path**: high-conversion prompt presets, AI camera-movement rewriting, multimodal
  reference images/videos, 1–60 s duration tuning.
- **🤖 Multi-Agent director room**: with a real LLM it runs a four-agent structured deliberation
  (director + camera + QA + scheduler) with genuine QA scores; without an API key it is honestly labelled
  “demo animation mode · scores are not real” and never fabricates scores.
- **📊 Feedback loop**: manually record platform metrics (3-second view-through, completion, conversions) and
  aggregate win rates per structure/hook/category (Laplace smoothing); ScriptWriter sampling is weighted by
  real win rates.
- **🔥 Bring your own ComfyUI GPU compute**: Vite proxy in development, zero-dependency companion server proxy
  in production, calling Wan 2.1 workflows directly, with a one-click GPU VRAM probe.
- **💰 Two-phase virtual wallet**: per-refId freeze ledger — freeze before rendering, settle on success, full
  refund on error/timeout/cancel; settle/refund without a freeze receipt is rejected, repeated settlement is
  idempotent, orphaned freezes are reclaimed after a 30-minute TTL. Canvas generation nodes use the very same
  pipeline (there is exactly one implementation site-wide).
- **📥 CapCut / Jianying desktop draft delivery**: `draft_content.json` with video track + narration track +
  styled-subtitle track aligned to microseconds, plus a complete asset zip. When the companion server is
  online, a “send to companion server” button appears and unpacks it straight into your local draft folder.
- **🔊 Edge-TTS narration (companion server)**: `POST /api/tts` synthesizes narration mp3 in pure JS — no
  Python, no API key. Toggle with `WLS_TTS` (on by default).
- **🎬 Server-side rendering (companion server)**: `POST /api/render` merges storyboard video + TTS audio +
  optional subtitles into a final mp4 with ffmpeg. `WLS_FFMPEG=auto` probes the binary; the Docker image ships it.
- **🎭 Drama rough-cut studio (kept for compatibility)**: six-shot drama previews and prompt-pack export, zero regression.

> 📖 **Full handbook**: [docs/HOW_TO_USE.en.md](./docs/HOW_TO_USE.en.md) (Chinese: [docs/HOW_TO_USE.md](./docs/HOW_TO_USE.md)).

> 📄 **License**: our own code is [MIT](./LICENSE); **third-party dependencies keep their own licenses**
> (tldraw is a commercial license, GSAP uses its own free license). See [`NOTICE`](./NOTICE) for the full list.

---

## ⚡ Quick start

### 1. Try it online (pure front end, no server)

<https://qwqcool.github.io/WebLockShot/>
(API keys live only in the browser's `sessionStorage` and are never uploaded; a mock rendering engine and a
0-key template engine are built in, so it works immediately.)

### 2. Local development with your own GPU

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (port 5173, ComfyUI reverse proxy enabled automatically)
npm run dev

# 3. Quality gate (node unit tests + vitest UI smoke tests)
npm test

# 4. Production build
npm run build
```

---

## 🎨 Agent Canvas

Enter via the top bar (“🎨 Agent Canvas”) or the deep link `?view=canvas` (tldraw loads in its own lazy chunk,
so the commerce/drama bundles are unaffected). Canvas planning lives in [CANVAS_PLAN.md](./CANVAS_PLAN.md).

**Delivered so far (Phase 1 A+B, Phase 2 A+B, Phase 3 C/D/E)**

- **Free-form creative space**: 9 Agent node kinds (requirement brief / asset import / script writing /
  storyboard preview / video generation / local repaint / image generation† / 3D camera stage† / delivery),
  freely placed and wired; the canvas document persists to localStorage with cross-tab sync
  († = placeholder for a later phase, greyed out and honestly labelled).
- **🖌️ Local repaint (v2.2)**: connect an artifact card into a repaint node → brush or lasso the region
  (mask PNG stored at source-image size, restorable after reload) → run inpaint: with ComfyUI online it uses
  real workflows (FLUX.1 Fill / SD inpainting presets, or custom JSON); offline it falls back to a demo repaint
  (mosaic transform inside the mask) labelled “🧪 demo repaint · not a real generation”. Results stack as
  versions on the artifact card (‹ v k/N › switch and roll back, up to 20 versions).
- **Chat-bar orchestration**: one sentence or a scene template → without a key a deterministic demo
  orchestration runs (“🧪 demo orchestration · not a real LLM”); with a key a real LLM returns a structured
  topology (zod-validated, honest fallback on failure). The whole batch supports “↩️ undo this orchestration”
  and a single Ctrl+Z.
- **🧩 Skill distillation and reuse (v2.3)**: box-select ≥2 nodes → “📦 Export Skill” produces a manifest JSON
  (node topology + zod-validated parameter-slot whitelist + input/output declarations; artifact references,
  maskRef and import history are stripped so it is portable across devices) → “📥 Import Skill” rebuilds the
  node group on a new canvas (node ids fully remapped, Ctrl+Z rolls back exactly the import batch). Entry nodes
  highlight “📥 fill new input” while other parameters carry over — swap the product image or the brief and
  re-run the same topology. Two official Skills ship built in: **six-step commerce flow**
  (brief→product→script→storyboard→generate→deliver) and **single-image quick shot** (product→generate direct
  edge, “⚡ single-shot · demo engine” with honest labelling).
- **🧠 Memory system (v2.3 · structured, not mystical)**: feedback records (same source as the feedback
  dashboard) go through **the same Laplace aggregation** (`computeWinRates`, the only implementation
  site-wide) to produce per-structure/hook/category win rates; canvas script nodes weight their sampling and
  show a “📊 this suggestion comes from your history” badge (hidden when there is no history). Two honest
  modes: with the companion server and `WLS_STORAGE=sqlite`, records go through `/api/memory/records`
  (`/healthz` capability `memory:'sqlite'`); in pure front-end mode it degrades to local IndexedDB and is
  labelled “memory stored locally only”. The settings panel can inspect (count + top-3 win rates per bucket)
  and clear it (scope is stated; after clearing, win rates fall back to the 0.5 prior).
- **Nodes are pipelines**: script nodes reuse ScriptWriter+Critic (demo-mode Critic scores are labelled
  “not real”), storyboard nodes embed the GSAP 9:16 stage (the sell-mode component, unchanged), and video
  generation runs the full `useVideoPipeline` (two-phase wallet transactions / circuit breaker / idempotency —
  the same ledger as the six-step workbench).
- **Artifacts and delivery**: rendered output becomes a card automatically (videos are moved into IndexedDB;
  `blob:` is refused for persistence); three asset-import entries (image upload / video frame extraction /
  link archive); the delivery node packages a CapCut draft zip in the browser and shows the wallet balance.
- **Data-flow contract**: edges are type-checked (e.g. `storyboard → video generation` is legal, the reverse
  is rejected with a reason); edge ids are stable across reloads and arrows are re-materialised on refresh.

**Honest boundaries**: Kling/Jimeng are not exposed in canvas mode yet (use the commerce workbench; buttons are
honestly disabled without keys); the mock engine costs 0 credits; when ComfyUI is offline local repaint falls
back to the demo mode (labelled as not real); single-shot rendering only uses the mock/demo engine (real
engines await a live environment); pure front-end memory is local-only and labelled as such; image generation
and the 3D camera stage are placeholders for later phases; the tldraw free tier adds a license watermark
(commercial license decision pending).

## 🖥️ Local companion server (optional, npx form)

Start the zero-dependency companion server when you need production builds to talk to ComfyUI / video APIs
directly, or want one-click draft unpacking:

```bash
npx weblockshot          # or: npm run build && npm run start:server
# custom: node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
```

On Windows you can double-click `start-weblockshot.bat` (installs dependencies, builds, starts).

Capabilities: static hosting of `dist/` + `/api/kling` `/api/jimeng` `/api/comfyui` reverse proxies +
`POST /api/jianying/draft-zip` (unzip straight into the local draft folder) + `POST /api/tts` (Edge-TTS mp3) +
`POST /api/render` (server-side ffmpeg composition).

Reserved capabilities (switch by env var; unset = local default): `GET /healthz` (version / storage mode /
uptime / capability flags), `WLS_STORAGE=memory|sqlite` session storage, `/api/llm` LLM proxy (needs
`WLS_LLM_TARGET`), `WLS_KEYS` proxy key injection (unset = pass-through),
`PUT/GET/DELETE /api/sessions/:id` (BackendAdapter REST backend).

---

## ✅ Verification levels (honest labelling)

Engine and deployment capabilities are labelled by **how far they were actually verified**:

| Capability | Verification level | Notes |
|---|---|---|
| Kling JWT signing (HS512/HS256, official header/payload) | ✅ Contract-verified | Independent reference implementation (node:crypto) with locked vectors + cross-checks, see `src/media/__tests__/authVectors.test.ts` |
| Jimeng V4 HMAC-SHA256 signing (Volcengine spec) | ✅ Contract-verified | Same, full Authorization string locked by vectors |
| Request shape / response parsing / error mapping | ✅ Contract-verified | `test/fixtures/kling|jimeng/` + `src/media/__tests__/providerContract.test.ts` |
| Kling / Jimeng live rendering | ⏳ Awaiting a real environment | `npm run verify:providers -- --kling-key=AK:SK --jimeng-key=AK:SK` |
| Docker image build | ✅ CI-verified | `.github/workflows/docker-build.yml` (build only, no push); `docker compose up --build` works locally |
| Edge-TTS narration (`/api/tts`) | ✅ Verified locally | Produces a real mp3 (zh-CN-XiaoxiaoNeural, 38 KB); protocol-level mock tests need no network |
| ffmpeg composition (`/api/render`) | ✅ CI-verified / ⏳ awaiting long-run production soak | Fake-subprocess protocol tests cover the full path; the real ffmpeg path (testsrc + sine audio) runs automatically where ffmpeg exists (CI ubuntu runner) |
| One-click draft unpacking (when the companion server is online) | ✅ Verified locally (against the companion server) | UI smoke with mocked fetch: reachable → button appears → unpack succeeds; unreachable → button hidden |
| Mobile PWA (install / SW self-update / real camera) | ⏳ Awaiting a real device | Manifest + SW artefacts generated and build-verified |
| BackendAdapter REST mode → cloud backend | ✅ Verified locally (against the companion server) / ⏳ awaiting a real cloud backend | `/api/sessions/:id` has end-to-end automated tests |

---

## 🚀 Production deployment

### 1. BackendAdapter dual mode (persistence)

All session persistence goes through the `BackendAdapter` layer; the mode is decided by `VITE_BACKEND_URL`:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Local** (default) | `VITE_BACKEND_URL` empty | Identical to the pure front end: localStorage + IndexedDB, data never leaves the browser |
| **Server** (reserved) | `VITE_BACKEND_URL` set | Session snapshots via `PUT/GET/DELETE {backend}/api/sessions/:id`; falls back to local mode if the backend is unreachable |

### 2. One-command Docker deployment

```bash
docker compose up --build
# open http://localhost:8080, health check: http://localhost:8080/healthz
```

- Multi-stage build: `node:22-alpine` builds the front end → the runtime layer contains only `dist/`,
  `server/` and production dependencies
- CI runs a `docker-build` job on every push to prove the image builds (build only, no push)
- HTTPS: the compose file includes a commented Caddy reverse-proxy template (automatic certificates), or
  swap in nginx

### 3. Server environment variables (reserved switches; unset = local default)

| Variable | Description |
|---|---|
| `PORT` / `DIST_DIR` / `DRAFT_DIR` | Port / static directory / draft directory (CLI args take precedence) |
| `WLS_STORAGE` | Session storage: `memory` (default) / `sqlite` (persistent; better-sqlite3 → node:sqlite → memory fallback chain) |
| `WLS_SQLITE_PATH` | sqlite file path (default `data/weblockshot-sessions.sqlite3`) |
| `WLS_KEYS` | Proxy key injection (JSON: `{"kling":"Bearer xx","llm":"sk-xx"}`); overrides the client Authorization for that engine; unset = pass-through |
| `WLS_LLM_TARGET` | LLM API proxy target; enables `/api/llm` (501 when unset) |
| `WLS_TTS` | Edge-TTS switch: `on` (default) / `off` (`/api/tts` returns 501) |
| `TTS_DIR` | TTS mp3 output directory (default `data/tts`) |
| `WLS_FFMPEG` | ffmpeg composition switch: `auto` (default; probes the binary, returns 501 + install hint if missing) / `off` |
| `RENDER_DIR` | Rendered mp4 output directory (default `data/render`) |
| `WLS_RENDER_TIMEOUT_SEC` | Per-render timeout in seconds (default 600; on timeout the child process is killed and 504 is returned) |
| `WLS_LOG_LEVEL` | pino log level (default `info`, structured JSON output) |
| `SENTRY_DSN` | Error reporting (reserved no-op; `/healthz` reports `configured`) |

### 4. Health check

```bash
curl http://localhost:5174/healthz
# {"ok":true,"version":"0.1.0","storage":"memory","uptimeSec":2,"node":"v22.x",
#  "keyMode":"passthrough","llmProxy":"off","sentry":"off","tts":"on","ffmpeg":"on",
#  "memory":"off","connectors":"interface","mcp":"off"}
```

> `tts` / `ffmpeg` / `memory` / `connectors` / `mcp` are capability flags: the front end uses them to decide
> whether to show buttons such as “send to companion server” (a failed probe = pure front-end mode, behaviour
> unchanged).

---

## 📶 Mobile (PWA + responsive)

- **Install to home screen**: open the deployment URL in a mobile browser (iOS Safari / Android Chrome) →
  “Add to Home Screen” runs it full-screen in standalone mode; new releases raise a “🚀 new version available”
  bar, and tapping it refreshes in place (in-flight render tasks are not interrupted)
- **Responsive breakpoints**: ≥1024 px desktop unchanged / 768–1024 px sidebars and bars compacted /
  <768 px single-column stacking (the six-step bar becomes a compact step indicator, the two-column workspace
  stacks vertically, tables scroll horizontally)
- **Touch adaptation**: every tappable area is ≥44 px on touch devices, cards provide `:active` press
  feedback, and the product page opens the rear camera directly on phones
- **Background correctness**: returning from the background immediately refreshes polling state instead of
  waiting out the remaining interval

---

## 📱 Mini program (miniapp light client)

`miniapp/` is a Taro 4 + React 18 WeChat mini program that shares zero-dependency domain modules through the
`@domain` alias (polling windows, etc.) with **zero changes to the main `src/`**. Its dependencies are fully
independent (own `package.json`, React pinned to 18.3.1 for Taro compatibility) and do not pollute the root
`package.json`.

```bash
cd miniapp
npm install
npm run build:weapp   # compiles without WeChat DevTools; output in miniapp/dist/
```

**Three pages**: index (product entry form + `chooseMedia` first-frame image) → progress (task progress reusing
`domain/pollingConfig` and pollSleep) → result (`Taro Video` playback + copy link).

**Honest boundaries**: the mini program does **not** export CapCut drafts (needs a desktop filesystem) and does
**not** include the mock engine or the GSAP animation system; it only covers “enter → render → watch”. Copy the
video link and continue on the desktop workbench.

**Backend**: tasks are submitted through the `/api` proxy of the backend pointed to by `TARO_APP_API_BASE`.
**The mini program never holds API keys** — they are injected server-side via `WLS_KEYS` (unset = pass-through,
remote explicitly returns 401).

**Deployment**: request domains require HTTPS with an ICP-filed domain (`touristappid` is preview-only);
`web-view` and some advanced APIs need a corporate account. See [miniapp/README.md](./miniapp/README.md).

---

## 📦 CapCut draft zip (unzip into your draft folder)

On the delivery player page click **📦 download full draft zip (with assets)** to get
`<project>_capcut_draft.zip` containing:

- `draft_content.json` / `draft_meta_info.json`: a standard CapCut draft project (9:16 canvas, video main
  track, narration track, styled-subtitle track aligned to microseconds)
- `assets/`: the generated storyboard videos and (optional) narration audio
- `README-使用说明.txt`: the asset list and import instructions for this package

**Skip manual unzipping (when the companion server is online)**: the page probes the local companion server
(`/healthz`) and, if reachable, shows **📤 send to companion server** — the zip is posted to
`POST /api/jianying/draft-zip` and unpacked into your draft folder automatically (the response returns
`savedPath`). If the probe fails the button is hidden and the pure front-end experience is unchanged.

Import steps:

1. Unzip the archive.
2. Open JianyingPro / CapCut desktop and create an empty draft.
3. Close it and open the draft folder (Windows default:
   `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<draft name>\`).
4. Copy `draft_content.json`, `draft_meta_info.json` and `assets/` into that folder (overwrite same names).
5. Reopen the editor — the three aligned tracks are there.

> Note: browser Web Speech TTS cannot export audio files. If `assets/voice_*.mp3` is missing, record a file
> with the same name into `assets/`, or delete the empty audio segment in the editor.

---

## 🔊 Narration (companion server `/api/tts`)

With the companion server running (on by default) Edge-TTS synthesizes any text into a narration mp3 (pure-JS
WebSocket implementation, no Python and no API key):

```bash
curl -X POST http://localhost:5174/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Grab the buyer in three seconds","voice":"zh-CN-XiaoxiaoNeural","rate":"+10%"}'
# {"url":"/files/tts/1c83ab2f9286-mtr2oayj.mp3","path":".../data/tts/....mp3","bytes":38736,"voice":"zh-CN-XiaoxiaoNeural"}
```

- Voice: any Edge TTS ShortName (default `zh-CN-XiaoxiaoNeural`); `rate` accepts relative speeds (`+20%`)
- Limits: `text` ≤ 5000 characters (400 beyond that); read back via `GET /files/tts/<file>.mp3` (`audio/mpeg`)
- Switch: `WLS_TTS=off` disables it (501); `/healthz` capability `tts: on|off`
- Verification: ✅ locally verified (real mp3 produced); protocol-level mock tests need no network

---

## 🎬 Final composition (companion server `/api/render`)

Merges storyboard video + TTS audio + optional subtitles into a final mp4 using server-side ffmpeg (install it
locally, or use the Docker image which ships it):

```bash
curl -X POST http://localhost:5174/api/render \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"/files/tts/video.mp4","audioUrl":"/files/tts/voice.mp3","subtitleSrt":"1\n00:00:00,000 --> 00:00:03,000\nHello","title":"my-render"}'
# {"url":"/files/render/render_2026-09-07T10-00-00.mp4","path":".../data/render/....mp4","bytes":...}
```

- Sources: `videoUrl`/`audioUrl` accept http(s) and same-site relative paths (`/files/...`); `file://` and
  private network addresses are rejected (SSRF protection); remote downloads are capped at 500 MB
- Strategy: video stream copy + audio re-encoded to aac (`-c:v copy` automatically falls back to libx264
  re-encoding when the container is incompatible); subtitles soft-muxed as `mov_text`
- Concurrency/timeout: at most one render at a time (429 when busy); 10-minute default timeout
  (`WLS_RENDER_TIMEOUT_SEC`), 504 on timeout
- Switch: `WLS_FFMPEG=auto` (default; probes ffmpeg, 501 + install hint when missing) / `off`;
  `/healthz` capability `ffmpeg: on|off`
- Verification: ✅ CI-verified (fake-subprocess protocol tests + real ffmpeg path) / ⏳ awaiting production soak

---

## 💎 Capability comparison

| Module | Manual editing | Typical AI wrapper | WebLockShot |
| :--- | :--- | :--- | :--- |
| **Viral structure & first 3 s** | Rule of thumb, unstable retention | Plain text expansion, no pacing constraints | **5 proven structure templates + hook phrase library (JSON data assets)** with category/emotion-axis/win-rate metadata, strict Zod contracts, category routing and win-rate weighted hook sampling |
| **Scripting & review** | One person writing blind | Single pass, no self-critique | **ScriptWriter + ScriptCritic dual-Agent deliberation** (4-axis scoring: 3-second hold / selling points / completion / compliance); LLM output is zod-validated with automatic retry and fallback |
| **Visual preview & scheduling** | Mental images, blind renders | Blank screen while loading | **9:16 GSAP storyboard preview stage** showing push/pull/pan/tilt motion and beat timing in milliseconds |
| **Engine support** | Vendor lock-in | A single commercial API | **Four engines aggregated**: Kling, Jimeng, **private ComfyUI GPU (Wan 2.1)** and a mock lab canvas; circuit-breaker state is visualized live |
| **Compute cost** | Frequent paid credits | Token markups | **Zero API fees**: talk straight to a local/LAN RTX 3090/4090/A100 ComfyUI, marginal cost ≈ 0 |
| **Deduplication & money safety** | Double charges, no refunds | Hard to appeal failed charges | **Two-phase virtual wallet** (per-refId freeze ledger: freeze → settle / rollback; settle without a receipt is rejected, repeated settlement is idempotent, orphaned freezes are reclaimed by TTL) + intent-fingerprint idempotency locks |
| **Feedback loop** | Gut feeling after launch | No data回流 | **Feedback dashboard**: record 3-second view-through / completion / conversions, aggregate win rates per structure/hook/category (Laplace smoothing) and feed them back into ScriptWriter sampling |
| **Editing delivery** | Manual audio and subtitle alignment | Standalone MP4 only | **CapCut / Jianying draft zip export**: microsecond-aligned `draft_content.json` + assets + instructions, unzip and go; one-click unpack via the companion server |
| **Private deployment** | — | Cloud-only, useless offline | **Zero-dependency companion server**: one command for static hosting + API proxying + draft unpacking (`npx weblockshot` / `start-weblockshot.bat`) |

---

## 🛡️ Industrial reliability

### 1. Task idempotency and double-click locks (`src/domain/idempotency.ts`)

- **Intent-fingerprint hashing**: a stable idempotency key derived from canonicalised
  `(intent, shotId, provider, prompt, duration, ratio)`
- **In-flight mutex**: a second click on the same task is blocked while it is running; after completion a short
  idempotent cache window applies

### 2. Finite state machine and provider circuit breaker (`src/domain/fsm.ts`)

- **ShotJob state machine**: `queued → running → succeeded/failed` (retry via `failed → queued`) guarded by the
  `JOB_STATUS_TRANSITIONS` table; illegal transitions (including self-transitions out of the terminal
  `succeeded` state and level-skipping) throw immediately
- **Circuit breaker**: 3 consecutive upstream failures open the breaker for 30 s (then half-open probing); the
  UI badge shows normal / protected / probing live. Mock and self-hosted ComfyUI are exempt

### 3. Two-phase commit virtual wallet (`src/domain/wallet.ts`)

- 2,000 credits granted initially; `frozen` is a **per-refId freeze ledger** (amount/provider/freeze time)
- **Phase 1 (Freeze)**: validate balance and pre-freeze before the task starts, preventing overdraft
- **Phase 2A (Settle)**: deduct the frozen amount on success (partial settlement supported, receipt balance is
  kept for auditing)
- **Phase 2B (Refund)**: full refund on error, timeout or interruption
- **Anti-fake settlement**: settle/refund without a freeze receipt is rejected; repeated settlement for the
  same refId is idempotent; refund after settlement is rejected (no double rollback)
- **Orphaned freeze reclamation**: unowned freezes are refunded after a 30-minute TTL following a restart
- **Cross-tab sync**: storage events keep wallet views consistent across tabs
- Full transaction audit trail and a simulated top-up centre

### 4. Exponential-backoff network tolerance (`src/ai/retry.ts`)

- Network flakiness, 429s and 5xx trigger exponential backoff (500 ms / 1000 ms / 2000 ms) with jitter (wired
  into the Kling/Jimeng media layer)
- The server's `Retry-After` header is honoured first; an abort signal exits immediately without retrying

### 5. Single generation pipeline (`src/hooks/useVideoPipeline.ts`)

- Wallet two-phase transactions / circuit breaker / idempotency lock / polling / settlement & refund exist in
  exactly one place, shared by the executor and both studios
- The polling window is configurable (10 min default; UI offers 2/5/10/20 min); timeouts always refund and
  never settle
- Unmounting a component aborts polling and releases the idempotency lock

---

## 📁 Project layout

```
WebLockShot/
├── docs/
│   ├── HOW_TO_USE.md                 # full handbook (Chinese, canonical)
│   ├── HOW_TO_USE.en.md              # this handbook in English
│   ├── coverage.md / perf.md / a11y.md / degrade-matrix.md   # measured baselines
│   └── connectors.md / mcp.md        # connector panel + MCP bridge
├── scripts/                          # e2e / perf / a11y / degrade matrices + tooling
├── server/                           # zero-dependency companion server
├── src/
│   ├── ai/                           # ScriptWriter, ScriptCritic, PromptPolisher, Retry
│   ├── assets/                       # hook/structure JSON data assets + presets
│   ├── canvas/                       # Agent Canvas (CanvasDoc contract, tldraw shape, serialization, Skill manifest, memory source)
│   ├── director/                     # director hub and executor engine
│   ├── domain/                       # Wallet, FSM, Idempotency, Feedback, PollingConfig, ShotJob
│   ├── export/                       # CapCut draft alignment + zero-dependency zip
│   ├── hooks/                        # useVideoPipeline, useRevocableObjectUrl
│   ├── i18n/                         # zh/en dictionaries + language store (default Chinese)
│   ├── media/                        # ComfyUI, Kling, Jimeng, Mock, Audio TTS, AssetSize
│   ├── persist/                      # IndexedDB asset storage
│   └── ui/                           # React UI (WorkbenchHeader, SellWorkbench, Studios, Modals, canvas/)
├── vite.config.ts                    # Vite build + API proxies + vitest config
├── start-weblockshot.bat             # Windows one-click start
├── CANVAS_PLAN.md                    # Agent Canvas plan (phase 1–3 slices and acceptance criteria)
└── package.json
```

---

## 🧪 Automated verification

`npm test` runs the full gate (node unit tests + vitest UI smoke tests):

```bash
npm test
# prompt polishing agent (zod-validated LLM output)
# exponential backoff & retry (Kling endpoint discrimination + 5xx retry)
# idempotency keys and duplicate prevention
# ExecutorEngine serial queue / per-shot retry / in-flight retry race regressions
# full commerce pipeline end-to-end
# FSM illegal-transition guards / terminal locking / ShotJob transition table
# CircuitBreaker opening after consecutive failures
# two-phase wallet (receipt validation / idempotency / partial settlement / orphan reclaim / cross-tab)
# persistence slimming (heavy assets to IndexedDB / blob dead links / session hydration)
# CapCut draft microsecond alignment + real import fields + zip round-trip
# category metadata routing & win-rate weighted sampling / feedback Laplace aggregation
# canvas contracts, Skill manifests, 3D stage meta/anim/scenes, memory source, multi-canvas store, minimap, MCP ops
# i18n dictionaries (key parity, no missing translations) + language persistence
# TTS adaptive speaking rate
# ComfyUI / Kling / Jimeng providers (explicit errors on network failure, no fabricated assets)
# UI smoke (vitest + testing-library): wallet interaction / circuit-breaker badge / shared pipeline
```

### Canvas E2E suite (`npm run e2e`)

`scripts/e2e-canvas.mjs` turns the throwaway Playwright smoke tests of each slice into a repeatable suite:

- **Coverage**: onboarding → chat-bar demo orchestration → nodes placed → reload recovery; 3D camera stage
  (enter / scene preset / back); Skill Market (install / toggle / uninstall); memory graph (honest empty state
  or real data); multi-canvas projects + minimap + connectors + Scene Gallery; language switching
- **Isolation**: a dedicated browser context (localStorage / IndexedDB never touch your machine) and a
  companion server on a random port with `WLS_STORAGE=memory`
- **Honest skip**: if Playwright or its browsers are missing it prints enablement instructions and exits 0

```bash
npm run e2e                 # build when dist is missing, then run every step
npm run e2e -- --skip-build # reuse the existing dist (fast regression)
npm run e2e -- --headed     # headed mode for debugging
```

### Coverage baseline (`npm run test:coverage`)

Key pure-function layers (canvas contracts / 3D stage / memory aggregation / multi-canvas / minimap / MCP ops)
have an 80% line-coverage gate; the baseline table and methodology live in
[`docs/coverage.md`](docs/coverage.md) (currently **10/10 passing**; `--strict` turns it into a CI gate).

### Performance baseline (`npm run perf`)

Real-browser measurements for canvas 200/500 nodes, memory graph with 500 records, the 3D lazy chunk and the
Skill Market with 100 entries; the table and optimization notes live in [`docs/perf.md`](docs/perf.md)
(**measure only, no changes in this pass**).

### Cross-browser + a11y (`npm run a11y`)

chromium and webkit both run the canvas core flow, and axe-core (WCAG 2.0 A/AA) scans four UI states; the
report lives in [`docs/a11y.md`](docs/a11y.md) (currently **5/5 core flow, 0 serious axe findings** on both
engines).

### Degradation / migration matrix (`npm run degrade`)

Six capability-loss paths are exercised on a real browser (legacy single canvas migration, no WebGL, no
companion server, no LLM key, `WLS_STORAGE=memory|sqlite`, ComfyUI offline); the matrix lives in
[`docs/degrade-matrix.md`](docs/degrade-matrix.md) (currently **6/6 passing**).

---

## 📄 License

**Our own source code is released under the [MIT License](./LICENSE)** (`package.json` sets `"license": "MIT"`).

> ⚠️ **Dependencies keep their own licenses** — see [`NOTICE`](./NOTICE). Two need special attention:
>
> - **tldraw (canvas engine) is a commercial license, not an open-source one**: the free/unlicensed tier adds a
>   watermark, and **in production without a license key rendering stops after roughly 5 seconds**. This project
>   accepts that limitation and ships **no means of bypassing license checks or removing the watermark**. For a
>   production launch you must buy a tldraw license and set `licenseKey`, or swap in an MIT-licensed canvas engine.
> - **GSAP uses its own “standard no-charge” license** (<https://gsap.com/standard-license>), not MIT.
>
> Bundled assets: the Quaternius Universal Animation Library character is **CC0 1.0** (commercial use allowed,
> no redistribution restrictions — see `public/models/LICENSE.md`); third-party models such as Mixamo are
> **not redistributed** and are only loaded locally by the user.
>
> `package.json` keeps `"private": true` to prevent accidental npm publishing; it does not affect the project's
> open-source status.
