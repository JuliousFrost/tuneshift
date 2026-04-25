// @vitest-environment jsdom

const path = require("path");

const core = require("../extension/lib/tuneshift-core.js");

function createPopupMarkup() {
  document.body.innerHTML = `
    <main>
      <header class="header">
        <h1>TuneShift</h1>
        <p class="subtitle">Pitch and tempo controls for YouTube.</p>
      </header>
      <section class="panel">
        <div class="control-stack">
          <div class="control-group">
            <div class="transport">
              <button id="decrease-button" type="button">-</button>
              <div class="value-card"><p id="semitone-value">0</p></div>
              <button id="increase-button" type="button">+</button>
            </div>
          </div>
          <div class="control-group">
            <div class="transport">
              <button id="tempo-decrease-button" type="button">-</button>
              <div class="value-card"><p id="tempo-value">1x</p></div>
              <button id="tempo-increase-button" type="button">+</button>
            </div>
          </div>
          <div class="controls">
            <button id="toggle-button" type="button">Turn On</button>
            <button id="reset-button" type="button">Reset All</button>
          </div>
        </div>
        <div class="status-note">
          <span id="status-dot"></span>
          <p id="status-text">Checking active tab...</p>
        </div>
      </section>
    </main>
  `;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("popup interactions", () => {
  let currentState;
  let playbackRateRequests;
  let toggleRequests;
  let playbackDeferreds;
  let toggleDeferreds;

  beforeEach(async () => {
    vi.resetModules();
    createPopupMarkup();

    currentState = core.createTabState({
      enabled: false,
      semitones: 0,
      playbackRate: 1,
      pipelineState: "ready",
      status: "Ready",
      videoDetected: true,
    });
    playbackRateRequests = [];
    toggleRequests = [];
    playbackDeferreds = [];
    toggleDeferreds = [];

    global.TuneShiftCore = core;
    global.chrome = {
      tabs: {
        query: vi.fn((_query, callback) => {
          callback([
            {
              id: 1,
              url: "https://www.youtube.com/watch?v=test",
            },
          ]);
        }),
      },
      runtime: {
        lastError: null,
        sendMessage: vi.fn((message, callback) => {
          if (message.type === core.MESSAGE_TYPES.GET_TAB_STATE) {
            callback({
              ok: true,
              state: currentState,
            });
            return;
          }

          if (message.type === core.MESSAGE_TYPES.SET_PLAYBACK_RATE) {
            playbackRateRequests.push(message.playbackRate);
            const deferred = createDeferred();
            playbackDeferreds.push(() => {
              currentState = core.mergeTabState(currentState, {
                enabled: message.playbackRate !== 1 ? true : currentState.enabled,
                playbackRate: message.playbackRate,
              });
              callback({
                ok: true,
                state: currentState,
              });
              deferred.resolve();
            });
            return;
          }

          if (message.type === core.MESSAGE_TYPES.SET_ENABLED) {
            toggleRequests.push(message.enabled);
            const deferred = createDeferred();
            toggleDeferreds.push(() => {
              currentState = core.mergeTabState(currentState, {
                enabled: message.enabled,
              });
              callback({
                ok: true,
                state: currentState,
              });
              deferred.resolve();
            });
            return;
          }

          callback({
            ok: true,
            state: currentState,
          });
        }),
      },
    };

    vi.stubGlobal("setInterval", vi.fn(() => 1));
    window.setInterval = global.setInterval;

    const popupPath = path.resolve(__dirname, "../extension/popup.js");
    delete require.cache[popupPath];
    require(popupPath);
    await flushMicrotasks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete global.chrome;
    delete global.TuneShiftCore;
    document.body.innerHTML = "";
  });

  it("queues rapid tempo increments and uses the optimistic local state for the next step", async () => {
    const increaseButton = document.getElementById("tempo-increase-button");

    increaseButton.click();
    increaseButton.click();
    await flushMicrotasks();

    expect(playbackRateRequests).toEqual([1.15]);

    playbackDeferreds.shift()();
    await flushMicrotasks();

    expect(playbackRateRequests).toEqual([1.15, 1.25]);

    playbackDeferreds.shift()();
    await flushMicrotasks();

    expect(document.getElementById("tempo-value").textContent).toBe("1.25x");
  });

  it("queues rapid toggle clicks so the second click applies the opposite power state", async () => {
    const powerButton = document.getElementById("toggle-button");

    powerButton.click();
    powerButton.click();
    await flushMicrotasks();

    expect(toggleRequests).toEqual([true]);

    toggleDeferreds.shift()();
    await flushMicrotasks();

    expect(toggleRequests).toEqual([true, false]);

    toggleDeferreds.shift()();
    await flushMicrotasks();

    expect(powerButton.classList.contains("on")).toBe(false);
  });
});
