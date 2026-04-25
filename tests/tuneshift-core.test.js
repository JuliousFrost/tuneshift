const {
  PLAYBACK_RATE_PRESETS,
  clampSemitones,
  clampPlaybackRate,
  createTabState,
  formatPlaybackRate,
  formatSemitoneValue,
  stepPlaybackRate,
  mergeTabState,
  semitonesToPitchFactor,
  serializeError,
} = require("../extension/lib/tuneshift-core.js");

describe("tuneshift-core", () => {
  it("converts semitones to pitch factor", () => {
    expect(semitonesToPitchFactor(0)).toBe(1);
    expect(semitonesToPitchFactor(-1)).toBeCloseTo(0.943874, 5);
    expect(semitonesToPitchFactor(1)).toBeCloseTo(1.059463, 5);
    expect(semitonesToPitchFactor("bad")).toBe(1);
  });

  it("clamps semitone values to the supported range", () => {
    expect(clampSemitones(-99)).toBe(-12);
    expect(clampSemitones(99)).toBe(12);
    expect(clampSemitones("2.7")).toBe(3);
    expect(clampSemitones("bad")).toBe(0);
  });

  it("formats semitone values for the popup", () => {
    expect(formatSemitoneValue(0)).toBe("0");
    expect(formatSemitoneValue(3)).toBe("+3");
    expect(formatSemitoneValue(-4)).toBe("-4");
  });

  it("snaps playback-rate values to the supported preset list", () => {
    expect(PLAYBACK_RATE_PRESETS).toEqual([0.5, 0.75, 0.85, 1, 1.15, 1.25, 1.5]);
    expect(clampPlaybackRate(0.52)).toBe(0.5);
    expect(clampPlaybackRate(0.8)).toBe(0.75);
    expect(clampPlaybackRate(0.9)).toBe(0.85);
    expect(clampPlaybackRate(1.08)).toBe(1.15);
    expect(clampPlaybackRate(1.39)).toBe(1.5);
    expect(clampPlaybackRate("bad")).toBe(1);
  });

  it("formats and steps playback-rate values for the popup", () => {
    expect(formatPlaybackRate(1)).toBe("1x");
    expect(formatPlaybackRate(0.75)).toBe("0.75x");
    expect(formatPlaybackRate(1.5)).toBe("1.5x");

    expect(stepPlaybackRate(1, -1)).toBe(0.85);
    expect(stepPlaybackRate(1, 1)).toBe(1.15);
    expect(stepPlaybackRate(0.5, -1)).toBe(0.5);
    expect(stepPlaybackRate(1.5, 1)).toBe(1.5);
    expect(stepPlaybackRate("bad", 1)).toBe(1.15);
  });

  it("creates and merges tab state with derived pitch and playback data", () => {
    const initialState = createTabState({
      enabled: true,
      semitones: -2,
      playbackRate: 1.15,
    });

    expect(initialState.enabled).toBe(true);
    expect(initialState.semitones).toBe(-2);
    expect(initialState.pitchFactor).toBeCloseTo(0.890899, 5);
    expect(initialState.playbackRate).toBe(1.15);

    const mergedState = mergeTabState(initialState, {
      semitones: 5,
      playbackRate: 0.5,
      status: "Pitch shift active",
    });

    expect(mergedState.semitones).toBe(5);
    expect(mergedState.pitchFactor).toBeCloseTo(1.33484, 5);
    expect(mergedState.playbackRate).toBe(0.5);
    expect(mergedState.status).toBe("Pitch shift active");
    expect(typeof mergedState.timestamp).toBe("number");
  });

  it("serializes common error shapes", () => {
    const circular = {};
    circular.self = circular;

    expect(serializeError(null)).toBeNull();
    expect(serializeError("bad")).toBe("bad");
    expect(serializeError(new Error("broken"))).toBe("broken");
    expect(serializeError({ code: "E_FAIL" })).toBe("{\"code\":\"E_FAIL\"}");
    expect(serializeError(circular)).toBe("[object Object]");
  });
});
