const {
  clampSemitones,
  createTabState,
  formatSemitoneValue,
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

  it("creates and merges tab state with derived pitch data", () => {
    const initialState = createTabState({
      enabled: true,
      semitones: -2,
    });

    expect(initialState.enabled).toBe(true);
    expect(initialState.semitones).toBe(-2);
    expect(initialState.pitchFactor).toBeCloseTo(0.890899, 5);

    const mergedState = mergeTabState(initialState, {
      semitones: 5,
      status: "Pitch shift active",
    });

    expect(mergedState.semitones).toBe(5);
    expect(mergedState.pitchFactor).toBeCloseTo(1.33484, 5);
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
