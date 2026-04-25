const { MESSAGE_TYPES, createTabState, mergeTabState } = TuneShiftCore;
const { TuneShiftAudioEngine: TuneShiftAudioEngineClass } = globalThis.TuneShiftAudioEngine;

const DOM_OBSERVER_CONFIG = {
  childList: true,
  subtree: true,
};

const controllerState = {
  desiredState: createTabState({
    status: "Searching for YouTube video",
  }),
  reportedState: createTabState({
    status: "Searching for YouTube video",
  }),
  video: null,
  observer: null,
  refreshTimer: null,
};

const engine = new TuneShiftAudioEngineClass({
  loadSoundTouchModule: () => import(chrome.runtime.getURL("pitch/worklet/index.js")),
  processorUrl: chrome.runtime.getURL("pitch/worklet/soundtouch-processor.js"),
  onStateChange: (engineState) => {
    controllerState.reportedState = mergeTabState(controllerState.reportedState, engineState);
    reportState();
  },
});

function debugLog(message, extra) {
  if (extra !== undefined) {
    console.log("[TuneShift]", message, extra);
    return;
  }

  console.log("[TuneShift]", message);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function findVideoElement() {
  return document.querySelector("video.html5-main-video, video");
}

async function reportState(partialState) {
  controllerState.reportedState = mergeTabState(controllerState.reportedState, partialState || {});

  try {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.ENGINE_STATUS,
      state: controllerState.reportedState,
    });

    if (response?.ok && response.state) {
      controllerState.reportedState = mergeTabState(controllerState.reportedState, response.state);
    }
  } catch (error) {
    debugLog("Unable to report state to the background service worker", error.message);
  }
}

async function refreshVideoBinding() {
  const nextVideo = findVideoElement();

  if (controllerState.video === nextVideo) {
    await reportState({
      videoDetected: Boolean(nextVideo),
      videoSrc: nextVideo?.currentSrc || nextVideo?.src || null,
      readyState: nextVideo?.readyState ?? null,
      pageUrl: location.href,
      status: nextVideo ? controllerState.reportedState.status : "Video element not found",
    });
    return;
  }

  controllerState.video = nextVideo;
  await engine.attachVideo(nextVideo);

  if (!nextVideo) {
    await reportState({
      videoDetected: false,
      videoSrc: null,
      readyState: null,
      pageUrl: location.href,
      pipelineState: controllerState.desiredState.enabled ? "waiting" : "idle",
      status: "Video element not found",
    });
    return;
  }

  await reportState({
    videoDetected: true,
    videoSrc: nextVideo.currentSrc || nextVideo.src || null,
    readyState: nextVideo.readyState,
    pageUrl: location.href,
    status: "Video detected",
  });
}

function watchDomForVideoChanges() {
  controllerState.observer?.disconnect();

  controllerState.observer = new MutationObserver(() => {
    window.clearTimeout(controllerState.refreshTimer);
    controllerState.refreshTimer = window.setTimeout(() => {
      refreshVideoBinding().catch((error) => {
        debugLog("Unable to refresh video binding", error.message);
      });
    }, 50);
  });

  controllerState.observer.observe(document.documentElement, DOM_OBSERVER_CONFIG);
}

async function applyDesiredState(partialState) {
  controllerState.desiredState = mergeTabState(controllerState.desiredState, partialState || {});
  await engine.setSemitones(controllerState.desiredState.semitones);
  await engine.setEnabled(controllerState.desiredState.enabled);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === MESSAGE_TYPES.APPLY_AUDIO_STATE) {
    applyDesiredState(message.state)
      .then(() => {
        sendResponse({
          ok: true,
          state: controllerState.reportedState,
        });
      })
      .catch((error) => {
        reportState({
          pipelineState: "error",
          lastError: error.message,
          status: `Content script error: ${error.message}`,
        }).finally(() => {
          sendResponse({
            ok: false,
            error: error.message,
            state: controllerState.reportedState,
          });
        });
      });

    return true;
  }

  return false;
});

window.addEventListener("yt-navigate-finish", () => {
  refreshVideoBinding().catch((error) => {
    debugLog("Unable to refresh video binding after navigation", error.message);
  });
});

window.addEventListener("pageshow", () => {
  refreshVideoBinding().catch((error) => {
    debugLog("Unable to refresh video binding after pageshow", error.message);
  });
});

(async function bootstrap() {
  try {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.CONTENT_READY,
    });

    if (response?.ok && response.state) {
      controllerState.desiredState = mergeTabState(controllerState.desiredState, response.state);
    }

    await refreshVideoBinding();
    watchDomForVideoChanges();
    await applyDesiredState(controllerState.desiredState);
    await reportState({
      status: controllerState.video ? "Video detected" : "Video element not found",
      pageUrl: location.href,
    });
    debugLog("Content script initialized");
  } catch (error) {
    await reportState({
      pipelineState: "error",
      lastError: error.message,
      status: `Bootstrap failed: ${error.message}`,
      pageUrl: location.href,
    });
    debugLog("Content script bootstrap failed", error.message);
  }
})();
