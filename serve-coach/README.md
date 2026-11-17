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

### Stage 1 phone results (16 Nov, v1.1.2–1.1.3)
| Device | Camera | Backend | FPS | Keypoints ≥ 0.3 | Result |
|---|---|---|---|---|---|
| Desktop Chrome | front | WebGL | – | full skeleton | Passed (PM test) |
| iPhone Safari (iOS 18.7) | rear, "Back Dual Wide Camera" (required, first attempt) | WebGL, Apple GPU | 19 | 14/17 | Passed (v1.1.2) |
| Android Chrome 157 (Android 10, Mali-G610) | rear, "camera 0, facing back" | WASM (chosen automatically: Mali) | 8 | 14/17 | Passed (v1.1.3) |

Notes from the data:
- Both phones deliver a landscape 1280×720 frame even when asked for portrait; the preview shows the middle ~31 % (video x 444–836). Players must stand in that narrow strip; Stage 2's readiness check should use the visible area, not the whole frame.
- Legs were weak on both phones (ankles 0.04–0.23) and in the Android test the hips were at the bottom edge of the frame (y≈705–716 of 720), so the legs were likely out of shot. Full-body tracking at the intended 3–5 m distance is still to be confirmed.
- Android runs at 8–10 fps on WASM: fine for setup; likely too slow for serve detection (Stage 6).

| Stage 1 acceptance | Status |
|---|---|
| Desktop Chrome: front camera + full skeleton | Passed |
| iPhone Safari: rear camera + full skeleton | Passed |
| Android Chrome: rear camera + skeleton follows the body | Passed |
| Dots and lines aligned around the frame | Passed (phones, upper body; automated mapping test incl. edges) |
| Full body tracked at 3–5 m, feet in frame | Not yet confirmed on phones |
| Camera stops when leaving the camera screen | Passed (automated); not yet confirmed on phones |

### Full-body test (16 Nov, 22:13) and field-of-view finding
- Every body part is tracked when it is in the picture: Android legs scored well (knees 0.55–0.75, ankles 0.55–0.62); iPhone tracked raised arms above the head (elbows/wrists 0.27–0.58).
- But neither phone had the whole body in frame: Android cut off the head (nose y = −40), iPhone cut off the feet (knees at the bottom edge).
- Measured from the body (hip-to-ankle ≈ 445 px of 720), the frame covers only ≈ 1.5 m of height on both phones. A main camera held upright at 3–5 m should cover well over 3 m. Hypothesis: with the current size request, both browsers deliver an upright 1280×720 strip cropped out of the tall camera view, and the preview then shows only its middle third.
- To test this rather than guess: debug panel → **Camera test** opens the rear camera with four requests (A current portrait size, B landscape size, C no size, D no size + no crop) and records size and a whole-frame thumbnail for each. The request that keeps the full field of view becomes the default. v1.1.4.

### Camera field of view: cause confirmed and fixed (16 Nov, 22:20–22:24, v1.1.5)
Camera test, same wall, phone still, on both phones:
| Request | iPhone Safari | Android Chrome | View |
|---|---|---|---|
| A: 720×1280 (portrait numbers, used until v1.1.4) | 1280×720 | 1280×720, `crop-and-scale` | zoomed strip, ~1/3 of the height |
| B: 1280×720 (landscape numbers) | 720×1280 | 720×1280, `resizeMode: none` | full height, matches the 9:16 preview |
| C: no size | 480×640 | 480×640 | full height, slightly wider, low resolution |
| D: no size, no crop | 480×640 | 480×640 | same as C |

**Cause:** both browsers read width/height in the camera sensor's (landscape) orientation and then rotate the picture to the phone. Asking for 720×1280 therefore produced a 1280×720 strip cut out of the middle of the view. That is why the body never fitted (≈ 1.5 m of height visible).

**Fix (v1.1.5):** always request 1280×720 in sensor orientation; an upright phone receives a full-view 720×1280 portrait frame that fills the preview with no cropping. Safety net: if an upright phone still receives a landscape frame, the camera is released and reopened with no size request (C). Tested on simulated devices (rotating, always-landscape, desktop) and with the alignment and lifecycle tests.

### iPhone full-body test and safety-net fix (17 Nov, v1.1.6)
- iPhone, v1.1.5, full body at distance: **17/17 keypoints ≥ 0.3 incl. both ankles (0.46–0.53), 30 fps** — full-body tracking passes on iPhone.
- But it ran at 480×640 instead of 720×1280: the safety net checked `track.getSettings()` immediately after opening. iPhone Safari reports the sensor's 1280×720 at that moment and only rotates to 720×1280 once the picture plays, so the safety net wrongly fell back to the no-size request.
- Fix (v1.1.6): the safety net now judges the shape of the playing picture after a 0.6 s settle. Simulated devices: iPhone-like → 720×1280, no fallback; always-landscape phone → fallback; desktop → 1280×720.

### iPhone, v1.1.6 (17 Nov, 16:36): passed
720×1280 portrait from the first request (no fallback), rear "Back Dual Wide Camera", WebGL, **17/17 keypoints ≥ 0.3** (ankles 0.41 / 0.69, knees 0.58 / 0.73), skeleton aligned head to ankles (screenshot). 17–25 fps at 720×1280 vs ~30 fps at 480×640: sharper picture costs some speed; fine for setup, to be reviewed for serve detection.

## Stage 1: complete (17 Nov 2026, v1.1.6)
| Criterion | Desktop Chrome | iPhone Safari (iOS 18.7) | Android Chrome 157 (Mali-G610) |
|---|---|---|---|
| Camera | front, passed | rear, passed | rear, passed |
| Portrait 720×1280 full-view picture | n/a | passed | passed |
| Full skeleton follows the body, aligned | passed | passed (17/17 keypoints, ankles 0.41/0.69) | passed (PM visual check, full skeleton) |
| Camera stops on leaving step 4, single stream on return | passed (automated) | passed (event log) | passed (event log) |
| Tracking speed | – | 17–25 fps (WebGL) | ~10 fps (WASM) |

Carried into later stages: Android tracking speed (~10 fps) for serve detection (Stage 6); Safari asks for camera permission after every page reload unless allowed in Website Settings (setup copy, Stage 2); the debug panel stays available behind `?debug=1`.

## MVP1 — WP0 recording spike (v1.1.7)
Test page: `serve-coach/spike/` (not part of the player journey; own IndexedDB database `serve-coach-spike`).
- Records video (MediaRecorder, MP4/H.264 preferred, ~2 Mbit/s, 2 s chunks) while MoveNet tracks the same camera stream; up to 60 s, or Stop.
- Saves chunks and timestamped keypoints (ms since recording start; x/y normalised to the frame; raw scores) to IndexedDB as it records, plus clip metadata and measurements.
- Lists saved clips after reload; replays with the skeleton synchronised by `requestVideoFrameCallback`; skeleton toggle; 1× / 0.5× / 0.25×; mirror toggle; delete with confirmation.
- Measurements: format support, actual MIME, resolution, size/bitrate, duration and seek test, FPS before/while recording, chunk write time, persistent storage, wake lock, orientation after replay, and a sync-offset estimate (re-detects replay frames and matches saved keypoints across ±400 ms).
- Options: rear/front camera (front preview mirrored; recording and replay unmirrored by default), full or half-size model input (Android performance experiment).
- `camera.js` gained an optional `facing` parameter (default rear; app behaviour unchanged).

Headless Chrome 153 (synthetic moving marker, stand-in tracker): MP4 avc1 chosen; 13 s clip saved in 4 chunks + 782 pose frames; survived reload byte-for-byte; duration reported correctly (13.07 s); 4/4 seeks landed exactly in 4–25 ms; sync offset 0 to −20 ms; delete OK. Phone results pending.

## MVP1 Stage A — recording on the Record screen (v1.1.10)

**What it does:** live camera + skeleton on Record → Start recording → Stop and save clip → change court side (Deuce/Ad) or camera (Rear/Front) → next clip → End practice. Clips belong to the open practice session. A reload offers *Continue practice* / *Start new practice*. Each clip's video plays back on the Record screen (plain playback; replay with skeleton is Stage B). Two-tap delete.

**Modules**
- `store.js` — IndexedDB `serve-coach` v1: `sessions`, `clips` (index `sessionId`, `status`), `chunks` [clipId, seq], `poses` [clipId, seq]. UUIDs, `schemaVersion`, `ownerId`, `syncState`, `deletedAt`, `uploadConsent`. Functions only; UI never touches IndexedDB directly.
- `recorder.js` — `ClipRecorder`: MP4/H.264 preferred, WebM fallback, 2 Mbit/s, 2 s chunks, Screen Wake Lock.
- `session.js` — `PracticeSession`: session create/continue/end, clip start/stop, chunk and pose persistence as they arrive, storage checks, interruption handling.
- `preview.js` — reusable camera + skeleton preview (setup step 4 and Record); front camera preview mirrored.
- `record.js` — Record screen.
- `pose.js` — callback now also receives the frame grab time (pose timestamps).

**Clip metadata:** side, camera {facing, label}, video {mime, width, height, bitrate, bytes, chunks, durationMs}, poses {frames, fps, format, model, backend, inputMode: full}, status (saved / interrupted / interrupted-empty), stopReason, sync {offsetMs: null — filled in Stage B}.
**Movement data:** per frame `t` = ms since clip start; `kp` = 17 × [x/width, y/height, score] (MoveNet order) or `null`.

**Rules**
- No time limit on clips. Storage safety only: refuse to start below 200 MB free (warn below 500 MB); stop and save a running clip below 100 MB or on a storage-full error.
- Camera and side locked while recording; camera switching is debounced.
- Leaving the Record screen saves the running clip. Phone locked / app switched: clip stopped and saved, marked *interrupted*, message on return. Crash or closed tab: on next launch the clip is kept and marked *interrupted*; Chrome writes MP4 data every few seconds, so the last few seconds can be lost; a clip with no playable video is marked *interrupted · no video saved*.
- Persistent storage requested on first recording (granted on Android, usually not on iPhone).

**Tested (headless Chrome, synthetic camera):** multiple clips with different sides/cameras in one session; controls locked while recording; reload → continue; background interruption; leave screen mid-clip; crash mid-clip → recovered; playback; two-tap delete; end practice; stored records checked (metadata, chunks, 865 pose frames). Setup, camera-selection and navigation regressions pass. Phones: pending.

## MVP1 Stage B — Video recordings library and replay (v1.2.0)

**Progress › Video recordings** (`library.js`): practices newest first (date, clips, Deuce/Ad count, total length, size, *In progress* tag), each clip opens Replay. Finished practices can be deleted with two taps. Storage line (our own total; free space hidden on iPhone, where the browser figure is unreliable) and an iPhone *Add to Home Screen* tip when storage isn't persistent. Example coaching content stays below, labelled as examples.

**Replay** (`replay.js`, route `#replay`): opened from the library or from a clip on the Record screen (back link returns to where it was opened). Play/pause, seek bar, ±0.1 s steps, 1× / ½× / ¼×, Skeleton on/off, Mirror (flips video + skeleton only; defaults on for front-camera clips), clip details, two-tap delete.

**Skeleton sync:** drawn per video frame with `requestVideoFrameCallback` (rAF fallback) using the frame's media time + the clip's offset. First replay of a clip measures its offset (10 sampled frames re-run through MoveNet via `pose.estimateFrame`, matched to saved keypoints across ±1500 ms in 20 ms steps) and saves it as `clip.sync` {offsetMs, method: measured|default, samples, errors, measuredAt}. If the clip has too little tracked movement or the result is at the search edge, a per-browser default is used and saved (iPhone 0, Android Chrome −350 ms, desktop Chrome −440 ms, from WP0). If body tracking can't load, the default is used but not saved, so it is measured next time.

**Tested (headless Chrome, synthetic camera + test detector):** replay opens from Record and library, alignment measured and saved, not re-measured on reopen, skeleton drawn while playing and after seeking, speed, frame steps, skeleton toggle, mirror flips picture not controls, front-camera clip opens mirrored, reload on Replay returns to Progress, delete clip, delete practice, empty state. Stage A recording test still passes. Phones: pending.

## MVP1 Stage C — Practice setup (v1.3.0)

**Journey:** Home › *Start a practice* › **Practice setup** (`#practice`, `practice.js`) › Camera setup (only if no spot is saved) › Record. The Record tab also opens Practice setup when no practice is open.

- Sides: Both / Deuce only / Ad only. Optional target 1–10 serves per selected side (Both = target on Deuce + target on Ad). Stored on the session: `plan = { sides, targetPerSide, targets: { deuce, ad } }`.
- Targets are guidance only: nothing stops at the target and serves aren't counted (no serve detection in MVP1). The Record screen shows the plan and clips recorded per side; a side outside the plan still records and is shown.
- Camera setup no longer asks for the court side when a plan sets it (shows the starting side instead). Record starts on the plan's first side; switching sides between clips stays available.
- Starting a new plan ends any unfinished practice (its clips stay saved); Practice setup offers *Continue that practice* first.
- Plan shown in Progress › Video recordings and in Home › Recent practice.

**Tested (headless Chrome):** plan choices and limits (1–10), no-target option, no spot → camera setup without side question, Record starts on planned side, plan line updates per side, new plan replaces unfinished practice, Record tab redirects to Practice setup after ending a practice, Home and library show the plan. Stage A and B tests pass.

## MVP1 update — tripod position (v1.4.0)

Product requirements: see `REQUIREMENTS.md`.

- **Camera setup step 1** asks *Where will your tripod stand?* with a small court illustration for each option: **Behind** (behind the player near the baseline, facing the net) and **Side** (beside the player, side-on). No default; Next is disabled until one is chosen. Step 2 (diagram, distance, tips), step 3 distance label and step 5 summary follow the choice. Saved in prefs `sc-cfg.position` and with the spot.
- **Record** has a *Tripod position* control (Behind / Side) next to *Court side*, and the phone camera control is now labelled *Phone camera*. Editable between clips (on-screen confirmation), locked while recording. Recording won't start until a position is chosen.
- **Per clip:** `tripodPosition` ('behind' | 'side' | 'unknown') and `video.orientation` ('portrait' | 'landscape'); clip `schemaVersion` 2. On start-up `markUnknownTripodPositions()` sets older clips to 'unknown' (and fills orientation from their saved size).
- **Shown in** the Record clip list, Progress (per clip and per practice, e.g. *Tripod: Behind 2, Side 1*), and Replay details (serving side, tripod position, phone camera, orientation).
- `labels.js` holds the display names for the three separate settings.
- Setup copy no longer claims what can be measured from an angle.

**Tested (headless Chrome):** step 1 choice and illustrations, step 2 Behind and Side variants, summary, Record pre-selects the setup position, recording refused without a position, position locked while recording, change between clips saved on the next clip, old clips migrated to Unknown, library and replay labels, synced replay unaffected. Stage A, B and C tests pass.
