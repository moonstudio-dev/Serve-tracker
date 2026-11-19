# Serve Coach MVP1 — known limitations

**Build:** v1.4.1 · Updated 19 Nov 2026

Each item says whether it is **confirmed** (seen in our own tests), **documented** (stated by the browser maker, not yet observed by us), or **potential** (a risk we haven't verified).

## Scope (by design)
- Serves are not counted or detected. Practice targets are reminders only.
- No technique scores, success/failure, AI coaching or comparisons.
- Recordings stay on the device that made them. No accounts, no cloud backup, no transfer between devices. Deleting the browser's website data deletes the recordings.
- Behind and Side footage are labelled but not analysed. Which measurements each tripod position supports has not been validated.

## Storage on iPhone
- **Confirmed:** Safari did not grant this site *persistent* storage (`navigator.storage.persist()` returned false on our iPhone test). Android Chrome did grant it. So on iPhone the recordings are in "best-effort" storage that the browser is allowed to clear.
- **Confirmed:** Safari's free-space estimate was unreliable in our tests, so the app doesn't show free space on iPhone; it shows only how much Serve Coach uses.
- **Documented (WebKit):** best-effort data can be removed when the device is short of space, when the browser's overall quota is reached, or when a site hasn't been used for some time. Least-recently-used sites go first. WebKit's 2020 policy describes deleting a site's storage after **seven days of Safari use without interaction with that site**, with Home Screen web apps counting days separately. We have **not** observed this deletion and don't know exactly how current iOS applies it.
- **Potential:** a Home Screen web app may keep its storage separately from Safari, so recordings made in Safari might not appear when the app is opened from the Home Screen (and vice versa). Not yet verified on our iPhone; UAT scenario 11 checks persistence over time.
- **What the app does:** on iPhone, Progress shows a tip explaining that recordings aren't guaranteed to be kept and that the Home Screen may lower the risk. It doesn't promise a time limit.

## Recording
- **Confirmed:** if the browser crashes or the tab is closed mid-clip, the clip is kept but the last few seconds can be lost (video is written every 2–6 seconds). A clip with no playable video is marked *no video saved*.
- **Confirmed (by design):** locking the phone, switching apps or leaving the Record screen stops and saves the clip. Recording can't continue in the background.
- **Confirmed (simulated):** if the camera is taken by something else (e.g. a call), the clip is saved as interrupted and the camera restarts. Real phone-call behaviour still to be checked in UAT.
- **Confirmed (simulated):** when storage runs out mid-clip, the clip stops and is saved; video after the point storage ran out is missing.
- No time limit per clip. Recording is refused below 200 MB free and stopped below 100 MB (where the browser reports free space; not on iPhone).
- Video is recorded at about 2 Mbit/s (about 15 MB per minute). Movement tracking runs at the phone's speed (typically 15–30 frames per second).

## Replay and skeleton
- The skeleton is the live tracking result saved during recording, not a re-analysis. Where tracking was weak during recording (poor light, body out of frame, other people in view) the replay skeleton is missing or jumps.
- Skeleton alignment is measured on a clip's first replay (10–20 seconds). If a clip has too little tracked movement, a standard per-browser alignment is used; it can be off by a fraction of a second.
- The slow-motion speeds are ½ and ¼; there is no faster-than-normal speed.

## Devices
- Tested on: iPhone (Safari), Android (Chrome, Mali GPU → WASM tracking), desktop Chrome. Other browsers (Firefox, Samsung Internet, iPhone Chrome) are untested.
- Some Android GPUs (Mali) can't run tracking on the GPU; the app automatically uses the slower WASM mode, which may lower the tracking frame rate.
