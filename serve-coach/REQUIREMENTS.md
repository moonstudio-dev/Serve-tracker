# Serve Coach — MVP1 product requirements

Living summary of the agreed MVP1 scope as implemented on `integration/serve-coach`. Last updated: 19 Nov 2026 (v1.5.0, five-step journey Phase A).

## Journey (five steps, approved 19 Nov 2026)
1 Start (Home) → 2 Practice → 3 Camera setup → 4 Readiness → 5 Record. Progress › Video recordings and Replay are destinations afterwards, not steps. A step bar shows done / current / upcoming. Desktop Chrome, iPhone Safari, Android Chrome.
- Handedness: asked once at first practice (not a numbered step), saved locally, editable from Home, copied onto each session (`playerHand`). Never mirrors movement data.
- Camera setup every practice: previous tripod position and phone camera are shown as a suggestion; the player must confirm ("Yes, same setup") or change them. Stored on the session (`cameraSetup`).
- Readiness: hybrid. Only camera access / camera picture / storage safeguards block recording. Tracking unavailable, poor framing or unreliable tracking allow recording with a warning; clips are labelled Complete tracking / Partial tracking / Tracking unavailable (Phase B). Readiness runs automatically; the arm check is "either arm above the head", prompted by a practice serve motion, and is a warning only (Phase B).

## Three separate settings (never combined)
| Setting | Values | Where it is chosen | Saved |
|---|---|---|---|
| Serving side | Both / Deuce / Ad (plan); Deuce or Ad per clip | Practice setup; switchable on Record between clips | session `plan.sides`; clip `side` |
| Tripod position (physical place on court) | Behind / Side | Camera setup (step 3, with illustrations; previous value must be confirmed); editable on Record between clips | session `cameraSetup`; clip `tripodPosition` |
| Phone camera | Rear / Front | Camera setup (step 3); editable on Record between clips | session `cameraSetup`; clip `camera.facing`, `camera.label` |

- **Behind:** tripod behind the player near the baseline, camera facing the net.
- **Side:** tripod beside the player, side-on view.
- Tripod position is never assumed: each practice the player confirms last time's value or chooses again. Changing it on Record applies to the next clip and is confirmed on screen; it is locked while a clip records.
- Clips recorded before v1.4.0 are marked `tripodPosition: 'unknown'` (shown as *Unknown*), never guessed.

## Practice setup
Sides Both / Deuce only / Ad only. Optional target 1–10 serves per selected side (Both = target on each side). Targets are guidance only: recording never stops at a target and serves are not counted in MVP1.

## Recording
- Multiple clips per practice; each clip has one serving side, one tripod position and one phone camera.
- Video + timestamped MoveNet keypoints saved in IndexedDB as recording happens. No time limit; storage safety only (refuse start < 200 MB free, warn < 500 MB, stop and save < 100 MB or on a storage-full error).
- Front camera preview mirrored; recordings stored unmirrored.
- Interruptions (screen lock, app switch, leaving Record, crash) keep what was saved and mark the clip *interrupted*.

## Per-clip data
Serving side; tripod position; phone camera (facing, label); video {mime, width, height, **orientation** (portrait/landscape), bytes, chunks, duration}; movement {frames, fps, model, backend, input mode} with frames `{t, kp}` (17 × normalised x, y, score); status; stop reason; skeleton sync {offsetMs, method}. Cloud-ready fields: UUIDs, schemaVersion (2 from v1.4.0), ownerId, syncState, deletedAt, uploadConsent.

## Replay
Synchronised skeleton (per-video-frame drawing, per-clip measured offset), Normal / ½ / ¼ slow motion, seek, ±0.1 s steps, skeleton toggle, mirror toggle (picture only), clip details including serving side, tripod position, phone camera and orientation. Manual delete of clips and practices (two taps).

## Future AI analysis (not in MVP1)
- The analysis pipeline must read `tripodPosition` for every clip and treat Behind, Side and Unknown footage separately. The same movement looks different from different angles.
- Which movements and measurements are reliable from each position is **not yet validated**. No screen or document should claim that either position supports a given technique measurement until the next analysis phase tests it.
- Footage from different tripod positions must not be compared as if directly equivalent (e.g. progress comparisons should only compare like with like). Unknown-position clips should be excluded from position-specific analysis unless the player labels them.

## Out of scope for MVP1
Serve detection/counting, segmentation, success/failure, biomechanics scores, AI coaching and comparisons, accounts, cloud storage, subscriptions.
