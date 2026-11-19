# Serve Coach MVP1 — Player UAT script

**Build:** v1.4.1 or later · **URL:** https://moonstudio-dev.github.io/Serve-tracker/serve-coach/
**Devices:** iPhone (Safari), Android (Chrome); desktop Chrome for replay only.
**Before you start:** phone charged above 50%, at least 1 GB free storage, tripod, a court (or a space with room for your full serve). Check the version: add `?debug=1` to the URL; the debug panel shows `app v…`.

Mark each scenario **Pass**, **Fail** or **N/A**. For any Fail, note the device, what you did, what happened, and send a screenshot or the debug JSON (`?debug=1` › Copy).

Scope reminder: MVP1 records and replays practice clips with the movement skeleton. It does not count serves, detect good or bad serves, score technique or give AI coaching.

---

### 1. First practice, Behind position
1. Home › **Start a practice**. Choose **Both**, target **10**. Start practice.
2. Camera setup: choose your hand and **Behind**. Follow steps 2–5 (tripod 3–4 m behind you, hip height, phone upright). Note the distance you actually used.
3. On Record, check **Court side** = Deuce, **Tripod position** = Behind.

**Expected:** setup only asks for the side once (in Practice setup); the Record screen shows the plan and your choices.

### 2. Record and switch sides
1. Record one Deuce clip of about 5 serves. Stop and save.
2. Switch Court side to **Ad**, record about 5 serves, save.

**Expected:** each clip appears under *This practice* with the right side; the plan line shows clips per side. Side and tripod buttons can't be changed while recording.

### 3. Move the tripod to Side
1. Move the tripod beside you. On Record, change **Tripod position** to **Side** (confirmation message appears).
2. Record a clip and save.

**Expected:** the new clip is labelled *Tripod Side*; earlier clips stay *Behind*.

### 4. Front phone camera
1. Switch **Phone camera** to **Front**. The preview is mirrored.
2. Record a short clip and save.

**Expected:** clip labelled *Front camera*; it replays unmirrored unless Mirror is on (Mirror starts on for front-camera clips).

### 5. Long clip
1. Record one clip of **at least 5 minutes** of continuous serving.

**Expected:** the screen doesn't sleep; the clip saves; Replay plays to the end with the skeleton still on your body near the end.

### 6. Interruptions
1. Start a clip, then lock the phone for 10 seconds. Unlock.
2. Start a clip, switch to another app for 10 seconds, come back.
3. (If possible) start a clip and take a phone call.

**Expected:** each time the clip is saved and marked *interrupted*, with a message on return. You can record again straight away (after a call the camera comes back within a few seconds).

### 7. Close and reopen
1. Start a clip and close the browser tab (or swipe the browser away). Reopen the URL.

**Expected:** you're offered *Continue practice*. The clip is kept as *interrupted* (the last few seconds may be missing) or marked *no video saved* if it was very short.

### 8. Replay with skeleton
1. Progress › Video recordings › open several clips (Behind, Side, Front).
2. First open shows *Aligning skeleton…* then plays. Try Normal, ½ and ¼, drag the seek bar, use ±0.1 s, turn Skeleton and Mirror on and off.

**Expected:** the skeleton stays on your body at every speed and after every seek. Reopening a clip doesn't align again. Details show serving side, tripod position, phone camera and orientation.

### 9. Many clips
1. Over one or more practices, reach **15+ clips**.

**Expected:** Progress opens quickly; the storage line updates; every clip replays.

### 10. Delete
1. Delete one clip (two taps). End a practice and delete it from Progress (two taps).

**Expected:** nothing is deleted on a single tap; deleted clips are gone after reload; other clips are untouched.

### 11. Next day
1. Without using the app, wait at least one day. Reopen it.

**Expected:** all practices and clips are still there. (iPhone: note whether you opened it in Safari or from the Home Screen.)

### 12. Desktop replay (optional)
1. On desktop Chrome, record a short clip with the webcam and replay it.

**Expected:** as scenario 8.

---

**UAT passes when** scenarios 1–10 pass on both iPhone and Android (11 and 12 recommended), with no lost clips other than the documented crash case.
