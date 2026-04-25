const {
  DEFAULT_PLAYBACK_RATE,
  MAX_SEMITONES,
  MESSAGE_TYPES,
  MIN_SEMITONES,
  PLAYBACK_RATE_PRESETS,
  clampPlaybackRate,
  clampSemitones,
  formatPlaybackRate,
  formatSemitoneValue,
  stepPlaybackRate,
} = TuneShiftCore;

const semitoneValue = document.getElementById("semitone-value");
const tempoValue = document.getElementById("tempo-value");
const toggleButton = document.getElementById("toggle-button");
const decreaseButton = document.getElementById("decrease-button");
const increaseButton = document.getElementById("increase-button");
const tempoDecreaseButton = document.getElementById("tempo-decrease-button");
const tempoIncreaseButton = document.getElementById("tempo-increase-button");
const resetButton = document.getElementById("reset-button");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

const popupState = {
  activeTab: null,
  state: null,
  pendingMutations: 0,
  requestQueue: Promise.resolve(),
};

function createFallbackState() {
  return {
    enabled: false,
    semitones: 0,
    playbackRate: DEFAULT_PLAYBACK_RATE,
    status: "No state available",
    videoDetected: false,
    pipelineState: "idle",
    readyState: null,
    bufferedFrames: 0,
    videoSrc: null,
  };
}

function setControlAvailability(enabled) {
  toggleButton.disabled = !enabled;
  decreaseButton.disabled = !enabled;
  increaseButton.disabled = !enabled;
  tempoDecreaseButton.disabled = !enabled;
  tempoIncreaseButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

function setView(state, options = {}) {
  if (state === null) {
    popupState.state = null;
  } else if (state) {
    popupState.state = state;
  }

  const tabSupported = options.tabSupported !== false;
  const nextState = popupState.state || createFallbackState();

  semitoneValue.textContent = formatSemitoneValue(nextState.semitones);
  tempoValue.textContent = formatPlaybackRate(nextState.playbackRate);
  toggleButton.classList.toggle("on", Boolean(nextState.enabled));
  toggleButton.setAttribute("aria-pressed", String(Boolean(nextState.enabled)));
  toggleButton.setAttribute("aria-label", nextState.enabled ? "Turn TuneShift off" : "Turn TuneShift on");
  toggleButton.setAttribute("title", nextState.enabled ? "Turn TuneShift off" : "Turn TuneShift on");
  statusText.textContent = options.fallbackStatus || nextState.status || "No status available";

  const ready = nextState.pipelineState === "active" || nextState.videoDetected;
  statusDot.classList.toggle("ready", ready);

  const canDecrease = tabSupported && nextState.semitones > MIN_SEMITONES;
  const canIncrease = tabSupported && nextState.semitones < MAX_SEMITONES;
  const playbackRateIndex = PLAYBACK_RATE_PRESETS.indexOf(nextState.playbackRate);
  const canDecreasePlayback = tabSupported && playbackRateIndex > 0;
  const canIncreasePlayback = tabSupported && playbackRateIndex < PLAYBACK_RATE_PRESETS.length - 1;

  setControlAvailability(tabSupported);
  decreaseButton.disabled = !canDecrease;
  increaseButton.disabled = !canIncrease;
  tempoDecreaseButton.disabled = !canDecreasePlayback;
  tempoIncreaseButton.disabled = !canIncreasePlayback;
  resetButton.disabled =
    !tabSupported || (nextState.semitones === 0 && nextState.playbackRate === DEFAULT_PLAYBACK_RATE);
}

function queueStateMutation(partialState, messageFactory, fallbackStatus) {
  if (!popupState.activeTab?.id) {
    return Promise.resolve();
  }

  const optimisticState = {
    ...(popupState.state || createFallbackState()),
    ...(partialState || {}),
  };

  popupState.state = optimisticState;
  setView(optimisticState, {
    tabSupported: true,
    fallbackStatus,
  });

  popupState.pendingMutations += 1;

  const requestPromise = popupState.requestQueue
    .catch(() => {})
    .then(() =>
      sendRuntimeMessage({
        ...(typeof messageFactory === "function" ? messageFactory() : messageFactory),
        tabId: popupState.activeTab.id,
      })
    );

  popupState.requestQueue = requestPromise.finally(() => {
    popupState.pendingMutations = Math.max(0, popupState.pendingMutations - 1);
  });

  return requestPromise
    .then((response) => {
      setView(response?.state || popupState.state, {
        tabSupported: true,
      });

      return response;
    })
    .catch((error) => {
      setView(popupState.state, {
        tabSupported: true,
        fallbackStatus: error.message,
      });
      throw error;
    });
}

function queryActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(
      {
        active: true,
        currentWindow: true,
      },
      (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(tabs[0] || null);
      }
    );
  });
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

async function refreshState() {
  popupState.activeTab = await queryActiveTab();

  if (!popupState.activeTab?.id) {
    setControlAvailability(false);
    setView(null, {
      tabSupported: false,
      fallbackStatus: "No active browser tab",
    });
    return;
  }

  const isYouTube = popupState.activeTab.url?.startsWith("https://www.youtube.com/");
  if (!isYouTube) {
    setControlAvailability(false);
    setView(null, {
      tabSupported: false,
      fallbackStatus: "Active tab is not a YouTube page",
    });
    return;
  }

  if (popupState.pendingMutations > 0) {
    setView(popupState.state, {
      tabSupported: true,
    });
    return;
  }

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.GET_TAB_STATE,
    tabId: popupState.activeTab.id,
  });

  if (!response?.ok) {
    setView(null, {
      tabSupported: true,
      fallbackStatus: response?.error || "Unable to load tab state",
    });
    return;
  }

  setView(response.state, {
    tabSupported: true,
  });
}

async function updateEnabled(enabled) {
  return queueStateMutation(
    {
      enabled: Boolean(enabled),
      pipelineState: Boolean(enabled) ? "waiting" : "ready",
    },
    () => ({
      type: MESSAGE_TYPES.SET_ENABLED,
      enabled,
    }),
    Boolean(enabled) ? "Starting TuneShift" : "Turning TuneShift off"
  );
}

async function updateSemitones(semitones) {
  const nextSemitones = clampSemitones(semitones);
  return queueStateMutation(
    {
      semitones: nextSemitones,
    },
    () => ({
      type: MESSAGE_TYPES.SET_SEMITONES,
      semitones: nextSemitones,
    }),
    "Updating semitone shift"
  );
}

async function updatePlaybackRate(playbackRate) {
  const nextPlaybackRate = clampPlaybackRate(playbackRate);
  return queueStateMutation(
    {
      enabled: nextPlaybackRate !== DEFAULT_PLAYBACK_RATE ? true : (popupState.state?.enabled ?? false),
      pipelineState:
        nextPlaybackRate !== DEFAULT_PLAYBACK_RATE || popupState.state?.enabled ? "waiting" : "ready",
      playbackRate: nextPlaybackRate,
    },
    () => ({
      type: MESSAGE_TYPES.SET_PLAYBACK_RATE,
      playbackRate: nextPlaybackRate,
    }),
    "Updating playback speed"
  );
}

decreaseButton.addEventListener("click", () => {
  const nextValue = clampSemitones((popupState.state?.semitones || 0) - 1);
  updateSemitones(nextValue).catch((error) => {
    setView(popupState.state, {
      tabSupported: true,
      fallbackStatus: error.message,
    });
  });
});

increaseButton.addEventListener("click", () => {
  const nextValue = clampSemitones((popupState.state?.semitones || 0) + 1);
  updateSemitones(nextValue).catch((error) => {
    setView(popupState.state, {
      tabSupported: true,
      fallbackStatus: error.message,
    });
  });
});

tempoDecreaseButton.addEventListener("click", () => {
  const nextValue = stepPlaybackRate(popupState.state?.playbackRate || DEFAULT_PLAYBACK_RATE, -1);
  updatePlaybackRate(nextValue).catch((error) => {
    setView(popupState.state, {
      tabSupported: true,
      fallbackStatus: error.message,
    });
  });
});

tempoIncreaseButton.addEventListener("click", () => {
  const nextValue = stepPlaybackRate(popupState.state?.playbackRate || DEFAULT_PLAYBACK_RATE, 1);
  updatePlaybackRate(nextValue).catch((error) => {
    setView(popupState.state, {
      tabSupported: true,
      fallbackStatus: error.message,
    });
  });
});

resetButton.addEventListener("click", () => {
  updateSemitones(0)
    .then(() => updatePlaybackRate(DEFAULT_PLAYBACK_RATE))
    .catch((error) => {
      setView(popupState.state, {
        tabSupported: true,
        fallbackStatus: error.message,
      });
    });
});

toggleButton.addEventListener("click", () => {
  updateEnabled(!(popupState.state?.enabled)).catch((error) => {
    setView(popupState.state, {
      tabSupported: true,
      fallbackStatus: error.message,
    });
  });
});

refreshState()
  .then(() => {
    window.setInterval(() => {
      refreshState().catch((error) => {
        setView(popupState.state, {
          tabSupported: Boolean(popupState.activeTab?.url?.startsWith("https://www.youtube.com/")),
          fallbackStatus: error.message,
        });
      });
    }, 1000);
  })
  .catch((error) => {
    setControlAvailability(false);
    setView(null, {
      tabSupported: false,
      fallbackStatus: error.message,
    });
  });
