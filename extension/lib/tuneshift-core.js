(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.TuneShiftCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MIN_SEMITONES = -12;
  const MAX_SEMITONES = 12;
  const DEFAULT_SEMITONES = 0;
  const DEFAULT_PROCESSOR_BUFFER_SIZE = 1024;
  const DEFAULT_CAPTURE_BUFFER_SIZE = 1024;
  const DEFAULT_QUEUE_MULTIPLIER = 12;

  const MESSAGE_TYPES = {
    APPLY_AUDIO_STATE: "APPLY_AUDIO_STATE",
    CONTENT_READY: "CONTENT_READY",
    ENGINE_STATUS: "ENGINE_STATUS",
    GET_TAB_STATE: "GET_TAB_STATE",
    PING_TAB: "PING_TAB",
    SET_ENABLED: "SET_ENABLED",
    SET_SEMITONES: "SET_SEMITONES",
  };

  function clampSemitones(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return DEFAULT_SEMITONES;
    }

    return Math.min(MAX_SEMITONES, Math.max(MIN_SEMITONES, Math.round(numericValue)));
  }

  function semitonesToPitchFactor(semitones) {
    const numericValue = Number(semitones);
    if (!Number.isFinite(numericValue)) {
      return 1;
    }

    return Math.pow(2, numericValue / 12);
  }

  function formatSemitoneValue(semitones) {
    const value = clampSemitones(semitones);
    if (value > 0) {
      return `+${value}`;
    }

    return String(value);
  }

  function serializeError(error) {
    if (!error) {
      return null;
    }

    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    try {
      return JSON.stringify(error);
    } catch (_error) {
      return String(error);
    }
  }

  function createTabState(overrides) {
    const nextState = {
      enabled: false,
      semitones: DEFAULT_SEMITONES,
      pitchFactor: 1,
      videoDetected: false,
      pipelineState: "idle",
      status: "Ready",
      pageUrl: null,
      videoSrc: null,
      readyState: null,
      bufferedFrames: 0,
      lastError: null,
      timestamp: Date.now(),
      ...(overrides || {}),
    };

    nextState.semitones = clampSemitones(nextState.semitones);
    nextState.pitchFactor = semitonesToPitchFactor(nextState.semitones);
    nextState.lastError = serializeError(nextState.lastError);
    nextState.timestamp = typeof nextState.timestamp === "number" ? nextState.timestamp : Date.now();
    return nextState;
  }

  function mergeTabState(currentState, partialState) {
    return createTabState({
      ...(currentState || {}),
      ...(partialState || {}),
      timestamp: Date.now(),
    });
  }

  return {
    DEFAULT_CAPTURE_BUFFER_SIZE,
    DEFAULT_PROCESSOR_BUFFER_SIZE,
    DEFAULT_QUEUE_MULTIPLIER,
    DEFAULT_SEMITONES,
    MAX_SEMITONES,
    MESSAGE_TYPES,
    MIN_SEMITONES,
    clampSemitones,
    createTabState,
    formatSemitoneValue,
    mergeTabState,
    semitonesToPitchFactor,
    serializeError,
  };
});
