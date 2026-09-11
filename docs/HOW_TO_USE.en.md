# WebLockShot — Complete Guide & Industrial Playbook (main handbook)

> 中文版: [HOW_TO_USE.md](./HOW_TO_USE.md)（权威版本，内容最全）
>
> This handbook uses a **one main + two branches** structure:
> - **Main (this document)**: positioning, quick start, product-line navigation, shared capabilities
>   (companion server / Docker / PWA / mini program / reliability / FAQ)
> - **Branch 1**: [Agent Canvas (primary)](./HOW_TO_USE.canvas.en.md) — every canvas capability and workflow
> - **Branch 2**: [E-commerce pipeline (plus legacy drama)](./HOW_TO_USE.commerce.en.md) — six-step workflow,
>   studios, engine configuration, CapCut delivery, feedback dashboard

---

## Contents

- [(0) Introduction and positioning](#0-introduction-and-positioning)
- [(1) Quick start: online vs private deployment](#1-quick-start-online-vs-private-deployment)
- [(2) Product-line navigation](#2-product-line-navigation)
- [(3) Companion server and one-click draft unpacking](#3-companion-server-and-one-click-draft-unpacking)
- [(4) Industrial reliability](#4-industrial-reliability)
- [(5) FAQ and pitfalls](#5-faq-and-pitfalls)
- [(6) Mobile: installing the PWA](#6-mobile-installing-the-pwa)
- [(7) Docker production deployment](#7-docker-production-deployment)
- [(8) Mini program light client](#8-mini-program-light-client)
- [(9) Verification and test engineering](#9-verification-and-test-engineering)

---

## (0) Introduction and positioning

**WebLockShot** is a **multi-Agent, closed-loop short-video production platform** for vertical-video and
e-commerce visual creators. Since v2.4 the primary line is the **Agent Canvas** (a free-form creative space),
alongside the mature **e-commerce commerce pipeline** and the legacy **drama rough-cut studio**.

Producing a commerce short video that the platform's recommendation system actually likes used to mean:

1. **Expensive ideation** — manual scriptwriting with no grasp of the first-3-second retention playbook;
2. **Fragmented tooling** — sourcing product images, tuning prompts, rendering on a vendor site, downloading,
   then dragging everything into an editor by hand;
3. **Costly, unprotected APIs** — per-call billing where retries or double clicks cause double charges;
4. **Audio/video mismatch** — fixed-length clips that do not match narration or subtitle timing.

WebLockShot closes the loop: **from selling-point input, structure templates, dual-Agent script deliberation,
9:16 dynamic preview and self-hosted ComfyUI / commercial API rendering, all the way to a CapCut draft project
with microsecond-level audio/video/subtitle alignment — entirely in the browser.** The canvas further breaks
that chain into nodes you can arrange freely, distil into reusable Skills, and drive from a local Agent.

### Traditional workflow vs WebLockShot

| Stage | Manual production | Typical AI wrapper | WebLockShot |
| :--- | :--- | :--- | :--- |
| **Viral know-how** | Improvised by the creator | Rough single-pass text expansion | **5 proven structure templates + a golden-3-second hook library** (strict Zod contracts) |
| **Script quality** | Written blind, no review | One long blob of text | **ScriptWriter + ScriptCritic dual-Agent deliberation with strict scoring** |
| **Pre-render preview** | Mental imagery or a black screen | No preview, blind render | **9:16 GSAP storyboard stage** simulating camera moves and transitions in milliseconds |
| **Render compute** | Manual clicks on one vendor page | One closed cloud API | **Six engines**: Mock, Kling, Jimeng, **private ComfyUI GPU (Wan 2.1)**, Runway, Luma |
| **Cost** | Expensive API fees | Token markups | **Zero API fees**: talk straight to a local RTX 4090 / A100 ComfyUI |
| **Deduplication & money safety** | Double charges, no refunds | Failed charges not returned | **Industrial two-phase wallet** (freeze → settle / rollback) + intent-fingerprint idempotency |
| **Creative reuse** | Start from scratch every time | No mechanism | **Skill packages**: box-select nodes, export a manifest, import to rebuild the topology and just fill new input |
| **Editing delivery** | Manual track dragging and slicing | Standalone MP4 only | **CapCut / Jianying draft export**: video + narration + styled-subtitle tracks aligned automatically |

---

## (1) Quick start: online vs private deployment

### 1. Zero-config, no-install experience

- Online: <https://qwqcool.github.io/WebLockShot/>
- **No server dependency, no sign-up**: every key stays in the browser's `sessionStorage` and is never uploaded
- **Works without keys**: a mock recording engine and a 0-key rule-based template engine let you walk the whole
  pipeline for free
- **The Agent Canvas is the default entry point**; `?view=sell` and `?view=drama` open the other two lines

### 2. Local development

```bash
git clone https://github.com/QWQcool/WebLockShot.git
cd WebLockShot
npm install
npm run dev     # dev server on 5173, ComfyUI reverse proxy enabled automatically
npm test        # node unit tests + vitest UI smoke tests
```

Then open `http://localhost:5173`.

---

## (2) Product-line navigation

| Product line | Entry | Positioning | Guide |
| :--- | :--- | :--- | :--- |
| **🎨 Agent Canvas** | **default** / `?view=canvas` | **Primary**: free-form space, nodes as pipelines, Skill reuse, 3D camera stage, MCP both ways | [Branch 1](./HOW_TO_USE.canvas.en.md) |
| **🛒 E-commerce pipeline** | top bar / `?view=sell` | **Secondary**: mature six-step industrial flow + two studios + CapCut delivery | [Branch 2](./HOW_TO_USE.commerce.en.md) |
| **🎭 Drama rough-cut studio** | top bar / `?view=drama` | **Legacy**: kept for compatibility and zero regression | [Branch 2 · section 6](./HOW_TO_USE.commerce.en.md#6-drama-rough-cut-studio-legacy) |

**Which one should I use?**

- Want to compose your own creative flow, reuse workflows, do 3D previews or drive the canvas from a local
  Agent → **Agent Canvas**
- Want the most mature path to one commerce video plus a CapCut draft → **commerce workbench**
- Already have drama footage and need six-shot previews plus a prompt pack → **drama studio (legacy)**

---

## (3) Companion server and one-click draft unpacking

The pure front-end build on GitHub Pages cannot talk to ComfyUI or video APIs directly (CORS) and cannot write
drafts to your disk. The **companion server** (pure Node, only `pino` at runtime) solves both, plus a set of
reserved switches (setting no `WLS_*` variable = the local default, identical to the pure front end).

![Companion server and draft unpacking](./screenshots/14_companion_server.png)

### One command

```bash
npm run build && npm run start:server    # default http://localhost:5174
# equivalent npx form: npx weblockshot
# custom: node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
```

Windows users can double-click **`start-weblockshot.bat`** (installs → builds → starts).

### Capabilities

| Capability | Description |
| :--- | :--- |
| Static hosting | Serves the production `dist/` build at `http://localhost:5174` |
| API proxy | `/api/kling`, `/api/jimeng`, `/api/comfyui` reverse proxies so production can reach ComfyUI and vendor APIs |
| Draft unpacking | `POST /api/jianying/draft-zip` (zip body) unpacks into `--draft-dir`, no manual unzipping |
| Narration | `POST /api/tts` (Edge-TTS mp3; on by default, `WLS_TTS=off` disables), read back via `GET /files/tts/<file>.mp3` |
| Composition | `POST /api/render` (ffmpeg merges video + audio + subtitles; `auto` by default, `WLS_FFMPEG=off` disables), read back via `GET /files/render/<file>.mp4` |
| Memory records API | `GET/POST/DELETE /api/memory/records`: enabled when `WLS_STORAGE=sqlite`, otherwise 501 (the front end falls back to local IndexedDB) |
| Connectors API | `GET /api/connectors` + `POST /api/connectors/:id/auth\|run`; capability `connectors: 'interface' \| 'ready'` |
| MCP bridge (optional dependency) | `/api/mcp/*`: canvas topology mirror + Agent operation queue; 501 + install guidance without the SDK |
| Health check (reserved) | `GET /healthz` returns version / storage mode / uptime / key mode / capability flags (tts, ffmpeg, memory, connectors, mcp) |
| Session API (reserved) | `PUT/GET/DELETE /api/sessions/:id` for the front end's `VITE_BACKEND_URL` server mode; persisted when `WLS_STORAGE=sqlite` |
| LLM proxy (reserved) | With `WLS_LLM_TARGET` set, `/api/llm` proxies to it; otherwise 501 |
| Key injection (reserved) | With `WLS_KEYS` (JSON) set, the proxy injects real key headers so keyless clients (like the mini program) can render |
| Structured logs | pino JSON lines, level controlled by `WLS_LOG_LEVEL` |

> The full environment-variable table is in the main README under “Production deployment”.

### One-click draft unpacking

**Option A: in-app (recommended)**

1. Start the companion server
2. Open the delivery player page — the front end probes `/healthz`; when online the export card shows
   **📤 send to companion server**
3. Click it: the full draft zip is POSTed to `/api/jianying/draft-zip` and unpacked server-side; the unpacked
   path (`savedPath`) is displayed
4. If the probe fails (pure front-end mode) the button is hidden and nothing changes — use option B

**Option B: manual with curl**

```bash
curl -X POST http://localhost:5174/api/jianying/draft-zip \
  -H "Content-Type: application/zip" --data-binary @<project>_capcut_draft.zip
# → { ok: true, savedPath: "...", files: [...] }
```

### Narration workflow (TTS → CapCut audio track)

```bash
curl -X POST http://localhost:5174/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"your narration line","voice":"zh-CN-XiaoxiaoNeural","rate":"+10%"}'
# → { "url": "/files/tts/xxx.mp3", "bytes": 38736, ... }
```

- Voice: any Edge TTS ShortName (default `zh-CN-XiaoxiaoNeural`); `rate` accepts relative speeds (`+20%`)
- Limits: `text` ≤ 5000 characters; read back via `GET /files/tts/<file>.mp3`
- In CapCut: drag the mp3 onto an audio track, or rename it to `voice_<n>.mp3` and place it in the draft's
  `assets/` folder

### Server-side composition with ffmpeg

```bash
curl -X POST http://localhost:5174/api/render \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"/files/tts/video.mp4","audioUrl":"/files/tts/xxx.mp3","title":"my-render"}'
# → { "url": "/files/render/render_xxx.mp4", "bytes": ... }
```

- Video stream copy + audio re-encoded to aac (falls back to libx264 when the container is incompatible);
  subtitles soft-muxed as `mov_text`
- At most one render at a time (429 when busy); 10-minute default timeout (`WLS_RENDER_TIMEOUT_SEC`)
- Safety: `file://` and private network addresses are rejected (SSRF protection); remote downloads capped at 500 MB

---

## (4) Industrial reliability

### 1. Task idempotency and double-click locks

- **Intent fingerprint**: a unique idempotency key from canonicalised
  `(intent, shotId, provider, prompt, duration, ratio)`
- **In-flight mutex**: duplicate clicks are blocked while a task is running

### 2. FSM and circuit breaker

- **ShotJob state machine**: `queued → running → succeeded/failed` (retry via `failed → queued`) guarded by the
  `JOB_STATUS_TRANSITIONS` table; illegal transitions throw immediately
- **Circuit breaker**: 3 consecutive failures trip the breaker and block that channel; it half-opens after 30 s.
  Mock and self-hosted ComfyUI are exempt

### 3. Two-phase commit virtual wallet

![Virtual wallet](./screenshots/11_virtual_wallet.png)

- **“💰 virtual wallet”** lives in the top navigation and uses a **per-refId freeze ledger**
- **Phase 1 — freeze**: on render the estimated cost moves into “frozen”
- **Phase 2A — settle**: on success the frozen amount is deducted
- **Phase 2B — refund**: on failure, timeout or error the frozen amount is returned in full
- **Receipt safety**: settle/refund without a freeze receipt is rejected; repeated settlement is idempotent;
  a settled task cannot be refunded
- **Orphan reclamation**: unclaimed freezes are refunded after 30 minutes
- **Cross-tab sync**: balances and statements stay consistent across tabs
- Full audit trail plus simulated top-up and reset

> **The canvas and the commerce workbench share one wallet pipeline** (`useVideoPipeline`, the only
> implementation site-wide).

---

## (5) FAQ and pitfalls

#### Q1: network errors or timeouts when calling local ComfyUI?

- **A**: check that ComfyUI was started with `--listen`
- **B**: in development WebLockShot proxies `/api/comfyui` through Vite — make sure you opened
  `http://localhost:5173`, not a local HTML file

#### Q2: why does rendering say “insufficient wallet balance”?

- Open **“💰 virtual wallet”** and click **“+1,000 credits”** or **“reset 2,000 trial credits”**. ComfyUI and
  mock modes cost 0 and never charge.

#### Q3: what if I dislike one shot?

- Commerce line: click **“🔄 regenerate this shot”** next to the offending shot in step 6
- Canvas: use **local repaint** on the artifact card (see
  [Branch 1 · section 6](./HOW_TO_USE.canvas.en.md#6-local-repaint-and-version-stacking)), or delete the node and
  re-run

#### Q4: the exported draft shows assets as offline?

- The draft records local paths or URLs. If the source was a locally recorded blob URL, place the downloaded
  asset files next to the draft and the editor will relink automatically.

#### Q5: why does the canvas look fine but my changes are not saved after a refresh?

- The canvas document contract caps at **200 nodes / 400 edges**; beyond that it stops persisting and the UI has
  no warning yet (see the main README's remaining-items list). Split into multiple canvas projects or reduce the
  node count.

#### Q6: why is some text still Chinese after switching to English?

- i18n currently covers the top bar / toolbar / node palette / node headers / chat bar / onboarding / settings
  skeleton; node internals and some overlay copy are still Chinese — see [i18n.md](./i18n.md).

---

## (6) Mobile: installing the PWA

### Add to home screen

1. Open your deployment URL in a mobile browser (iOS Safari / Android Chrome)
2. **iOS Safari**: share button → “Add to Home Screen” → confirm
3. **Android Chrome**: “⋮” menu → “Add to Home screen / Install app” → confirm
4. Launching from the icon runs a **standalone full-screen window** (no address bar) with the WebLockShot cyan
   theme colour (#22d3ee)

### Notes

- **Self-update**: a “🚀 new version available” bar appears after a release; tapping refresh updates in place
  (prompt mode never interrupts an in-flight render)
- **Keys and data**: identical to desktop — API keys live in `sessionStorage`, sessions in IndexedDB
- **Responsive**: below 768 px the layout stacks into one column; at 768 px and above it matches desktop
- **Canvas on narrow screens (P0)**: the top bar folds into **two rows** (brand, then the mode switch — text is
  never stacked vertically), the left node palette becomes a **horizontally scrolling strip at the bottom**, the
  canvas toolbar and chat template chips scroll in a single line, and the **minimap and shortcuts hint hide
  themselves**; measured at 390×844 the canvas keeps about **75 % of the viewport height** (34 % before the fix),
  and at ≥769 px the desktop layout is **exactly as before**
- **Touch**: every tappable area is ≥44 px, and the product page opens the rear camera directly
- **Background correctness**: returning to the foreground refreshes polling immediately

---

## (7) Docker production deployment

### One command

```bash
git clone https://github.com/QWQcool/WebLockShot.git
cd WebLockShot
docker compose up --build      # first build takes about 2–4 minutes
```

After startup:

- App: `http://localhost:8080` (change ports in `docker-compose.yml`)
- Health: `http://localhost:8080/healthz`
- The compose file includes a healthcheck (probes `/healthz` every 30 s) and restarts on failure

### Reserved switches (compose environment)

Every `WLS_*` variable follows the “interface ready, unused by default” principle — **setting nothing means the
local default, identical to the pure front end**:

```yaml
environment:
  - PORT=5174
  # session persistence (reserved): sqlite persisted to the /app/data volume
  - WLS_STORAGE=sqlite
  # narration (on by default): /api/tts writes mp3 to the /app/data/tts volume
  # - WLS_TTS=off
  # composition (auto by default): the image ships ffmpeg
  # - WLS_FFMPEG=auto
  # LLM proxy (reserved): enables /api/llm
  - WLS_LLM_TARGET=https://api.openai.com
  # key injection (reserved): the server holds the real keys, clients need none
  - WLS_KEYS={"kling":"Bearer ak-xxx","llm":"Bearer sk-xxx"}
```

### HTTPS

The compose file includes a commented Caddy template: uncomment it and write a `Caddyfile`
(`your-domain.com { reverse_proxy weblockshot:5174 }`); Caddy issues and renews Let's Encrypt certificates
automatically. nginx + certbot works the same way.

### Image structure

Multi-stage build: stage 1 (`node:22-slim`) runs `npm ci` + `tsc -b && vite build`; stage 2 (runtime,
`node:22-alpine`, **ffmpeg included**) contains only `dist/`, `server/` and production dependencies.
`./data` and `./jianying-drafts` are mounted as persistent volumes. CI runs a build-only image verification job
on every push.

---

## (8) Mini program light client

`miniapp/` contains a WeChat mini program (weapp) light client (Taro 4 + React 18) covering
“enter product → task progress → watch & deliver”.

### Honest boundaries

The mini program does **not** export CapCut drafts (needs a desktop filesystem) and does **not** include the mock
engine or GSAP animation system. After watching, copy the video link and finish the CapCut delivery on the
desktop workbench. See [miniapp/README.md](../miniapp/README.md).

### Reuse with the desktop app

- It reuses zero-dependency domain modules from the main repo via the `@domain` alias, with **zero changes to the
  main `src/`**
- Dependencies are fully independent (own `package.json`, React pinned to 18.3.1 for Taro compatibility)

### Backend and key safety

- All task requests go through the `/api` proxy of the backend pointed to by `TARO_APP_API_BASE`
- **The mini program holds no API key** — keys are injected server-side via `WLS_KEYS`; without it the remote
  explicitly returns 401

### Build and deployment

```bash
cd miniapp
npm install
npm run build:weapp    # compiles without WeChat DevTools; output in miniapp/dist/
```

- **Request domains**: add your backend domain to the mini program's legal request domain list (requires
  **HTTPS + an ICP-filed domain**)
- **Account type**: `touristappid` is preview-only in the local DevTools; `web-view` and some advanced APIs need
  a **corporate account**

---

## (9) Verification and test engineering

This release adds a complete test-engineering layer (the T line); everything can be re-run with one command:

| Command | Purpose | Current result |
| :--- | :--- | :--- |
| `npm test` | node unit tests + vitest UI smoke tests | 449 + 26, **0 failures** |
| `npm run e2e` | Canvas E2E suite (real mouse paths, isolated storage) | **17/17 steps pass**; skips gracefully without Playwright |
| `npm run e2e:mobile` | Mobile / touch narrow-screen layout assertions (390×844 + 360×640) | **15/15 assertions pass**; wired into CI (with a CJK font step) |
| `npm run test:coverage` | Coverage baseline for key pure-function layers (80% gate) | **10/10 passing** ([coverage.md](./coverage.md)) |
| `npm run perf` | Canvas / memory graph / 3D chunk / Skill Market benchmarks | see [perf.md](./perf.md) (includes optimization notes) |
| `npm run a11y` | chromium + webkit core flow + axe (WCAG 2.0 A/AA) | **5/5** on both engines, **0** serious axe findings ([a11y.md](./a11y.md)) |
| `npm run degrade` | Six capability-loss degradation / migration paths | **6/6 passing** ([degrade-matrix.md](./degrade-matrix.md)) |
| `npm run test:chaos` | Edge-case smoke (malformed URL / oversized body / upstream abort) | process stays alive throughout |
| `npm run shots` | Real screenshot capture (the source of every image in these docs) | writes into `docs/screenshots/` |

> The PDF edition of this handbook is produced by `python docs/build_how_to_use_pdf.py`
> (main handbook + both branches merged).

---

> 📄 License: our own code is [MIT](../LICENSE); **third-party dependencies keep their own licenses**
> (tldraw is commercial, GSAP uses its own free license) — see [`NOTICE`](../NOTICE).
