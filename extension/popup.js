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

const THEME_STORAGE_KEY = "tuneshift-popup-theme";

const themeButton = document.getElementById("theme-button");
const semitoneValue = document.getElementById("semitone-value");
const tempoValue = document.getElementById("tempo-value");
const toggleButton = document.getElementById("toggle-button");
const decreaseButton = document.getElementById("decrease-button");
const increaseButton = document.getElementById("increase-button");
const tempoDecreaseButton = document.getElementById("tempo-decrease-button");
const tempoIncreaseButton = document.getElementById("tempo-increase-button");
const resetButton = document.getElementById("reset-button");
const statusNote = document.getElementById("status-note");
const statusText = document.getElementById("status-text");

const popupState = {
  activeTab: null,
  state: null,
  theme: "dark",
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
    lastError: null,
  };
}

function isValidTheme(theme) {
  return theme === "dark" || theme === "light";
}

function getInitialTheme() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidTheme(storedTheme)) {
      return storedTheme;
    }
  } catch (_error) {
    // Ignore storage failures and fall back to system preference.
  }

  if (typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (_error) {
      // Ignore matchMedia failures and keep the default theme.
    }
  }

  return "dark";
}

function applyTheme(theme) {
  const nextTheme = isValidTheme(theme) ? theme : "dark";
  const alternateTheme = nextTheme === "dark" ? "light" : "dark";

  popupState.theme = nextTheme;
  document.body.dataset.theme = nextTheme;
  themeButton.setAttribute("aria-label", `Switch to ${alternateTheme} theme`);
  themeButton.setAttribute("title", `Switch to ${alternateTheme} theme`);
}

function toggleTheme() {
  const nextTheme = popupState.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (_error) {
    // Ignore storage failures and keep the in-memory theme.
  }
}

function setControlAvailability(enabled) {
  toggleButton.disabled = !enabled;
  decreaseButton.disabled = !enabled;
  increaseButton.disabled = !enabled;
  tempoDecreaseButton.disabled = !enabled;
  tempoIncreaseButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

function getStatusPresentation(state, options = {}) {
  const nextState = state || createFallbackState();

  if (options.tabSupported === false) {
    return {
      tone: "warning",
      text: options.fallbackStatus || "Open a YouTube watch page",
    };
  }

  if (options.fallbackStatus) {
    return {
      tone: options.fallbackTone || "inactive",
      text: options.fallbackStatus,
    };
  }

  if (nextState.lastError || nextState.pipelineState === "error") {
    return {
      tone: "warning",
      text: nextState.lastError || "Audio pipeline error",
    };
  }

  if (!nextState.videoDetected) {
    return {
      tone: "warning",
      text: "Open a YouTube video",
    };
  }

  if (nextState.enabled && nextState.pipelineState !== "active") {
    return {
      tone: "active",
      text: `Preparing (${formatSemitoneValue(nextState.semitones)} st, ${formatPlaybackRate(nextState.playbackRate)})`,
    };
  }

  if (nextState.enabled) {
    return {
      tone: "active",
      text: `Active (${formatSemitoneValue(nextState.semitones)} st, ${formatPlaybackRate(nextState.playbackRate)})`,
    };
  }

  if (nextState.semitones !== 0 || nextState.playbackRate !== DEFAULT_PLAYBACK_RATE) {
    return {
      tone: "inactive",
      text: `Ready (${formatSemitoneValue(nextState.semitones)} st, ${formatPlaybackRate(nextState.playbackRate)})`,
    };
  }

  return {
    tone: "inactive",
    text: "Inactive",
  };
}

function setView(state, options = {}) {
  if (state === null) {
    popupState.state = null;
  } else if (state) {
    popupState.state = state;
  }

  const tabSupported = options.tabSupported !== false;
  const nextState = popupState.state || createFallbackState();
  const statusPresentation = getStatusPresentation(nextState, options);

  semitoneValue.textContent = formatSemitoneValue(nextState.semitones);
  tempoValue.textContent = formatPlaybackRate(nextState.playbackRate);
  toggleButton.classList.toggle("on", Boolean(nextState.enabled));
  toggleButton.setAttribute("aria-pressed", String(Boolean(nextState.enabled)));
  toggleButton.setAttribute("aria-label", nextState.enabled ? "Turn TuneShift off" : "Turn TuneShift on");
  toggleButton.setAttribute("title", nextState.enabled ? "Turn TuneShift off" : "Turn TuneShift on");

  statusNote.classList.remove("active", "inactive", "warning");
  statusNote.classList.add(statusPresentation.tone);
  statusText.textContent = statusPresentation.text;

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

function queueStateMutation(partialState, messageFactory, fallbackStatus, fallbackTone) {
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
    fallbackTone,
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
        fallbackTone: "warning",
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
      fallbackTone: "warning",
    });
    return;
  }

  setView(response.state, {
    tabSupported: true,
  });
}

function updateEnabled(enabled) {
  return queueStateMutation(
    {
      enabled: Boolean(enabled),
      pipelineState: Boolean(enabled) ? "waiting" : "ready",
    },
    () => ({
      type: MESSAGE_TYPES.SET_ENABLED,
      enabled,
    }),
    Boolean(enabled) ? "Starting TuneShift" : "Turning TuneShift off",
    Boolean(enabled) ? "active" : "inactive"
  );
}

function updateSemitones(semitones) {
  const nextSemitones = clampSemitones(semitones);
  return queueStateMutation(
    {
      semitones: nextSemitones,
    },
    () => ({
      type: MESSAGE_TYPES.SET_SEMITONES,
      semitones: nextSemitones,
    }),
    "Updating pitch",
    popupState.state?.enabled ? "active" : "inactive"
  );
}

function updatePlaybackRate(playbackRate) {
  const nextPlaybackRate = clampPlaybackRate(playbackRate);
  const nextEnabled =
    nextPlaybackRate !== DEFAULT_PLAYBACK_RATE ? true : (popupState.state?.enabled ?? false);

  return queueStateMutation(
    {
      enabled: nextEnabled,
      pipelineState: nextEnabled ? "waiting" : "ready",
      playbackRate: nextPlaybackRate,
    },
    () => ({
      type: MESSAGE_TYPES.SET_PLAYBACK_RATE,
      playbackRate: nextPlaybackRate,
    }),
    "Updating speed",
    nextEnabled ? "active" : "inactive"
  );
}

decreaseButton.addEventListener("click", () => {
  const nextValue = clampSemitones((popupState.state?.semitones || 0) - 1);
  updateSemitones(nextValue).catch(() => {});
});

increaseButton.addEventListener("click", () => {
  const nextValue = clampSemitones((popupState.state?.semitones || 0) + 1);
  updateSemitones(nextValue).catch(() => {});
});

tempoDecreaseButton.addEventListener("click", () => {
  const nextValue = stepPlaybackRate(popupState.state?.playbackRate || DEFAULT_PLAYBACK_RATE, -1);
  updatePlaybackRate(nextValue).catch(() => {});
});

tempoIncreaseButton.addEventListener("click", () => {
  const nextValue = stepPlaybackRate(popupState.state?.playbackRate || DEFAULT_PLAYBACK_RATE, 1);
  updatePlaybackRate(nextValue).catch(() => {});
});

resetButton.addEventListener("click", () => {
  updateSemitones(0)
    .then(() => updatePlaybackRate(DEFAULT_PLAYBACK_RATE))
    .catch(() => {});
});

toggleButton.addEventListener("click", () => {
  updateEnabled(!(popupState.state?.enabled)).catch(() => {});
});

themeButton.addEventListener("click", toggleTheme);

applyTheme(getInitialTheme());

refreshState()
  .then(() => {
    window.setInterval(() => {
      refreshState().catch((error) => {
        setView(popupState.state, {
          tabSupported: Boolean(popupState.activeTab?.url?.startsWith("https://www.youtube.com/")),
          fallbackStatus: error.message,
          fallbackTone: "warning",
        });
      });
    }, 1000);
  })
  .catch((error) => {
    setControlAvailability(false);
    setView(null, {
      tabSupported: false,
      fallbackStatus: error.message,
      fallbackTone: "warning",
    });
  });
