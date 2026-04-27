(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tuneshift-core.js"));
    return;
  }

  root.TuneShiftAudioEngine = factory(root.TuneShiftCore);
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  const {
    DEFAULT_PLAYBACK_RATE,
    DEFAULT_PROCESSOR_BUFFER_SIZE,
    clampPlaybackRate,
    clampSemitones,
    createTabState,
    formatPlaybackRate,
    formatSemitoneValue,
    mergeTabState,
    semitonesToPitchFactor,
    serializeError,
  } = core;

  function defaultAudioContextFactory() {
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("Web Audio API is not available in this browser");
    }

    return new AudioContextCtor();
  }

  function getOptionalAudioParam(node, name) {
    return node?.parameters?.get?.(name) ?? null;
  }

  function buildSettingsLabel(semitones, playbackRate) {
    return `${formatSemitoneValue(semitones)} st, ${formatPlaybackRate(playbackRate)}`;
  }

  function buildActiveStatus(semitones, playbackRate) {
    return `TuneShift active (${buildSettingsLabel(semitones, playbackRate)})`;
  }

  function buildReadyStatus(semitones, playbackRate) {
    return `TuneShift ready (${buildSettingsLabel(semitones, playbackRate)})`;
  }

  class TuneShiftAudioEngine {
    constructor(options) {
      const config = options || {};
      this.loadSoundTouchModule = config.loadSoundTouchModule;
      this.createAudioContext = config.createAudioContext || defaultAudioContextFactory;
      this.onStateChange = typeof config.onStateChange === "function" ? config.onStateChange : function () {};
      this.processorUrl = config.processorUrl || null;
      this.outputTrim = typeof config.outputTrim === "number" ? config.outputTrim : 0.88;
      this.bufferSize = config.bufferSize || DEFAULT_PROCESSOR_BUFFER_SIZE;

      this.video = null;
      this.desiredEnabled = false;
      this.semitones = 0;
      this.playbackRate = DEFAULT_PLAYBACK_RATE;
      this.soundTouchModulePromise = null;
      this.startPromise = null;

      this.audioContext = null;
      this.sourceNode = null;
      this.bypassGainNode = null;
      this.processorNode = null;
      this.processorCompressorNode = null;
      this.outputGainNode = null;
      this.originalPlaybackRate = DEFAULT_PLAYBACK_RATE;
      this.originalPreservesPitch = null;
      this.originalPitchPropertyName = null;
      this.lastStateSignature = null;

      this.handleVideoPlay = this.handleVideoPlay.bind(this);
      this.handleVideoVolumeChange = this.handleVideoVolumeChange.bind(this);
      this.handleVideoSeek = this.handleVideoSeek.bind(this);
      this.handleVideoLoadedMetadata = this.handleVideoLoadedMetadata.bind(this);

      this.state = createTabState({
        status: "Ready",
      });
    }

    getState() {
      return mergeTabState(this.state, {
        enabled: this.desiredEnabled,
        semitones: this.semitones,
        playbackRate: this.playbackRate,
        videoDetected: Boolean(this.video),
        pageUrl: globalThis.location?.href || null,
        videoSrc: this.video?.currentSrc || this.video?.src || null,
        readyState: this.video?.readyState ?? null,
        bufferedFrames: 0,
        timestamp: this.state.timestamp,
      });
    }

    async attachVideo(video) {
      if (this.video === video) {
        if (!this.desiredEnabled) {
          this.captureVideoDefaults();
        }

        this.applyMediaElementState();
        this.reportState({
          videoDetected: Boolean(video),
          videoSrc: video?.currentSrc || video?.src || null,
          readyState: video?.readyState ?? null,
        });
        return this.getState();
      }

      const shouldRestart = this.desiredEnabled;
      await this.stopPipeline({
        preserveDesiredEnabled: true,
        closeAudioContext: true,
        nextPipelineState: video ? "ready" : "idle",
        status: video ? "Video attached" : "Video element not found",
      });

      this.detachVideoListeners();
      this.video = video || null;
      this.captureVideoDefaults();
      this.attachVideoListeners();

      this.reportState({
        videoDetected: Boolean(this.video),
        videoSrc: this.video?.currentSrc || this.video?.src || null,
        readyState: this.video?.readyState ?? null,
        pipelineState: this.video ? "ready" : "idle",
        status: this.video ? "Video detected" : "Video element not found",
      });

      if (shouldRestart && this.video) {
        await this.startPipeline();
      } else if (shouldRestart) {
        this.reportState({
          pipelineState: "waiting",
          status: "Waiting for YouTube video",
        });
      }

      return this.getState();
    }

    async setEnabled(enabled) {
      this.desiredEnabled = Boolean(enabled);

      if (!this.desiredEnabled) {
        this.applyMediaElementState();
        this.applyRoutingMode();
        this.reportState({
          enabled: false,
          pipelineState: this.video ? "ready" : "idle",
          status: buildReadyStatus(this.semitones, this.playbackRate),
          lastError: null,
        });
        return this.getState();
      }

      if (!this.video) {
        this.reportState({
          enabled: true,
          pipelineState: "waiting",
          status: "Waiting for YouTube video",
        });
        return this.getState();
      }

      await this.startPipeline();
      return this.getState();
    }

    async setSemitones(value) {
      this.semitones = clampSemitones(value);
      this.applyProcessorParameters();

      this.reportState({
        semitones: this.semitones,
        pitchFactor: semitonesToPitchFactor(this.semitones),
        status: this.desiredEnabled
          ? buildActiveStatus(this.semitones, this.playbackRate)
          : buildReadyStatus(this.semitones, this.playbackRate),
      });

      return this.getState();
    }

    async setPlaybackRate(value) {
      this.playbackRate = clampPlaybackRate(value);
      this.applyProcessorParameters();
      this.applyMediaElementState();

      this.reportState({
        playbackRate: this.playbackRate,
        status: this.desiredEnabled
          ? buildActiveStatus(this.semitones, this.playbackRate)
          : buildReadyStatus(this.semitones, this.playbackRate),
      });

      return this.getState();
    }

    async dispose() {
      this.desiredEnabled = false;
      await this.stopPipeline({
        preserveDesiredEnabled: false,
        closeAudioContext: true,
        nextPipelineState: this.video ? "ready" : "idle",
        status: "Disposed",
      });
      this.detachVideoListeners();
      this.video = null;
      this.reportState({
        videoDetected: false,
        pipelineState: "idle",
        status: "Disposed",
      });
    }

    async startPipeline() {
      if (this.startPromise) {
        return this.startPromise;
      }

      this.startPromise = this.startPipelineInternal().finally(() => {
        this.startPromise = null;
      });

      return this.startPromise;
    }

    async startPipelineInternal() {
      if (!this.video) {
        this.reportState({
          enabled: true,
          pipelineState: "waiting",
          status: "Waiting for YouTube video",
        });
        return;
      }

      try {
        await this.ensurePipelineBuilt();

        if (typeof this.audioContext?.resume === "function") {
          await this.audioContext.resume();
        }

        if (this.video?.paused && typeof this.video.play === "function") {
          try {
            await this.video.play();
          } catch (_error) {
            // Ignore playback recovery failures.
          }
        }

        this.applyProcessorParameters();
        this.applyMediaElementState();
        this.applyRoutingMode();

        this.reportState({
          enabled: true,
          pipelineState: "active",
          status: buildActiveStatus(this.semitones, this.playbackRate),
          lastError: null,
        });
      } catch (error) {
        await this.stopPipeline({
          preserveDesiredEnabled: true,
          closeAudioContext: true,
          nextPipelineState: this.video ? "ready" : "idle",
          status: "Audio pipeline failed",
        });
        this.reportState({
          enabled: true,
          pipelineState: "error",
          lastError: serializeError(error),
          status: `Audio pipeline failed: ${serializeError(error)}`,
        });
      }
    }

    async ensurePipelineBuilt() {
      if (this.audioContext && this.sourceNode && this.processorNode && this.bypassGainNode && this.outputGainNode) {
        return;
      }

      this.reportState({
        enabled: true,
        pipelineState: "initializing",
        status: "Initializing audio pipeline",
      });

      await this.stopPipeline({
        preserveDesiredEnabled: true,
        closeAudioContext: true,
        nextPipelineState: "initializing",
        status: "Initializing audio pipeline",
      });

      const soundTouchModule = await this.getSoundTouchModule();
      const audioContext = this.createAudioContext();

      if (!this.processorUrl) {
        throw new Error("SoundTouch processor URL is required");
      }

      await soundTouchModule.SoundTouchNode.register(audioContext, this.processorUrl);

      const sourceNode = audioContext.createMediaElementSource(this.video);
      const bypassGainNode = audioContext.createGain();
      const processorNode = new soundTouchModule.SoundTouchNode(audioContext);
      const processorCompressorNode = audioContext.createDynamicsCompressor();
      const outputGainNode = audioContext.createGain();

      processorCompressorNode.threshold.value = -10;
      processorCompressorNode.knee.value = 8;
      processorCompressorNode.ratio.value = 3;
      processorCompressorNode.attack.value = 0.002;
      processorCompressorNode.release.value = 0.2;

      sourceNode.connect(bypassGainNode);
      bypassGainNode.connect(audioContext.destination);

      sourceNode.connect(processorNode);
      processorNode.connect(processorCompressorNode);
      processorCompressorNode.connect(outputGainNode);
      outputGainNode.connect(audioContext.destination);

      this.audioContext = audioContext;
      this.sourceNode = sourceNode;
      this.bypassGainNode = bypassGainNode;
      this.processorNode = processorNode;
      this.processorCompressorNode = processorCompressorNode;
      this.outputGainNode = outputGainNode;

      this.applyProcessorParameters();
      this.applyMediaElementState();
      this.applyRoutingMode();
    }

    async stopPipeline(options) {
      const config = options || {};
      const audioContext = this.audioContext;

      this.safeDisconnect(this.outputGainNode);
      this.safeDisconnect(this.processorCompressorNode);
      this.safeDisconnect(this.processorNode);
      this.safeDisconnect(this.bypassGainNode);
      this.safeDisconnect(this.sourceNode);

      this.restoreMediaElementState();

      this.outputGainNode = null;
      this.processorCompressorNode = null;
      this.processorNode = null;
      this.bypassGainNode = null;
      this.sourceNode = null;
      this.audioContext = null;

      if (config.closeAudioContext !== false && audioContext && typeof audioContext.close === "function") {
        try {
          await audioContext.close();
        } catch (_error) {
          // Ignore close failures during teardown.
        }
      }

      if (!config.preserveDesiredEnabled) {
        this.desiredEnabled = false;
      }

      this.reportState({
        enabled: this.desiredEnabled,
        pipelineState: config.nextPipelineState || (this.video ? "ready" : "idle"),
        status: config.status || "Pitch shift disabled",
        bufferedFrames: 0,
      });
    }

    async getSoundTouchModule() {
      if (!this.soundTouchModulePromise) {
        if (typeof this.loadSoundTouchModule !== "function") {
          throw new Error("SoundTouch module loader is required");
        }

        this.soundTouchModulePromise = Promise.resolve(this.loadSoundTouchModule());
      }

      return this.soundTouchModulePromise;
    }

    attachVideoListeners() {
      if (!this.video?.addEventListener) {
        return;
      }

      this.video.addEventListener("play", this.handleVideoPlay);
      this.video.addEventListener("volumechange", this.handleVideoVolumeChange);
      this.video.addEventListener("seeking", this.handleVideoSeek);
      this.video.addEventListener("seeked", this.handleVideoSeek);
      this.video.addEventListener("loadedmetadata", this.handleVideoLoadedMetadata);
    }

    detachVideoListeners() {
      if (!this.video?.removeEventListener) {
        return;
      }

      this.video.removeEventListener("play", this.handleVideoPlay);
      this.video.removeEventListener("volumechange", this.handleVideoVolumeChange);
      this.video.removeEventListener("seeking", this.handleVideoSeek);
      this.video.removeEventListener("seeked", this.handleVideoSeek);
      this.video.removeEventListener("loadedmetadata", this.handleVideoLoadedMetadata);
    }

    handleVideoPlay() {
      if (this.audioContext?.resume) {
        this.audioContext.resume().catch(function () {});
      }
    }

    handleVideoVolumeChange() {
      this.applyRoutingMode();
    }

    handleVideoSeek() {
      this.reportState({
        status: this.desiredEnabled
          ? buildActiveStatus(this.semitones, this.playbackRate)
          : buildReadyStatus(this.semitones, this.playbackRate),
      });
    }

    handleVideoLoadedMetadata() {
      if (!this.desiredEnabled) {
        this.captureVideoDefaults();
      }

      this.applyMediaElementState();
      this.handleVideoSeek();
      this.reportState({
        readyState: this.video?.readyState ?? null,
        videoSrc: this.video?.currentSrc || this.video?.src || null,
      });
    }

    captureVideoDefaults() {
      if (!this.video) {
        this.originalPlaybackRate = DEFAULT_PLAYBACK_RATE;
        this.originalPreservesPitch = null;
        this.originalPitchPropertyName = null;
        return;
      }

      const initialPlaybackRate = Number(this.video.playbackRate);
      this.originalPlaybackRate =
        Number.isFinite(initialPlaybackRate) && initialPlaybackRate > 0
          ? initialPlaybackRate
          : DEFAULT_PLAYBACK_RATE;

      if ("preservesPitch" in this.video) {
        this.originalPitchPropertyName = "preservesPitch";
        this.originalPreservesPitch = this.video.preservesPitch;
      } else if ("webkitPreservesPitch" in this.video) {
        this.originalPitchPropertyName = "webkitPreservesPitch";
        this.originalPreservesPitch = this.video.webkitPreservesPitch;
      } else {
        this.originalPitchPropertyName = null;
        this.originalPreservesPitch = null;
      }
    }

    restoreMediaElementState() {
      if (!this.video) {
        return;
      }

      if (this.originalPitchPropertyName && this.originalPreservesPitch !== null) {
        this.video[this.originalPitchPropertyName] = this.originalPreservesPitch;
      }

      if ("playbackRate" in this.video) {
        this.video.playbackRate = this.originalPlaybackRate;
      }
    }

    applyMediaElementState() {
      if (!this.video) {
        return;
      }

      if (this.originalPitchPropertyName && this.originalPreservesPitch !== null) {
        this.video[this.originalPitchPropertyName] = this.desiredEnabled ? false : this.originalPreservesPitch;
      }

      if ("playbackRate" in this.video) {
        this.video.playbackRate = this.desiredEnabled ? this.playbackRate : this.originalPlaybackRate;
      }
    }

    applyProcessorParameters() {
      if (!this.processorNode) {
        return;
      }

      const pitchSemitones = getOptionalAudioParam(this.processorNode, "pitchSemitones");
      const pitch = getOptionalAudioParam(this.processorNode, "pitch");
      const tempo = getOptionalAudioParam(this.processorNode, "tempo");
      const rate = getOptionalAudioParam(this.processorNode, "rate");
      const playbackRate = getOptionalAudioParam(this.processorNode, "playbackRate");

      if (pitchSemitones) {
        pitchSemitones.value = this.semitones;
      }

      if (pitch) {
        pitch.value = 1;
      }

      if (tempo) {
        tempo.value = 1;
      }

      if (rate) {
        rate.value = 1;
      }

      if (playbackRate) {
        playbackRate.value = this.playbackRate;
      }
    }

    applyRoutingMode() {
      if (!this.outputGainNode?.gain || !this.bypassGainNode?.gain) {
        return;
      }

      if (this.desiredEnabled) {
        this.bypassGainNode.gain.value = 0;
        this.outputGainNode.gain.value = this.outputTrim;
        return;
      }

      this.bypassGainNode.gain.value = 1;
      this.outputGainNode.gain.value = 0;
    }

    safeDisconnect(node) {
      if (!node?.disconnect) {
        return;
      }

      try {
        node.disconnect();
      } catch (_error) {
        // Ignore duplicate disconnects during teardown.
      }
    }

    reportState(partialState) {
      const nextState = mergeTabState(this.state, partialState);
      const nextSignature = JSON.stringify({
        ...nextState,
        timestamp: 0,
      });

      this.state = nextState;
      if (this.lastStateSignature === nextSignature) {
        return;
      }

      this.lastStateSignature = nextSignature;
      this.onStateChange(this.getState());
    }
  }

  return {
    TuneShiftAudioEngine,
  };
});
