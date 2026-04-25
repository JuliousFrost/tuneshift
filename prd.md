# TuneShift — Product Requirements Document (PRD)

## 1. Overview

**Product Name:** TuneShift (working name)
**Platform:** Chrome Extension (Manifest V3)
**User:** Solo musician (guitarist)
**Primary Use Case:** Transpose YouTube audio in real-time to match instrument tuning (e.g., D standard vs D♯)

**Core Problem:**
Existing browser extensions for pitch shifting are low quality, unreliable, or introduce unacceptable artifacts and latency.

**Core Solution:**
A lightweight Chrome extension that allows semitone-based pitch shifting of YouTube audio **without changing tempo**, optimized for real-time practice.

---

## 2. Goals

### Primary Goal

Enable real-time pitch shifting of YouTube audio in semitone steps with acceptable latency and audio quality.

### Secondary Goals

* Minimal UI for fast interaction
* Reliable behavior across YouTube videos
* Foundation for future cross-browser support (Firefox)

---

## 3. Non-Goals (v1)

* Support for non-YouTube platforms
* System-wide audio processing
* Studio-grade pitch accuracy
* Fine tuning (cents-level control)
* Presets or advanced configuration

---

## 4. Success Criteria

The product is considered successful if:

1. User plays a YouTube video
2. Clicks `-1 semitone`
3. Audio output:

   * Pitch is correctly lowered
   * Tempo remains unchanged
   * No major artifacts (minor acceptable)
4. Latency is low enough for live guitar practice (~<50ms perceived)
5. Toggling OFF restores original audio instantly

---

## 5. User Experience

### UI (Popup)

Minimal interface:

* Button: `[-]` (decrease semitone)
* Display: current value (e.g., `0`, `-1`, `+1`)
* Button: `[+]` (increase semitone)
* Toggle: `ON / OFF`

### Optional (v1.1)

* Reset button
* Keyboard shortcuts

---

## 6. Core Functionality

* Detect active YouTube video
* Route audio through Web Audio API
* Apply pitch shifting using DSP
* Allow real-time semitone adjustments
* Maintain playback tempo

---

## 7. Technical Architecture

### Audio Pipeline

```
YouTube <video>
    ↓
MediaElementSource
    ↓
Pitch Shifter (DSP)
    ↓
AudioContext.destination
```

---

### Components

#### 1. Content Script

* Injected into YouTube pages
* Locates `<video>` element
* Initializes audio pipeline
* Applies pitch transformation

#### 2. Background (Service Worker)

* Maintains global state (current semitone, enabled state)
* Handles message routing

#### 3. Popup UI

* Sends commands to background/content script
* Displays current state

#### 4. Pitch Engine

* DSP layer responsible for pitch shifting
* Converts semitone values to pitch factor

---

## 8. Pitch Logic

Pitch factor calculation:

```
factor = 2^(semitones / 12)
```

Examples:

* `-1` → ~0.9439
* `+1` → ~1.0595

---

## 9. DSP Strategy

### Phase 1 (MVP)

Use existing JS library:

* SoundTouchJS

### Phase 2 (if needed)

Upgrade to:

* RubberBand (WASM)

### Notes

* Do not implement custom DSP
* Accept minor artifacts in exchange for speed and simplicity

---

## 10. Implementation Plan

### Phase 1 — Video Hook

* Inject content script
* Select `<video>` element
* Confirm access and control

### Phase 2 — Audio Routing

* Create `AudioContext`
* Use `createMediaElementSource(video)`
* Route directly to output

### Phase 3 — Pitch Integration

* Insert pitch processing node
* Apply semitone-based pitch shift

### Phase 4 — UI Integration

* Build popup interface
* Implement message passing
* Update pitch in real time

### Phase 5 — Optimization

* Reduce latency
* Optimize buffer sizes
* Avoid reinitializing audio context

---

## 11. Risks & Mitigation

### Latency

* Risk: noticeable delay during playback
* Mitigation: optimize DSP settings and buffer sizes

### Audio Artifacts

* Risk: distortion, warbling
* Mitigation: accept “good enough” quality for practice

### YouTube DOM Changes

* Risk: video element reload breaks pipeline
* Mitigation: use MutationObserver to reattach processing

---

## 12. Permissions

Minimum required:

* `activeTab`
* `scripting`
* `host_permissions`: `https://www.youtube.com/*`

---

## 13. File Structure

```
/extension
  manifest.json
  background.js
  content.js
  popup.html
  popup.js
  /pitch
    soundtouch.js
```

---

## 14. Chrome → Firefox Strategy

* Build Chrome version first
* Abstract browser APIs using polyfill if needed
* Adjust manifest differences for Firefox
* Test audio permissions and behavior

---

## 15. Key Insight

The success of this product depends almost entirely on:

> Achieving usable, low-latency pitch shifting inside the browser

If this works → product is viable
If this fails → UI and extension logic are irrelevant

---

## 16. Next Step

Start with Phase 1:

* Create Chrome extension
* Inject content script into YouTube
* Confirm access to `<video>` element

Do not proceed further until this step is verified.
