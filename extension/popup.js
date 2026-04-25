const { MAX_SEMITONES, MESSAGE_TYPES, MIN_SEMITONES, clampSemitones, formatSemitoneValue } = TuneShiftCore;

const semitoneValue = document.getElementById("semitone-value");
const toggleButton = document.getElementById("toggle-button");
const decreaseButton = document.getElementById("decrease-button");
const increaseButton = document.getElementById("increase-button");
const resetButton = document.getElementById("reset-button");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const detectedValue = document.getElementById("detected-value");
const readyStateValue = document.getElementById("ready-state-value");
const bufferedValue = document.getElementById("buffered-value");
const srcValue = document.getElementById("src-value");
const hintText = document.getElementById("hint-text");

const popupState = {
  activeTab: null,
  state: null,
};

function setControlAvailability(enabled) {
  toggleButton.disabled = !enabled;
  decreaseButton.disabled = !enabled;
  increaseButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

function setView(state, options = {}) {
  popupState.state = state || popupState.state;

  const tabSupported = options.tabSupported !== false;
  const nextState = popupState.state || {
    enabled: false,
    semitones: 0,
    status: "No state available",
    videoDetected: false,
    readyState: null,
    bufferedFrames: 0,
    videoSrc: null,
  };

  semitoneValue.textContent = formatSemitoneValue(nextState.semitones);
  toggleButton.textContent = nextState.enabled ? "Turn Off" : "Turn On";
  toggleButton.classList.toggle("on", Boolean(nextState.enabled));
  statusText.textContent = options.fallbackStatus || nextState.status || "No status available";
  detectedValue.textContent = nextState.videoDetected ? "Yes" : "No";
  readyStateValue.textContent = nextState.readyState ?? "-";
  bufferedValue.textContent = nextState.bufferedFrames ?? 0;
  srcValue.textContent = nextState.videoSrc || "-";

  const ready = nextState.pipelineState === "active" || nextState.videoDetected;
  statusDot.classList.toggle("ready", ready);

  const canDecrease = tabSupported && nextState.semitones > MIN_SEMITONES;
  const canIncrease = tabSupported && nextState.semitones < MAX_SEMITONES;

  setControlAvailability(tabSupported);
  decreaseButton.disabled = !canDecrease;
  increaseButton.disabled = !canIncrease;
  resetButton.disabled = !tabSupported || nextState.semitones === 0;

  hintText.textContent = tabSupported
    ? "The processed audio replaces the muted YouTube element while TuneShift is on. Toggle off to restore the original path."
    : "Open a YouTube watch page before using TuneShift. The popup only controls the active YouTube tab.";
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
  if (!popupState.activeTab?.id) {
    return;
  }

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.SET_ENABLED,
    tabId: popupState.activeTab.id,
    enabled,
  });

  setView(response?.state || popupState.state, {
    tabSupported: true,
  });
}

async function updateSemitones(semitones) {
  if (!popupState.activeTab?.id) {
    return;
  }

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.SET_SEMITONES,
    tabId: popupState.activeTab.id,
    semitones: clampSemitones(semitones),
  });

  setView(response?.state || popupState.state, {
    tabSupported: true,
  });
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

resetButton.addEventListener("click", () => {
  updateSemitones(0).catch((error) => {
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
