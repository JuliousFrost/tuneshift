importScripts("lib/tuneshift-core.js");

const { MESSAGE_TYPES, clampPlaybackRate, clampSemitones, createTabState, mergeTabState } = TuneShiftCore;

const tabState = new Map();

function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, createTabState());
  }

  return tabState.get(tabId);
}

function updateTabState(tabId, partialState) {
  const nextState = mergeTabState(getTabState(tabId), partialState);
  tabState.set(tabId, nextState);
  return nextState;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }

      resolve(response || { ok: true });
    });
  });
}

async function syncStateToTab(tabId) {
  const state = getTabState(tabId);
  const response = await sendMessageToTab(tabId, {
    type: MESSAGE_TYPES.APPLY_AUDIO_STATE,
    state,
  });

  if (response?.ok && response.state) {
    return updateTabState(tabId, response.state);
  }

  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === MESSAGE_TYPES.CONTENT_READY && sender.tab?.id !== undefined) {
    const state = updateTabState(sender.tab.id, {
      pageUrl: sender.tab.url || null,
    });
    sendResponse({
      ok: true,
      state,
    });
    return false;
  }

  if (message.type === MESSAGE_TYPES.ENGINE_STATUS && sender.tab?.id !== undefined) {
    const state = updateTabState(sender.tab.id, message.state || {});
    sendResponse({
      ok: true,
      state,
    });
    return false;
  }

  if (message.type === MESSAGE_TYPES.GET_TAB_STATE) {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "tabId is required",
      });
      return false;
    }

    sendResponse({
      ok: true,
      state: getTabState(tabId),
    });
    return false;
  }

  if (message.type === MESSAGE_TYPES.SET_ENABLED) {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "tabId is required",
      });
      return false;
    }

    updateTabState(tabId, {
      enabled: Boolean(message.enabled),
      pipelineState: Boolean(message.enabled) ? "waiting" : "ready",
      status: Boolean(message.enabled) ? "Starting TuneShift" : "TuneShift ready",
      lastError: null,
    });

    syncStateToTab(tabId).then((state) => {
      sendResponse({
        ok: true,
        state,
      });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.SET_SEMITONES) {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "tabId is required",
      });
      return false;
    }

    updateTabState(tabId, {
      semitones: clampSemitones(message.semitones),
      status: "Updating semitone shift",
      lastError: null,
    });

    syncStateToTab(tabId).then((state) => {
      sendResponse({
        ok: true,
        state,
      });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.SET_PLAYBACK_RATE) {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "tabId is required",
      });
      return false;
    }

    const playbackRate = clampPlaybackRate(message.playbackRate);
    updateTabState(tabId, {
      enabled: playbackRate !== 1 ? true : getTabState(tabId).enabled,
      playbackRate,
      pipelineState: playbackRate !== 1 || getTabState(tabId).enabled ? "waiting" : "ready",
      status: "Updating playback speed",
      lastError: null,
    });

    syncStateToTab(tabId).then((state) => {
      sendResponse({
        ok: true,
        state,
      });
    });
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") {
    return;
  }

  const currentState = getTabState(tabId);
  updateTabState(tabId, {
    enabled: currentState.enabled,
    semitones: currentState.semitones,
    playbackRate: currentState.playbackRate,
    videoDetected: false,
    pipelineState: currentState.enabled ? "waiting" : "idle",
    status: "Page loading",
    pageUrl: tab?.url || null,
    videoSrc: null,
    readyState: null,
    bufferedFrames: 0,
    lastError: null,
  });
});
