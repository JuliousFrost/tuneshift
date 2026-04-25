const { TuneShiftAudioEngine } = require("../extension/lib/tuneshift-audio-engine.js");

function createEventTarget() {
  const listeners = new Map();

  return {
    addEventListener(name, handler) {
      if (!listeners.has(name)) {
        listeners.set(name, new Set());
      }

      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    dispatch(name) {
      listeners.get(name)?.forEach((handler) => handler());
    },
  };
}

function createAudioNode(name) {
  return {
    name,
    connections: [],
    disconnectCalled: false,
    connect(target) {
      this.connections.push(target);
    },
    disconnect() {
      this.disconnectCalled = true;
    },
  };
}

function createFakeAudioContext() {
  const destination = { name: "destination" };

  return {
    destination,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createMediaElementSource: vi.fn(() => createAudioNode("media-element-source")),
    createGain: vi.fn(() => {
      const node = createAudioNode("gain");
      node.gain = { value: 1 };
      return node;
    }),
    createDynamicsCompressor: vi.fn(() => {
      const node = createAudioNode("compressor");
      node.threshold = { value: 0 };
      node.knee = { value: 0 };
      node.ratio = { value: 0 };
      node.attack = { value: 0 };
      node.release = { value: 0 };
      return node;
    }),
  };
}

function createFakeVideo(overrides = {}) {
  const target = createEventTarget();

  return {
    ...target,
    currentSrc: "https://www.youtube.com/watch?v=test",
    src: "https://www.youtube.com/watch?v=test",
    readyState: 4,
    paused: false,
    playbackRate: 1,
    volume: 0.65,
    preservesPitch: true,
    play: vi.fn(async () => {}),
    ...overrides,
  };
}

function createFakeSoundTouchModule() {
  const instances = [];

  class FakeSoundTouchNode {
    static register = vi.fn(async () => {});

    constructor(context) {
      this.context = context;
      this.connections = [];
      this.disconnectCalled = false;
      this.parameters = new Map(
        ["pitch", "tempo", "rate", "pitchSemitones", "playbackRate"].map((name) => [name, { value: 0 }])
      );
      instances.push(this);
    }

    connect(target) {
      this.connections.push(target);
    }

    disconnect() {
      this.disconnectCalled = true;
    }
  }

  return {
    instances,
    module: {
      SoundTouchNode: FakeSoundTouchNode,
    },
  };
}

describe("TuneShiftAudioEngine", () => {
  it("enables the worklet pipeline and switches to bypass mode on disable", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
      outputTrim: 0.9,
    });
    const video = createFakeVideo();

    await engine.attachVideo(video);
    await engine.setSemitones(-3);
    await engine.setEnabled(true);

    expect(fakeModule.module.SoundTouchNode.register).toHaveBeenCalledWith(fakeContext, "/soundtouch-processor.js");
    expect(fakeContext.resume).toHaveBeenCalledTimes(1);
    expect(engine.getState().pipelineState).toBe("active");
    expect(engine.getState().pitchFactor).toBeCloseTo(0.840896, 5);
    expect(engine.getState().playbackRate).toBe(1);
    expect(engine.processorNode.parameters.get("pitchSemitones").value).toBe(-3);
    expect(engine.processorNode.parameters.get("pitch").value).toBe(1);
    expect(engine.processorNode.parameters.get("tempo").value).toBe(1);
    expect(engine.processorNode.parameters.get("rate").value).toBe(1);
    expect(engine.processorNode.parameters.get("playbackRate").value).toBe(1);
    expect(video.playbackRate).toBe(1);
    expect(engine.processorCompressorNode.threshold.value).toBe(-10);
    expect(engine.bypassGainNode.gain.value).toBe(0);
    expect(engine.outputGainNode.gain.value).toBe(0.9);
    expect(video.preservesPitch).toBe(false);

    await engine.setEnabled(false);

    expect(fakeContext.close).toHaveBeenCalledTimes(0);
    expect(engine.getState().enabled).toBe(false);
    expect(engine.getState().pipelineState).toBe("ready");
    expect(engine.bypassGainNode.gain.value).toBe(1);
    expect(engine.outputGainNode.gain.value).toBe(0);
    expect(video.playbackRate).toBe(1);
  });

  it("applies playback-rate changes only while TuneShift is active", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
    });
    const video = createFakeVideo();

    await engine.attachVideo(video);
    await engine.setPlaybackRate(1.25);

    expect(engine.getState().playbackRate).toBe(1.25);
    expect(video.playbackRate).toBe(1);

    await engine.setEnabled(true);

    expect(video.playbackRate).toBe(1.25);
    expect(engine.processorNode.parameters.get("playbackRate").value).toBe(1.25);
    expect(engine.getState().status).toContain("1.25x");

    await engine.setPlaybackRate(0.75);

    expect(video.playbackRate).toBe(0.75);
    expect(engine.processorNode.parameters.get("playbackRate").value).toBe(0.75);
    expect(engine.getState().playbackRate).toBe(0.75);

    await engine.setEnabled(false);

    expect(video.playbackRate).toBe(1);
    expect(engine.getState().pipelineState).toBe("ready");
  });

  it("waits for a video and starts once one is attached", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
    });

    await engine.setEnabled(true);
    expect(engine.getState().pipelineState).toBe("waiting");

    const video = createFakeVideo();
    await engine.attachVideo(video);

    expect(engine.getState().pipelineState).toBe("active");
    expect(engine.bypassGainNode.gain.value).toBe(0);
    expect(engine.outputGainNode.gain.value).toBe(0.88);
  });

  it("surfaces startup errors when the loader or processor url is missing", async () => {
    const fakeContext = createFakeAudioContext();
    const noLoaderEngine = new TuneShiftAudioEngine({
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
    });
    await noLoaderEngine.attachVideo(createFakeVideo());
    await noLoaderEngine.setEnabled(true);
    expect(noLoaderEngine.getState().pipelineState).toBe("error");
    expect(noLoaderEngine.getState().lastError).toContain("SoundTouch module loader is required");

    const fakeModule = createFakeSoundTouchModule();
    const noProcessorEngine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
    });
    await noProcessorEngine.attachVideo(createFakeVideo());
    await noProcessorEngine.setEnabled(true);
    expect(noProcessorEngine.getState().pipelineState).toBe("error");
    expect(noProcessorEngine.getState().lastError).toContain("SoundTouch processor URL is required");
  });

  it("updates media metadata and disposes cleanly", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const onStateChange = vi.fn();
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
      onStateChange,
    });
    const video = createFakeVideo();

    await engine.attachVideo(video);
    await engine.setEnabled(true);

    video.readyState = 3;
    video.currentSrc = "https://www.youtube.com/watch?v=next";
    video.dispatch("loadedmetadata");

    expect(engine.getState().readyState).toBe(3);
    expect(engine.getState().videoSrc).toBe("https://www.youtube.com/watch?v=next");

    await engine.dispose();

    expect(fakeContext.close).toHaveBeenCalledTimes(1);
    expect(engine.getState().pipelineState).toBe("idle");
    expect(engine.getState().videoDetected).toBe(false);
    expect(video.preservesPitch).toBe(true);

    engine.reportState({
      status: "Idle again",
      pipelineState: "idle",
    });
    const callsBefore = onStateChange.mock.calls.length;
    engine.reportState({
      status: "Idle again",
      pipelineState: "idle",
    });
    expect(onStateChange.mock.calls.length).toBe(callsBefore);
  });

  it("handles safe disconnects, play events, and same-video reattachment", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
    });
    const video = createFakeVideo();

    await engine.attachVideo(video);
    const stateAfterFirstAttach = engine.getState().timestamp;
    await engine.attachVideo(video);

    expect(engine.getState().timestamp).toBeGreaterThanOrEqual(stateAfterFirstAttach);

    await engine.setEnabled(true);
    video.dispatch("play");
    expect(fakeContext.resume).toHaveBeenCalledTimes(2);

    expect(() =>
      engine.safeDisconnect({
        disconnect() {
          throw new Error("already disconnected");
        },
      })
    ).not.toThrow();
  });

  it("fully tears down the current graph when a new video element is attached", async () => {
    const firstContext = createFakeAudioContext();
    const secondContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const createAudioContext = vi
      .fn()
      .mockImplementationOnce(() => firstContext)
      .mockImplementationOnce(() => secondContext);

    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext,
      processorUrl: "/soundtouch-processor.js",
    });
    const firstVideo = createFakeVideo();
    const secondVideo = createFakeVideo({ currentSrc: "https://www.youtube.com/watch?v=second" });

    await engine.attachVideo(firstVideo);
    await engine.setEnabled(true);
    await engine.attachVideo(secondVideo);

    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(engine.video).toBe(secondVideo);
    expect(engine.getState().videoSrc).toBe("https://www.youtube.com/watch?v=second");
    expect(engine.getState().pipelineState).toBe("active");
  });

  it("reuses the existing graph when re-enabling the same video", async () => {
    const fakeContext = createFakeAudioContext();
    const fakeModule = createFakeSoundTouchModule();
    const createAudioContext = vi.fn(() => fakeContext);
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext,
      processorUrl: "/soundtouch-processor.js",
    });
    const video = createFakeVideo();

    await engine.attachVideo(video);
    await engine.setEnabled(true);
    await engine.setEnabled(false);
    await engine.setSemitones(4);
    await engine.setEnabled(true);

    expect(createAudioContext).toHaveBeenCalledTimes(1);
    expect(fakeContext.close).toHaveBeenCalledTimes(0);
    expect(engine.processorNode.parameters.get("pitchSemitones").value).toBe(4);
    expect(engine.getState().pipelineState).toBe("active");
  });

  it("reports missing browser audio support and handles webkit pitch preservation", async () => {
    const fakeModule = createFakeSoundTouchModule();
    const unsupportedEngine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      processorUrl: "/soundtouch-processor.js",
    });
    await unsupportedEngine.attachVideo(createFakeVideo());
    await unsupportedEngine.setEnabled(true);
    expect(unsupportedEngine.getState().lastError).toContain("Web Audio API is not available in this browser");

    const fakeContext = createFakeAudioContext();
    const webkitVideo = createFakeVideo({
      webkitPreservesPitch: true,
    });
    delete webkitVideo.preservesPitch;
    const engine = new TuneShiftAudioEngine({
      loadSoundTouchModule: async () => fakeModule.module,
      createAudioContext: () => fakeContext,
      processorUrl: "/soundtouch-processor.js",
    });

    await engine.attachVideo(webkitVideo);
    await engine.setEnabled(true);
    expect(webkitVideo.webkitPreservesPitch).toBe(false);
    await engine.dispose();
    expect(webkitVideo.webkitPreservesPitch).toBe(true);
  });
});
