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
| Camera opens the default (usually front) camera at 640×480; stream not stopped; alert on error | Stage 1 |
| Keypoint dots misaligned in the portrait preview (known cause: canvas stretched vs video cropped) | Stage 1 |
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
