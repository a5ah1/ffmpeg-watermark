# Notes

Operator and maintainer details that do not belong on the front of [README.md](../README.md). Fine to publish.

## Generated command

Encode settings (CRF, preset, tune, source-fps keyint, in/out, audio, metadata) live in **Encode settings**. They do not change the filter graph.

- The source-fps hint does **not** change output frame rate. It only sets `keyint=10×fps` and `aq-mode=2`.
- In/out points (`-ss` / `-to`) apply to the video input only. They are a fast input seek, not frame-accurate.
- Audio default is **copy**. Choose **omit** when the source has no audio. Native `aac` VBR uses `-q:a` (0.1–2, experimental). `libfdk_aac` VBR uses `-vbr` 1–5 and needs a custom FFmpeg build. CBR is `-b:a` for either codec.
- Metadata strip/title/description/comment/year are optional and apply to the output file.
- Do **not** add CLI `-loop 1` or CLI `-shortest`. A still second input is held for the whole video by overlay `repeatlast=1`.
- Non-normal blend modes use an in-graph `loop=loop=-1:size=1` plus `shortest=1` on `blend`, `alphamerge`, and the final `overlay`. Those are filter options, not input flags. Do **not** add CLI `-loop 1` or CLI `-shortest`. If a blend encode hangs on the last frame, the graph is missing `shortest=1` on `alphamerge`/`overlay` (the looped mask never EOFs; default framesync repeats the last mix). Input `-ss`/`-to` (Encode settings) already EOF the video input; overlay `shortest=1` honors that.
- `-pix_fmt yuv420p` is an encoder flag so the result plays in common players. It is not part of the copied graph.

The copied command is a double-quoted cmd / POSIX template. PowerShell may still need `cmd` or `--%`.

## Blend-mode smoke test

Paste a generated multiply (or other non-normal) graph onto a **multi-frame** clip:

```
ffmpeg -i video.mp4 -i logo.png -filter_complex "…" -c:a copy out.mp4
```

Play the result and confirm motion continues **under** the logo, and that the encode completes. A still-on-still encode cannot catch a frozen-frame bug. Preview blend is CSS (`mix-blend-mode`) and is not pixel-identical to FFmpeg.

Odd-sized patches need `exact=1` on the **video** crop. Default `crop` on yuv420p rounds odd W/H/X/Y down (chroma alignment), so a 55-wide still becomes top 55×H vs bottom 54×H and `blend` errors (`First input link top parameters … do not match`). The generator always emits `exact=1` on `[bot]crop`. That is not a blend-mode bug — Normal/overlay never crops the video, so it does not hit this. Include at least one odd W or H in a smoke test when changing the blend graph.

`No accelerated colorspace conversion found from yuv420p to argb` is a libswscale warning, not a PNG-colorspace bug. Blend's `alphamerge` on `gbrp` makes overlay negotiate packed ARGB and convert the **full video frame** `yuv420p→argb`; that pair has no SIMD (the 14-odd repeated lines are slice threads). The generator uses `overlay=…:format=rgb` on the blend path so the convert is `yuv420p→rgba`/`rgb24`, which is accelerated. Harmless if you still see it from some other filter; quality is the same either way.

## Preview size

The stage default is **1:1**: a frame smaller than the stage stays native CSS pixels. **Fit** (bar under the preview) is unconstrained contain and is not written to session storage. Large frames still scale down either way. Watermark `defaultPlacement` still scale-downs to the frame on drop; that is source pixels, not preview zoom.

## GIF

Accepted as a still. The browser may animate the preview; FFmpeg may decode more than one frame. Treat GIF as static.

## Tests

Open `js/ffmpeg.test.html` the same way as the app. Every row should read PASS.

When adding a generator case, assert the **full string**, not `indexOf`. Compare object fields, not `JSON.stringify` (key order is not part of the contract). The HTML page is the runner; there is no Node test runner.

## Debug

Check **Debug** or open with `?debug=1` for `console.debug` snapshots of state and generated strings. `?modal=encode`, `?modal=help`, `?modal=about`, or `?modal=reset` opens that panel after first render.
