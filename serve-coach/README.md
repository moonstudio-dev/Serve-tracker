# Serve Coach — integrated app

The integrated Serve Coach web app. It is built from the new mobile interface (`../new-app/index.html`), with the original tracker (`../index.html`) as the technical reference.
**Neither original file is modified.**

- Plain HTML, CSS and JavaScript modules. No framework, no build step.
- Live URL (once this folder is on the branch GitHub Pages serves): `https://moonstudio-dev.github.io/Serve-tracker/serve-coach/`
- All data stays on the device. Clearing browser data or losing the phone can delete it.

## Structure

```
serve-coach/
  index.html            markup + CSS (from the new app), pinned TensorFlow.js scripts
  assets/               neutral placeholder images (no personal photos)
  js/
    app.js              routing, navigation, screen interactions
    camera.js           camera permission and stream lifecycle
    pose.js             TensorFlow.js + MoveNet, frame loop
    overlay.js          skeleton drawing, video-to-canvas mapping
    debug.js            hidden debug panel (?debug=1)
    store.js            LocalStorage now; IndexedDB from Stage 3/4
    tracking-quality.js placeholder: Stage 2
    session.js          placeholder: Stage 3
    recorder.js         placeholder: Stage 4
    features.js         placeholder: Stage 5
    serve-detector.js   placeholder: Stage 6
    coach.js            placeholder: later stage
```

Pinned libraries (same versions as the original tracker): `@tensorflow/tfjs-core`, `-converter`, `-backend-webgl` **4.11.0**, `@tensorflow-models/pose-detection` **2.1.3**.

## Navigation

Bottom tabs: **Home · Record · Progress**. The AI coach lives inside Progress.

| Route | Screen |
|---|---|
| `#home` (default) | Welcome, Start a practice, recent practice, latest insight, link to Progress |
| `#setup` | 5-step camera setup (shown under the Record tab) |
| `#record` | Practice screen; sends you to setup until a camera spot is saved |
| `#progress` | AI coaching insights → Video recordings → Serve comparisons → Practice sessions → Notes |

Old prototype links still work: `#live` → `#record`, `#coach` and `#log` → `#progress`.

## Stage 0 changes compared with `new-app/index.html`

Changed on purpose:
- Name: "Serve Check" → **Serve Coach**.
- Navigation: Serve · Coach · Progress → **Home · Record · Progress**. A new minimal Home screen. Coach content moved into Progress.
- Personal photos (4 base64 JPEGs) replaced with neutral placeholder SVGs in `assets/`.
- TensorFlow.js scripts pinned to the versions above (they were unpinned "latest").
- JavaScript split into modules. Behaviour kept the same, except:
  - the MoveNet model loads only once, even if requested twice while still loading;
  - the frame loop is started only once;
  - the two `console.log` calls that ran on every frame are removed.
- Example content is labelled as such: a notice at the top of Progress, example session names ("Example 1–3" instead of dates), and "Example session" above the coaching.
- Setup step 5 copy no longer promises a 10-serve baseline (per the brief: compare with the previous compatible session first).
- Record demo note reworded to say serves are counted by button for now.
- Grid fix so nested Progress sections fit the screen width.

Still demo-only (kept deliberately until the real replacement works):
| Demo behaviour | Replaced in |
|---|---|
| Scripted picture checks (the "light" check always fails first time) | Stage 2 |
| Level bubble animates to "Level" when no sensor is available | Stage 2 |
| Countdown + "Next serve" button with scripted cues on Record | Stages 3 and 6 |
| Example coaching, comparisons, sessions and Q&A in Progress | Stage 7 |

## Stage 0 test results

Tested in headless Chrome at phone size (390 × 844) with a simulated camera. Not yet tested on real phones.

| Acceptance criterion | Result |
|---|---|
| New application loads independently | **Passed** (desktop headless Chrome) |
| Original versions remain untouched | **Passed** (SHA-256 of `index.html` and `new-app/index.html` unchanged) |
| Navigation works (Home/Record/Progress, setup gate, old links) | **Passed** (desktop headless Chrome) |
| No functionality lost without being documented | **Passed**: see lists above |
| Pinned TF.js libraries load and initialise the WebGL backend | **Passed** (packages loaded from npm in the sandbox) |
| MoveNet model download and keypoints on screen | **Not tested**: the sandbox can't reach the model host. Check on your phone. |
| iPhone Safari / Android Chrome | **Not tested** |

## Stage 1 — camera and skeleton

### Why iPhone and Android behaved differently (Stage 0 test, 16 Nov)
- iPhone Safari: dots roughly followed the body. Android Chrome: dots stayed near the centre and only a few appeared.
- Cause: the preview box is portrait (≈201×370). Stage 0 asked for 640×480 with no orientation. **iPhone Safari returns a portrait frame (480×640)**, which is close to the box shape, so the stretched canvas was only slightly off. **Android Chrome returns the landscape 640×480 frame**; the video is scaled ×0.77 and its sides cropped (only video x≈190–450 of 640 is visible), while the canvas was squeezed into the box at ×0.31. Every dot moved only ~40 % as far as the body, toward the centre.
- Fewer dots on Android: Stage 0 hid any point under 0.5 confidence; MoveNet's own demos draw from 0.3.
- Reproduced in automated tests with synthetic camera feeds (markers at known pixels): with a landscape feed, the Stage 0 mapping misses every off-centre marker; with a portrait feed it nearly hits. The new mapping hits every marker in both.

### What changed
- `overlay.js`: one shared video-to-screen mapping that reads the video's real size and `object-fit` (cover), so points get the same scale and crop as the picture. Canvas drawn at display size × device pixel ratio, resized only when sizes change. Full skeleton lines and points; draw threshold 0.3.
- `camera.js`: rear camera by default, no mirroring; asks for a portrait-shaped picture on a portrait screen (browsers may still return landscape; the mapping handles both); one stream only; a stream that arrives after the user left is discarded; `stopCamera()` stops all tracks; plain-English errors (no `alert`).
- `pose.js`: controlled loop (start/stop, one frame at a time, skips frames when video isn't playing, FPS); smoothing reset on restart; WebGL backend, switching to WASM (CPU) on GPUs that can't render 32-bit floats (a known cause of poor MoveNet scores). `?backend=wasm|webgl` forces one.
- `app.js`: camera + tracking run only on setup step 4. They stop on Back/Next, on leaving the setup screen, when the page is hidden or closed. Status line under the preview ("Starting camera…", errors, front-camera fallback) with a Try again button.
- `debug.js`: `?debug=1` panel with camera/track/video dimensions and orientation, display and canvas sizes, object-fit, mapping and the visible part of the video, backend, FPS, frames processed, pose score and every keypoint's score and position. **Copy** puts it all on the clipboard as JSON.

### Stage 1 acceptance
| Criterion | Status |
|---|---|
| Overlay mapping matches rendered video, landscape and portrait feeds, incl. near frame edges | **Passed** (headless Chrome, synthetic feeds) |
| Skeleton follows the body on iPhone Safari | **Not tested** |
| Skeleton follows the body on Android Chrome | **Not tested** |
| Dots and lines stay aligned while moving arms and legs around the frame | **Not tested** on phones |
| Tracking works with the full body visible, not only with hands raised | **Not tested** on phones |
| Leaving the camera step / screen / hiding the page stops the camera | **Passed** (headless Chrome); phones not tested |
| No duplicate streams or loops (re-entering step 4, rapid Back/Next) | **Passed** (headless Chrome) |
| Clear permission and camera errors | **Passed** (permission denied, headless Chrome) |
| Single model initialisation; WASM fallback loads | **Passed** (headless Chrome; model download not reachable from the test sandbox) |
| Performance acceptable on real phones | **Not tested** (FPS shown in debug panel) |

Stage 1 is not complete until both phones are tested.

### Round 2 phone test (16 Nov, 21:28) and investigation
| Device | Camera | Skeleton |
|---|---|---|
| Desktop Chrome | front | full skeleton visible |
| iPhone Safari | **front (should be rear)** | full skeleton visible |
| Android Chrome (Android 10) | rear | **one dot near the centre, no lines, doesn't follow the body** |

**Issue 1: iPhone opened the front camera.** The app *preferred* the rear camera and also *preferred* a portrait size. Safari weighs all preferences together and picked the front camera as the better overall match. Fix: on every device, first *require* the rear camera; if none exists (desktop), fall back to preferring it, then to any camera. Permission refusals are not retried. Tested with simulated phone/desktop/refused cameras.

**Issue 2: Android tracking. What the data shows.**
- Camera 1280×720 landscape, rear, 30 fps; preview 204×375; mapping scale 0.52, visible video x 444–836. These values are correct: the overlay is not the cause.
- The loop is running: 332 frames processed at 10 fps, no errors.
- MoveNet returned **no pose on any frame** (0 keypoints). In pose-detection 2.1.3 an empty result means the pose score was below 0.25, where the score is the mean of keypoints above 0.2 (0 if none). So on this phone the model is not finding a body in what it receives. There is nothing for the overlay to draw.
- The same symptom was present in Stage 0 (640×480), so it is not caused by the Stage 1 changes.
- Not yet known: is the model receiving a broken picture (camera-to-GPU upload on this device), or a correct picture that it can't read (GPU maths on this backend)? The same code works on iPhone and desktop.

**Diagnostic added: debug panel → "Model check".** It pauses the loop and on the current frame shows the screen frame and the model's actual input side by side (brightness, contrast, difference), the GPU name, and the model's raw scores (no cut-off) on the video and on a 2D-canvas copy, with a plain-English verdict. Repeating it with `&backend=wasm` separates a GPU problem from a picture problem. The fix will be chosen from this result.

### Android root cause (confirmed 16 Nov, 21:42)
Model check on the Android phone (Android 10, Chrome 157, **ARM Mali-G610 MC4**) with `?backend=wasm`:
- Model input matched the screen (mean 115.6 vs 116, difference 12/255): the camera picture reaches the model intact.
- Raw model output on the current frame: pose score 0.45–0.50, 13/17 keypoints ≥ 0.3. Live loop: 15/17 keypoints, skeleton follows the body.
- Same phone on WebGL (default): no pose in 332 frames.

**Cause:** MoveNet running on TensorFlow.js's WebGL (GPU) backend produces unusable output on this Mali GPU, although the GPU reports full 32-bit float support. Camera, frame upload, coordinate mapping and drawing are not at fault.

**Fix:** Mali GPUs now use the WASM (CPU) backend automatically; other GPUs keep WebGL (working on iPhone and desktop). `?backend=webgl` still forces WebGL for testing.

**Trade-offs / follow-ups:**
- Speed: ~10 fps on this phone on WASM (same as its WebGL rate). Enough for setup and preview; serve detection (Stage 6) will likely need more. Options later: feed the model a smaller copy of the frame, or enable multi-threaded WASM.
- The rule is based on one confirmed Mali device. Mali is common (many Samsung, MediaTek and Google Pixel phones), so all Mali GPUs are routed to WASM until a WebGL fix is proven. A start-up self-test on a reference image would make this automatic for any GPU; deferred.
- Legs scored lower than the upper body (knees/ankles 0.04–0.44) in this test; Stage 2's readiness check must require them before practice starts.

### Release versions and phone caching
GitHub Pages lets browsers reuse files for up to 10 minutes, so a phone can run an older copy of a module after a deploy (seen on Android, 16 Nov 21:51: the Mali fix was live but the phone ran the cached pose.js). Each release now has a version (`tools/set-version.py <version>`), stamped into every module URL through an import map, so a release loads as one consistent set. The debug panel's first line shows the running version. After a deploy, wait a few minutes and reload; check the version before testing.
