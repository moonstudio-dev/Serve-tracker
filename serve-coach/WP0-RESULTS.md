# Serve Coach MVP1 — WP0 recording spike: results and updated estimate

17 Nov 2026 · spike page `serve-coach/spike/` (v1.1.7–1.1.9) · branch `integration/serve-coach` · originals untouched.

## Verdict
**The recording approach works on all three target browsers.** Video and movement data are recorded together without slowing live tracking, saved in chunks on the device, survive a reload byte-for-byte, replay the right way up, seek accurately and support slow motion. One design change is required: **skeleton timing must be corrected per clip** (offset 0–440 ms depending on device). Recommend approving WP1 onwards with that change.

## Evidence

| Measure | iPhone Safari (iOS 18.7) | Android Chrome 157 (Mali GPU) | Desktop Chrome 138 (Mac) |
|---|---|---|---|
| Format chosen | MP4 / H.264 | MP4 / H.264 | MP4 / H.264 |
| Resolution | 720×1280 portrait (front + rear) | 720×1280 portrait (front + rear) | 1280×720 (webcam) |
| Bitrate / size | 1.86–1.88 Mbit/s ≈ **14 MB/min** | 2.34–2.35 Mbit/s ≈ **17.5 MB/min** | 1.06 Mbit/s ≈ 8 MB/min |
| 5-minute clip (MVP cap) | ≈ 70 MB | ≈ 88 MB | ≈ 40 MB |
| Tracking FPS before → while recording | 23.8 → 23.7 (front), 23.7 → 24.3 (rear) | 10.1 → 10.3 (front, full input), 11.3 → 11.7 (rear, half input) | 15.1 → 14.3 (min 8) |
| Effect of recording on tracking | **None** | **None** | Slight |
| Chunk write time (2 s chunks) | ~90 ms | ~230–245 ms | ~200 ms |
| Write errors | None | None | None |
| Survives reload | Yes, byte-identical + all keypoints | Yes | Yes |
| Duration reported on replay | Correct | Correct | Correct (+0.18 s) |
| Seek test (4 jumps) | 4/4 exact, 37–189 ms | 4/4 exact, ~400 ms | 4/4 exact, 47–129 ms |
| Orientation on replay | Correct, front + rear (no iOS front-camera bug) | Correct, front + rear | Correct |
| Slow motion (0.5×, 0.25×) | Works | Works | Works |
| Screen wake lock | Granted | Granted | Granted |
| Persistent storage | **Not granted** (7-day eviction rule applies) | **Granted** | Not granted (low risk on desktop) |
| **Skeleton sync offset** | **≈ 0 ms** (front +20, rear 0) | **−300 ms** (rear) / **−400 ms** (front) | **−440 ms** |
| Sync error before → after correction | 1.7% → 1.6% of frame | 5.1% → 1.4%; 8.6% → 1.5% | 6.2% → 1.4% |

Sync method: re-run MoveNet on replayed frames and find the time shift (±1.5 s) at which saved and re-detected keypoints agree best. Verified in testing by recovering a known 700 ms shift exactly.

## Findings and design decisions

1. **MP4/H.264 everywhere.** Supported for recording on all three; WebM not needed. Store the actual MIME per clip.
2. **Recording does not disrupt tracking.** Same camera stream feeds preview, MoveNet and MediaRecorder.
3. **Half-size model input on Android:** ~11.5 fps vs ~10.2 fps at full size (~13% faster, different clips). Modest gain; recommend using it only where tracking runs on the CPU (Mali/WASM), full size elsewhere. Accuracy at half size looked equivalent in replay (sync error 1.4%) but is not formally validated.
4. **Per-clip sync correction (new requirement).** The offset varies by device and even between clips on one device (Android −300 / −400 ms). Measure it per clip using the spike's method, save `syncOffsetMs` with the clip, apply automatically in replay. Fallback when a clip has too little movement: browser default (Safari 0, Android Chrome −350, desktop Chrome −440 ms). Cost: ~3–6 s of computation per clip (longest on Android).
5. **Storage:** Android grants persistent storage; iPhone does not, so the 7-day eviction risk stands; Home Screen install remains the mitigation. Safari's storage estimate is unreliable (reported 0.3 MB after 4 MB saved) — compute library size from our own metadata.
6. **Mirroring:** live front-camera preview mirrored (selfie view); recordings are stored unmirrored; replay shows the true picture with an optional Mirror toggle. Spike issue to fix in WP7: mirroring must apply to video + skeleton only, not the player controls.
7. **Camera switching:** rapid Rear/Front taps on desktop produced cancelled starts and a momentary 2×2 frame. WP5 must debounce switching and wait for real frame dimensions before tracking.
8. **Wake lock** works on all three; keep it for the duration of each recording.

## Updated estimate (remaining work)

| WP | Work | Effort | Change vs. original |
|---|---|---|---|
| WP0 | Spike | done (~1 d incl. fixes) | — |
| WP1 | IndexedDB storage layer (sessions → clips → chunks, poses; UUIDs, schemaVersion, deletedAt, storage interface) | 1 d | same |
| WP2 | Practice-session lifecycle with **multiple clips per session**, Start/Stop clip, End session, interruptions | 1–1.5 d | same (multi-clip folded in) |
| WP3 | Recorder (productionise spike code) | 0.5–0.75 d | −0.25 d |
| WP4 | Timestamped keypoints + half-size input on CPU backend | 0.5 d | same |
| WP5 | Front/rear switching (debounced), mirroring, metadata | 0.5 d | −0.25 d |
| WP6 | Video Recordings library grouped by session, delete with confirmation, storage used | 1 d | same |
| WP7 | Replay + synced skeleton + **per-clip sync calibration** + mirror fix | 1.5–2 d | +0.5 d |
| WP8 | Basic session summary + metadata | 0.5 d | same |
| WP9 | Minimal tracking reliability indicator | 0.5 d | same |
| WP10 | Cross-device testing and fixes | 1.5 d | same |
| **Total remaining** | | **≈ 8.5–10 d** | total incl. WP0 ≈ 9.5–11 d (unchanged range) |

## Proposed sequence to UAT (23–25 Nov)

| When | Build | Gate |
|---|---|---|
| Wed 18 | WP1 storage, WP3 recorder, WP4 poses | — |
| Thu 19 | WP2 sessions (multi-clip), WP5 camera switch | **G1 (Thu eve):** record 3 clips in one session (rear, front, rear), end session, reload — all present with metadata; camera locked while recording |
| Fri 20 | WP7 replay + sync calibration, WP6 library | **G2 (Fri eve / Sat am):** library by session; replay each clip with aligned skeleton; delete with confirmation |
| Sat 21 | WP8 summary, WP9 indicator, polish | **G3 (Sat/Sun):** full UAT script on iPhone, Android, desktop |
| Sun 22 | Fixes; freeze UAT build v1.2.0; debug hidden | Smoke test |
| Mon 23 – Wed 25 | UAT | |

Tight but achievable. If time runs short, protect the journey by dropping in this order: WP9 indicator → session summary detail (keep duration/clip count) → half-size input.

## Decisions needed from the Product Manager
1. **Approve WP1 onwards** with per-clip sync correction added to WP7.
2. **Sync correction timing:** run once when a clip is first replayed ("Aligning skeleton…", ~3–6 s, then saved) — recommended — or immediately after Stop (adds a wait before the next clip).
3. **Half-size tracking input** only on CPU-tracked phones (Android Mali) — recommended.
4. **Mirroring:** live front preview mirrored; replay shows the true picture with a Mirror toggle — recommended.
5. **iPhone storage:** add an "Add to Home Screen" tip for testers to protect recordings — recommended.
6. **Clip cap:** 5 minutes ≈ 70–90 MB per clip on phones; warn when free space < 300 MB — confirm.
