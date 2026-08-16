# AGENTS.md

Local static placement calculator. Hero output is a `-filter_complex` string. The full command is a libx264 CRF template (audio + metadata optional). It never runs FFmpeg.

Read this before changing `js/ffmpeg.js`, preview geometry, state, or `computeCommand`. The spec (frozen goldens, module contracts, UI ids) is [DESIGN.md](DESIGN.md). User-facing how-to is [README.md](README.md). Command / smoke-test notes are [docs/notes.md](docs/notes.md). Do not copy those documents here.

Load order in `index.html`: `state.js` → `ffmpeg.js` → `preview.js` → `modal.js` → `main.js`. Classic `<script src>` on `window.WM`. Cache-bust those (and CSS / icons / `site.webmanifest`) with `?v=` on the URL; bump the query when shipping a change to any of them.

Related but separate product: [ffmpeg.party](https://github.com/a5ah1/ffmpeg-party) (x264 wizard at `/tools/x264-wizard/`). Audio/metadata flags were ported from that wizard. That repo is not a dependency. Scratch checkouts belong outside this tree (`_tmp/` is gitignored).

## Stack that is easy to break

- Classic `<script src>` on `window.WM`. **No ES modules** — Chromium refuses them on `file://`.
- No npm, bundler, TypeScript, or FFmpeg.wasm unless the owner explicitly asks.
- Test page loads **only** `state.js` + `ffmpeg.js`. Do not pull `preview.js` / `main.js` / `modal.js` into it.
- `setState` is a **shallow** merge. Replace `frame` / `watermark` / `encode` as whole objects. Use `patchEncode` for encode field edits. Name edits go to top-level `frameName` / `wmName` / `videoName` / `outputName`.

## Three filename fields (easy to mix up)

| Field | State | Role |
| --- | --- | --- |
| `#frame-name` | `frameName` | Label only. Not a command path. |
| `#wm-name` | `wmName` | Second `-i`. User may paste `C:\media\logo.png`. |
| `#video-name` | `videoName` | First `-i`. Empty → `INPUT_VIDEO`. |

Filenames **never** enter the filtergraph. Only integers, fixed filter names, and `loop=-1`. `quoteArg` is for `-i` / output / wrapping the graph in the shell command.

`File.name` is basename only. Editing a name field must not reload the bitmap.

## Filter emitter — do not “simplify”

**Normal** is the short, correct path: still as overlay *secondary*, `repeatlast=1` (default) holds it for the video. Do **not** add CLI `-loop 1` or CLI `-shortest`.

**Non-normal blend is a different framesync shape.** `blend` first input is top. We keep the watermark first because `all_mode=overlay` is not commutative (`multiply` / `screen` / `addition` / `darken` / `lighten` are). That makes the still the framesync *primary*. A 1-frame primary emits **one frame**; overlay then stamps **video frame 0** into the logo region for the rest of the clip. Looks like a successful encode.

So the blend path must:

1. Crop both patches to the frame intersection (`intersectCrop`). **Never `pad`.** Official `pad` *re-centers* when `x` or `y` is negative, and `black@0` padding multiplied against the frame crushes the picture.
2. `loop=loop=-1:size=1` the still RGB and the extracted mask *inside the graph*.
3. Explicit `[0:v]split[base][bot]`. Do not rely on the CLI auto-splitting a labeled pad.
4. `blend=all_mode=…:shortest=1` so the finite video ends the filter.
5. Join `{wmChain},split` with a **comma**. `format=rgba` is always on this path (even at opacity 1) so `alphaextract` has a plane.

Goldens A/B/C in DESIGN.md are asserted with `===`. If you cannot match them, hide `#blend` and ship overlay-only. Do not invent a third graph.

`formatAa` must stringify like JS (`0.8`, not `0.800`). Overlay omits `scale` / `format=rgba,colorchannelmixer` when they are no-ops. Emit `overlay=…:format=auto` (not the filter default `yuv420`). No trailing `format=yuv420p` in the copied graph. Encoder `-pix_fmt yuv420p` belongs on the **command**, always.

Fully off-frame + blend selected → fall back to the overlay path (FFmpeg clips) and set the status line.

A still-on-still encode **cannot** catch the frame-0 freeze. Blend changes need the [docs/notes.md](docs/notes.md) multi-frame smoke test (motion under the logo, encode completes).

## Preview geometry

FFmpeg sees **source pixels of the dropped frame**, not CSS pixels.

`#frame-img` fills `.frame-wrap`, which is already the letterboxed contain-rect. **Do not** use `img.getBoundingClientRect()` to find the painted image — with `width/height: 100%` the element box is the wrap, not a second contain.

`.wm` is **inside** `.frame-wrap`, so its `left`/`top` are `state.x * viewScale` (not `contained.left + …`). Clip via `overflow: hidden` on the wrap.

`getContainedRect` / `mapPointerToSource` live in `state.js` so the two-script test page can assert letterboxing (including a non-square stage).

`.layout` is a viewport-locked two-column grid (`height: 100%`, `overflow: hidden` on `html`/`body`). `#stage` fills the left cell (`position: relative`, `overflow: hidden`, `min-height: 0`) so a large frame cannot grow it — `getContainedRect` letterboxes into the stage box. `#form` is the only vertical scroller. Do **not** make the stage stretch to the form’s content height or the drop hint’s center falls below the fold.

Other UI landmines:

- `preventDefault` on `dragenter` / `dragover` / `drop` or `drop` never fires.
- `draggable="false"` on both images and cancel `dragstart` on `#stage`, or a pointer-drag starts a browser image-drag.
- Wait for `img.decode()` / `onload` before reading `naturalWidth`.
- Clicking `.wm` must `stageEl.focus()` (`tabindex="0"`) or arrow nudge does nothing.
- Document keydown must return if `WM.modal.isOpen()`. Otherwise Escape deselects the watermark and can cancel dialog close.
- Opacity and `mix-blend-mode` only on `#wm-img`. Handles stay `mix-blend-mode: normal`. CSS blend is not a proof.
- `addition` preview is `plus-lighter` with a `lighten` fallback; the graph still says `addition`.
- Revoke blob URLs on replace and `pagehide` only. Do not set `beforeunload` / `returnValue`.
- Accept MIME **or** extension. Disk drops often have `type === ""`. Reject SVG even if the browser can rasterize it.
- `.field { display: flex }` beats the UA `[hidden]` rule. Keep `[hidden] { display: none !important; }` in `css/app.css`.
- One `<dialog id="modal">`, panels `#panel-encode` `#panel-help` `#panel-about` `#panel-reset`. `WM.modal.open/close/isOpen`. `?modal=encode` / `help` / `about` / `reset` opens after first render.
- Tab persistence is `sessionStorage` (`WM.SESSION_KEY` = `wm.v1`, plus `.frame` / `.wm` data URLs). Lost on tab close. Reset (`#open-reset` → confirm `#confirm-reset`) clears state and those keys. Do not add `localStorage` or `beforeunload` / `returnValue`. `revokeUrl` only revokes `blob:` URLs (restored images are `data:`).
- Desktop-first. No mobile layout requirement. Do not add a second command preview inside the modal; `#command-out` stays on the page.

## Command / encode

`computeFilterGraph` is frozen (goldens A/B/C). Encode flags belong only in `computeCommand`.

`state.encode` is one object. `setState({ encode: { crf: 18 } })` wipes the rest — use `patchEncode`. `encodeOf` does **not** merge defaults; helpers must tolerate a partial `encode` (tests pass partials).

Always on the command: `-c:v libx264 -crf N -preset P -pix_fmt yuv420p`. No `placebo`. No output `-r`. No `-vf`. No CLI `-loop 1` / `-shortest`. No raw “additional options”.

| Piece | Rule |
| --- | --- |
| `-ss` / `-to` | Immediately before the **video** `-i` only. `formatTime`: trim, `;` → `:`. Unquoted. Input seek, not frame-accurate. |
| `fpsPreset` | `""` / 24 / 25 / 30 / 50 / 60. Emits `-x264-params "keyint={10×fps}:aq-mode=2"` only. Not an output frame rate. |
| Audio | `copy` → `-c:a copy` (default). `none` → omit. `aac` VBR → `-q:a` 0.1–2 (default 2, experimental). `libfdk_aac` VBR → `-vbr` 1–5 (default 3). CBR either codec → `-b:a` (default `192k`). `libfdk_aac` needs a custom FFmpeg build. |
| Metadata | After audio. Optional `-map_metadata -1` plus `-metadata title\|description\|comment\|year=`. Empty fields omitted. Values via `quoteArg`. |

Default command:

```
ffmpeg -i "INPUT_VIDEO" -i "WATERMARK" -filter_complex "…" -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -c:a copy "OUTPUT"
```

## Tests

Open `js/ffmpeg.test.html` (static server or `file://`). Every row must stay PASS.

When adding a generator case, assert the **full string**, not `indexOf`. Compare object fields, not `JSON.stringify` (key order is not part of the contract).

Do not add a Node test runner unless asked. The HTML page is the runner.

## Changing the product

Safe without revisiting goldens: UI chrome, copy/empty-state copy, presets, keyboard, README.

Touches goldens / framesync: treat as a spec change. Update DESIGN.md examples, `ffmpeg.test.html`, and the [docs/notes.md](docs/notes.md) blend smoke-test notes together.

Out of v1 unless the owner asks: rotation, non-uniform scale, multiple watermarks, `drawtext`, timed `enable=`, clamp-inside, SVG, BMP, AVIF, video-as-frame, running FFmpeg in-page, ABR / 2-pass, `-movflags +faststart` as a required default, 10-bit, `localStorage`, a Node test runner.

Command template is double-quoted cmd / POSIX. PowerShell may still need `cmd` or `--%`.
