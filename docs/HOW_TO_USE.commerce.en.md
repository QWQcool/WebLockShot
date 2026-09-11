# Branch 2 · E-commerce commerce pipeline (plus the legacy drama studio)

> Main handbook: [HOW_TO_USE.en.md](./HOW_TO_USE.en.md) ·
> Canvas branch: [HOW_TO_USE.canvas.en.md](./HOW_TO_USE.canvas.en.md) ·
> 中文版: [HOW_TO_USE.commerce.md](./HOW_TO_USE.commerce.md)（权威版本，内容最全）

Enter via the top bar (“🎯 Commerce Studio”) or the deep link `?view=sell`.

---

## Contents

- [1. The six-step workflow](#1-the-six-step-workflow)
- [2. The two standalone studios](#2-the-two-standalone-studios)
- [3. Video providers and private ComfyUI compute](#3-video-providers-and-private-comfyui-compute)
- [4. CapCut / Jianying draft import and alignment](#4-capcut--jianying-draft-import-and-alignment)
- [5. Feedback loop](#5-feedback-loop)
- [6. Drama rough-cut studio (legacy)](#6-drama-rough-cut-studio-legacy)
- [7. Honest boundaries](#7-honest-boundaries)

---

## 1. The six-step workflow

Click “🛒 commerce workflow” in the top navigation and follow the industrial steps. Every stage is backed by
schema-validated data assets.

### Step 0: multimodal product import

![Step 0 product import](./screenshots/01_step0_product_import.png)

- **Link import**: paste a product image URL; the system archives it honestly and guides you to write the core
  differentiating selling points
- **Image import**: upload a white-background or transparent product shot, or pick one of the nine built-in
  3C / beauty / apparel mock presets
- **Reference video import**: upload a local reference clip; a Canvas-based frame-extraction engine samples it

### Step 1: choose a structure and a golden-3-second hook

![Step 1 structures and hooks](./screenshots/02_step1_template_hook.png)

Five six-shot structures validated by real distribution data:

1. **Pain-Solution**: counter-intuitive opening → amplify the pain → the product breaks through → macro of the
   core feature → trust evidence → urgent call to action
2. **Contrast-Shock**: shocking comparison → reveal the mechanism → deep hands-on test → upgraded experience →
   credentials remove doubt → call to action
3. **Sensory-Unboxing**: audio-visual macro unboxing → material and texture details → ritual of interaction →
   scene integration → value anchor → offer to close
4. **Drama-Insert**: everyday conflict → dramatic predicament → the fix arrives → crisis resolved → emotional
   resonance → purchase guidance
5. **Price-Anchor**: premium price comparison → expose the markup → benchmark craftsmanship → trace the source
   cost → release the deal → lock the order

### Step 2: dual-Agent scripting and adversarial review

![Step 2 script and critic](./screenshots/03_step2_script_critic.png)

- **ScriptWriter**: combines the selling points with the chosen structure to write six shots of vertical-video
  dialogue and visuals
- **ScriptCritic**: acts as a demanding platform reviewer, scoring 0–100 across four axes (3-second hold,
  selling-point visualisation, completion pacing, compliance) and returning a radar chart plus concrete fixes

### Step 3: 9:16 GSAP storyboard preview

![Step 3 GSAP storyboard](./screenshots/04_step3_gsap_storyboard.png)

- Before dispatching anything to expensive compute, the `sell-stage` GSAP stage renders a full 9:16 simulation
- Preview each shot's framing (close-up, medium, wide), push/pull/pan/tilt motion, and the beat of on-screen
  selling-point captions

### Step 4: visual prompt compilation

![Step 4 visual compiler](./screenshots/05_step4_visual_compiler.png)

- Storyboards are compiled into precise bilingual positive/negative prompts
- Aspect ratio (9:16), shot duration (3–6 s) and render parameters (8K, lighting, camera path, anti-distortion
  constraints) are normalised automatically

### Step 5: serial task queue and rendering

![Step 5 render queue](./screenshots/06_step5_render_queue.png)

- A single-machine serial scheduler dispatches each shot
- Backed by Kling, Jimeng, **private ComfyUI**, the mock local recorder, or **Runway / Luma (overseas ·
  contract-first)**
- Live queue progress, per-shot retry, and precise error reporting

### Step 6: review, TTS narration and draft export

![Step 6 delivery player](./screenshots/07_step6_deliver_player.png)

- A six-shot seamless review player with full-screen preview and per-shot inspection
- **Adaptive TTS**: speaking rate scales to each shot's duration so the line finishes exactly on time
- **Draft export**: one click produces the aligned `draft_content.json`, or download the full zip including all
  assets
- When an asset is gone (local cache lost after a refresh) the UI shows an explicit “expired” placeholder
  instead of a dead player

---

## 2. The two standalone studios

### Mode A: single-Agent fast path

![Mode A single-Agent studio](./screenshots/08_single_agent_studio.png)

For single-shot experiments and image-to-video:

- **Curated inspiration library**: high-conversion presets such as 3C metallic sheen, beauty serum macro and
  streetwear lighting
- **AI camera-movement polishing**: type a rough idea and the AI expands it into a cinematic prompt with camera,
  lighting and depth of field
- **Multimodal reference panel**: reference images (drag and drop, nine-grid mock loading, double-click
  lightbox) and reference videos (motion mimic)
- **Flexible duration**: 5 s / 10 s / 15 s presets or a custom 1–60 s value

### Mode B: multi-Agent director room

![Mode B multi-Agent studio](./screenshots/09_multi_agent_studio.png)

- **Two honest modes**:
  - **Real deliberation**: with an LLM key configured, four agents deliberate through a real LLM — director →
    cinematographer → critic → dispatcher — and the QA score is a genuine differentiated score
  - **Demo animation mode**: without a key, the first timeline message and the project badge explicitly say
    “🧪 demo animation mode · scores are not real”; no score is fabricated
- **Configurable polling window**: 2/5/10/20 minutes from the top bar; timeouts always refund in full

---

## 3. Video providers and private ComfyUI compute

![API settings and GPU probe](./screenshots/10_token_settings_comfyui.png)

Open **“⚙️ API settings”**. There are six engines:

| Engine | Credential | Billing | Verification |
|---|---|---|---|
| Mock lab canvas | none | 0 credits | ✅ verified locally |
| Kling | bare key (Bearer) or JSON `{"ak","sk"}` (official JWT) | ~10 credits/shot | ✅ contract-verified / ⏳ live env |
| Jimeng | bare key or JSON `{"ak","sk"}` (Volcengine V4 HMAC-SHA256) | ~8 credits/shot | ✅ contract-verified / ⏳ live env |
| 🔥 private ComfyUI | base URL (local/LAN) | **0 API fees** | ✅ verified locally |
| **Runway (Gen-4)** | Bearer API key | official credits | ✅ contract-verified / ⏳ **awaiting a real environment** |
| **Luma (Dream Machine)** | Bearer API key | official credits | ✅ contract-verified / ⏳ **awaiting a real environment** |

> **The overseas engines are contract-first**: body / endpoint / headers / poll-state mapping / error text are
> all implemented from the official docs and locked by `test/fixtures/runway|luma/` plus
> `src/media/__tests__/providerContract.test.ts`; **but no render has been run through a live account yet**, and
> both the UI and these docs say so. Without a key **no request is sent at all** — you get an explicit
> “no Runway/Luma API key detected” message instead. To use your own gateway, set the sessionStorage keys
> `weblockshot.runway_base` / `weblockshot.luma_base`.

### Private ComfyUI compute (0 API fees)

1. **Start ComfyUI** (the `--listen` flag is required):

   ```bash
   python main.py --listen 127.0.0.1 --port 8188
   ```

2. **Recommended models**: Alibaba Wan 2.1 (WanVideo I2V, 14B / 1.3B), Zhipu CogVideoX-5B, Stability SVD-XT;
3. **Bind and probe**: settings → video provider “ComfyUI self-hosted / private compute” → instance URL
   (default `http://127.0.0.1:8188`) → click “🔍 test connection (ping GPU)” to read the GPU model and free VRAM.

---

## 4. CapCut / Jianying draft import and alignment

In the final “✨ review & deliver” step, click “📥 export CapCut draft (draft_content.json)”.

### How the alignment works

1. **Three tracks aligned to the microsecond (1 s = 1,000,000 µs)**: `track_video` (six shots in order),
   `track_audio` (narration start/end match the video exactly), `track_text` (viral captions; shot 1's golden
   hook is pre-set to yellow highlight and a larger size);
2. **No black frames**: `source_timerange` and `target_timerange` are computed precisely so there are no black
   frames or overlapping audio peaks.

### Import steps (zip recommended)

![Draft zip export](./screenshots/13_jianying_zip_export.png)

Click “📦 download full draft zip (with assets)”; the archive contains:

- `draft_content.json` / `draft_meta_info.json`: the standard draft project (asset paths rewritten to relative
  `assets/...`)
- `assets/`: rendered shot videos and optional narration audio
- `README-使用说明.txt`: the asset manifest (missing assets are listed honestly) and import steps

Then:

1. Unzip `<project>_剪映草稿.zip`
2. Open CapCut desktop, create an empty draft, then close it
3. Enter the draft folder (Windows default
   `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<draft>\`)
4. Copy `draft_content.json`, `draft_meta_info.json` and `assets/` into it (overwrite)
5. Reopen CapCut — the fully aligned project is ready

> When the companion server is online a “send to companion server” button appears and unpacks it for you
> (see the main handbook's companion-server section).

---

## 5. Feedback loop

![Feedback dashboard](./screenshots/12_reflow_board.png)

1. Click “📊 feedback dashboard” in the top navigation
2. Fill in the form: video title, matched structure template and hook, product category, and the platform's
   **3-second view-through / completion rate / conversions**
3. Click “📥 record feedback” — the record is stored in local IndexedDB
4. The dashboard aggregates win rates across **structure / hook / category** (pure CSS bars, sorted high to low)
5. Win rates use **Laplace smoothing**: `(wins + 1) / (trials + 2)`, where a 3-second view-through rate ≥ 30%
   counts as a win
6. Every subsequent script generation weights hook sampling by real win rates

> Data lives only in your browser's IndexedDB and is never uploaded. The canvas memory system shares **the same
> aggregation**.

---

## 6. Drama rough-cut studio (legacy)

![Drama rough-cut studio](./screenshots/25_drama_legacy.png)

- Enter via the top bar (“🎭 Drama Studio”) or `?view=drama`;
- Ships six-shot drama previews and prompt-pack export for three built-in scripts;
- **Position**: kept for compatibility and zero regression (the sell / drama pipelines are deliberately not
  canvas-ified). **New work should start on the Agent Canvas**, which offers the same preview and rendering
  capabilities plus free topology and Skill reuse.

---

## 7. Honest boundaries

- **Kling / Jimeng live rendering awaits a real environment**: signing and request shapes are contract-verified;
  live rendering needs your own keys plus
  `npm run verify:providers -- --kling-key=AK:SK --jimeng-key=AK:SK`;
- **Runway / Luma await a real environment** (contracts implemented and locked, no live render yet);
- **The mock engine costs 0 credits**; other engines bill through the two-phase virtual wallet;
- Without a key the relevant engines are **honestly disabled with a message**, never pretending to work.
