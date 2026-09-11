# Branch 1 · Agent Canvas (primary line)

> Main handbook: [HOW_TO_USE.en.md](./HOW_TO_USE.en.md) ·
> Commerce branch: [HOW_TO_USE.commerce.en.md](./HOW_TO_USE.commerce.en.md) ·
> 中文版: [HOW_TO_USE.canvas.md](./HOW_TO_USE.canvas.md)（权威版本，内容最全）

---

## Contents

- [1. Entering the canvas](#1-entering-the-canvas)
- [2. Onboarding and the Scene Gallery](#2-onboarding-and-the-scene-gallery)
- [3. Chat-bar orchestration](#3-chat-bar-orchestration)
- [4. Nodes and the data-flow contract](#4-nodes-and-the-data-flow-contract)
- [5. From script to artifact card](#5-from-script-to-artifact-card)
- [6. Local repaint and version stacking](#6-local-repaint-and-version-stacking)
- [7. The 3D camera stage](#7-the-3d-camera-stage)
- [8. Skill distillation / reuse / market](#8-skill-distillation--reuse--market)
- [9. Memory system and memory graph](#9-memory-system-and-memory-graph)
- [10. Connector panel](#10-connector-panel)
- [11. Multi-canvas projects and minimap](#11-multi-canvas-projects-and-minimap)
- [12. MCP both ways (optional dependency)](#12-mcp-both-ways-optional-dependency)
- [13. Bilingual UI and the settings panel](#13-bilingual-ui-and-the-settings-panel)
- [14. Honest boundaries and known limits](#14-honest-boundaries-and-known-limits)

---

## 1. Entering the canvas

**The canvas is the default entry point** — opening the deployment URL (or `http://localhost:5173` after
`npm run dev`) lands you there. Deep links: `?view=canvas` (direct), `?view=sell` and `?view=drama` for the
other two lines.

![Canvas workbench](./screenshots/16_canvas_workbench.png)

| Region | Contents |
|---|---|
| Top bar | Brand, mode switch (commerce / drama / canvas), language switch |
| Left | Agent node palette — click to drop a node at the canvas centre; hover for that node's capability hint |
| Centre | tldraw infinite canvas (pages, zoom, undo/redo, sticky notes and shapes all work natively) |
| Toolbar | Project switch/create/delete, canvas name, export/import Skill, official Skill shortcuts, clear, memory graph, Skill Market, connectors, Scene Gallery, MCP badge, language, save state |
| Bottom-right | Minimap (Canvas2D, click or drag to navigate) |
| Bottom | Chat bar (collapsible to a pill in the bottom-right corner, revealing tldraw's bottom toolbar) |

> The canvas document lives in browser `localStorage` with a 400 ms debounce, and stays in sync across tabs
> through storage events.

## 2. Onboarding and the Scene Gallery

**Onboarding** (shown on first visit, then collapses into the chat bar):

![Onboarding](./screenshots/15_canvas_onboarding.png)

- Five scene tabs: brand design / film & creative / commerce ads / interactive games / web apps — clicking one
  prefills the input
- Large input card: describe your need in one sentence; Enter sends, Shift+Enter inserts a newline
- Connector strip: everyday-app entries (not connected; opens the connector panel)
- “Enter canvas →” closes it and records the seen flag; “More creative scenes →” opens the gallery

**Scene Gallery** (toolbar → “🎬 Scene Gallery”):

![Scene Gallery](./screenshots/21_canvas_scene_gallery.png)

Six creative-scene cards (brand design / e-commerce assets / film & entertainment / game content / product
UI-UX / promo assets). Each card offers two actions:

- **Prefill the chat bar** with that scene's recommended brief (edit it, then send)
- **Orchestrate in one click**, routing through the pipeline described below

## 3. Chat-bar orchestration

![Chat-bar orchestration](./screenshots/17_canvas_orchestration.png)

1. Type one sentence in the bottom chat bar (or prefill from a template chip / scene card);
2. On send:
   - **with an LLM key**: a real LLM returns a structured topology (zod-validated, up to two retries);
   - **without a key**: a **deterministic demo orchestration** runs and the notice explicitly says
     “🧪 demo orchestration · not a real LLM”;
3. The whole batch of nodes and edges lands at once, with a “placed N nodes and M edges” notice;
4. Not happy? “↩️ Undo this orchestration” rolls back the whole batch (equivalent to Ctrl+Z — programmatic
   placement explicitly marks a history stopping point).

> Orchestration only creates **ready** node kinds; greyed-out placeholders are never auto-created.

## 4. Nodes and the data-flow contract

Ten node kinds: requirement brief, asset import, image generation, script writing, storyboard preview,
video generation, artifact card, local repaint, 3D camera stage, delivery.

- **Edges are data flow**: drag an arrow between two nodes. Incompatible kinds are **rejected and deleted
  immediately**, with a reason shown in a notice at the top of the canvas.
- **Legal chains**: `brief → product → script → storyboard → generate → asset → deliver`;
  plus `product → generate` (single-shot), `asset → edit` (repaint), `stage3d → storyboard|generate` (3D output).
- **Reload recovery**: edge ids are stable, and arrows are re-materialised after a refresh — nothing is lost.
- **Node controls** stop events at the control level, so starting a line from a node's blank area still works.

## 5. From script to artifact card

- **Script writing**: connect a Brief (or type the requirement) → ScriptWriter produces a six-shot script and
  Critic reviews it. In demo mode the Critic score is labelled “not real”.
- **Storyboard preview**: connect a script → one click generates a six-shot storyboard with an embedded 9:16
  GSAP preview (local preview · not a final render).
- **Video generation**: connect a storyboard to render shot by shot through the **same** `useVideoPipeline`
  as the commerce workbench (two-phase wallet, circuit breaker, idempotency, polling, refunds).
- **Artifact card**: rendered output becomes a card automatically. Heavy video assets move into IndexedDB;
  **`blob:` is never persisted** (it dies across reloads) — only lightweight references go into the document.
- **Delivery**: connect an artifact card to package a CapCut draft zip in the browser; the node shows the
  wallet balance.

## 6. Local repaint and version stacking

1. Connect an **artifact card** to a **local repaint** node;
2. Paint the region to repaint with the **brush** or a **lasso** (the mask matches the source image size and
   survives reloads);
3. Enter a repaint instruction and run it:
   - **ComfyUI online** → a real inpaint workflow (FLUX.1 Fill / SD inpainting presets, or custom JSON);
   - **ComfyUI offline** → automatic fallback to a **demo repaint** (mosaic transform inside the mask), labelled
     “🧪 demo repaint · not a real generation”;
4. Results **stack as versions** on the artifact card: `‹ v 2/3 ›` switches and rolls back; up to 20 versions,
   and you can keep layering after rolling back.

## 7. The 3D camera stage

![3D camera stage](./screenshots/20_canvas_stage3d.png)

1. Drop a “🎥 3D camera stage” node from the palette, then click “🎬 Enter 3D camera stage” inside it;
2. Left column:
   - **Character tree / objects**: add the mannequin, add box/cylinder/sphere placeholders, import a custom
     model (**you supply the model file and its licence — local parsing, never uploaded**);
   - **Cameras**: add a camera, click a camera to fly to it, write the current director view into it;
   - **Environment**: import a panoramic background (equirectangular);
   - **Scene presets**: six **procedural primitive** sets (product podium / studio / living room / bedroom /
     outdoor steps / exhibition) — they replace geometry and **keep the character**; over-limit requests are
     rejected wholesale rather than half-rendered;
   - **Frame export**: render first/last frames of the selected camera (or all cameras);
3. Right column: position/rotation/scale of the selected object (numeric edits apply live), camera FOV, and a
   **keyframe timeline** (≤60 keyframes);
4. Bottom toolbar: move / add character / box / cylinder / sphere / marquee select;
5. A permanent honest label in the bottom-right: **staging costs no credits · 0 credits · fully local rendering**;
6. Downstream wiring:
   - into **video generation** → “⚡ 3D single shot · demo engine” (image-to-video when a reference frame exists,
     otherwise text-to-video);
   - into **storyboard** → “🎬 generate 3D free storyboard” (**shot count = camera count**, 1–12).

> **Animation presets** offer eight options (idle / walk / jog / sprint / dance / sit / jump / talk), all taken
> from the built-in character's **real animation clips**. The reference design's “wave / turn” has no matching
> clip in the CC0 library — substituted honestly, never faked. Pose stacking pauses while an animation plays
> (absolute poses would fight each other).

## 8. Skill distillation / reuse / market

**Distil**: box-select ≥2 nodes → toolbar “📦 Export Skill” → a manifest JSON:

- Topology uses **slot ids** (slot-1..N, assigned deterministically by coordinates) so it is portable;
- Only whitelisted parameter slots survive (brief.text / product.title / script.scriptScene); **artifact
  references, maskRef and import history are stripped**;
- Input/output declarations describe which entry nodes need input and which node is the output.

**Reuse**: toolbar “📥 Import Skill” → validated, then the whole batch lands:

- Node ids are fully remapped so it coexists with existing nodes;
- Entry nodes highlight “📥 fill new input”; other parameters carry over;
- Ctrl+Z rolls back exactly this import, not your earlier work.

**Market** (toolbar “🧩 Skill Market”):

![Skill Market](./screenshots/18_canvas_skill_market.png)

- “Skills” list with source filters (all / official / imported / created in conversation) and search;
- Installed section: enable/disable (a disabled official Skill disappears from the canvas shortcuts but does
  **not** affect nodes already placed), deploy to canvas, publish locally, uninstall;
- Not-installed section: one-click install;
- You can also **create a Skill through conversation** (same orchestration prompt) or **upload** an existing
  manifest;
- **Honest**: there is no community publishing channel and download counts are never faked; “publish” means
  downloading the manifest JSON and says so.

## 9. Memory system and memory graph

**Memory system**: script writing weights hook sampling by your historical win rates; when history is used the
node shows a “📊 this suggestion comes from your history” badge (hidden otherwise).

- **Server mode**: companion server started with `WLS_STORAGE=sqlite` → records go through
  `/api/memory/records`, `/healthz` capability `memory:'sqlite'`;
- **Pure front-end mode**: records live in local IndexedDB and the UI says “memory stored locally only”;
- Both modes share **one Laplace aggregation** (`computeWinRates`, the only implementation site-wide).

**Memory graph** (toolbar “🧠 Memory graph”):

![Memory graph · honest empty state](./screenshots/19_canvas_memory_graph_empty.png)

- With no records it shows an honest empty state — **sample data is never seeded**;
- With records it shows win rates across three buckets (structure / hook / category), recent feedback as
  bubbles, and canvas image assets as thumbnail leaves;
- Zoom (±) and an enable/disable switch;
- The settings panel's “3. Memory” section shows the record count plus the top win rates per bucket and offers
  a one-click clear (after clearing, win rates fall back to the 0.5 prior).

## 10. Connector panel

![Connector panel](./screenshots/22_canvas_connectors.png)

- Seven recommended connector cards (productivity / developer tools / marketing) plus custom connectors
  (stored locally);
- The mode tag honestly reflects current capability: “pure front-end mode · no functionality available”, or
  “companion server online · interface only”;
- Clicking “＋” without a companion server returns an explicit 501 message instead of pretending to succeed.

## 11. Multi-canvas projects and minimap

- Switch projects from the toolbar dropdown; `+ New project` / `🗑 Delete project` (at least one is kept);
- **Each project has its own storage key**, so switching never bleeds data; the canvas name tracks the project name;
- **Legacy single-canvas documents migrate with zero loss**: on first read the old key's content is copied into
  a “default project”, and the old key is kept as a safety net;
- The **minimap** in the bottom-right shows every node and the current viewport; click or drag to navigate.

## 12. MCP both ways (optional dependency)

- When the companion server detects `@modelcontextprotocol/sdk`, `/healthz` reports `mcp:'ready'` and the
  canvas toolbar shows a “🤖 MCP ready” badge;
- Once ready the canvas syncs every 2 seconds: pull Agent-submitted operation batches → validate → apply in a
  single `editor.run`; it also pushes the canvas topology mirror to the server for the Agent to read;
- Agent-side ids are salted so repeated submissions never duplicate nodes; rejected batches surface a Chinese
  reason on the canvas;
- **Without the SDK** every endpoint returns 501 plus install guidance and the server logs nothing scary
  (the zero-dependency default is unchanged).

See [mcp.md](./mcp.md) for the endpoint details.

## 13. Bilingual UI and the settings panel

- Toggle with “🌐 中文 / EN” in the top bar, or use the “0. Interface language” section at the top of the
  settings panel;
- The switch applies **immediately and is persisted** (`localStorage` key `weblockshot.language`); invalid
  values fall back to Chinese;
- Covered scope (top bar / toolbar / node palette / node headers / chat bar / onboarding / settings skeleton)
  and what is not covered yet are listed in [i18n.md](./i18n.md).

![English UI](./screenshots/23_canvas_en.png)

## 14. Honest boundaries and known limits

1. **Kling / Jimeng / ComfyUI are not wired into canvas rendering** (use the commerce workbench); canvas
   rendering uses the Mock / demo engine.
2. **“Single-shot” and 3D-stage rendering only use the demo engine**; real engine paths await a live environment.
3. **When ComfyUI is offline** local repaint falls back to the demo mode and says so.
4. **Pure front-end memory is local-only**; connecting a companion server with `WLS_STORAGE=sqlite` upgrades it.
5. **The canvas document contract caps at 200 nodes / 400 edges**: beyond that it stops persisting (measured in
   T3; the UI has no warning yet — see the main README's remaining-items list).
6. **The tldraw free tier adds a watermark**, and in production without a license key rendering stops after
   roughly 5 seconds; this project provides no bypass.
7. **i18n covers “key copy”**; node internals and some overlays are still Chinese.
8. **MCP / connectors are mostly API-level** (plus the MCP badge and connector panel); deeper two-way
   orchestration means calling the documented endpoints.
