const path = require("path");

const core = require("../extension/lib/tuneshift-core.js");

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("background message handling", () => {
  let messageListener;

  beforeEach(() => {
    vi.resetModules();
    messageListener = null;

    global.TuneShiftCore = core;
    global.importScripts = vi.fn(() => {});
    global.chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener: vi.fn((listener) => {
            messageListener = listener;
          }),
        },
      },
      tabs: {
        sendMessage: vi.fn((tabId, message, callback) => {
          callback({
            ok: true,
            state: message.state,
          });
        }),
        onRemoved: {
          addListener: vi.fn(),
        },
        onUpdated: {
          addListener: vi.fn(),
        },
      },
    };

    const backgroundPath = path.resolve(__dirname, "../extension/background.js");
    delete require.cache[backgroundPath];
    require(backgroundPath);
  });

  afterEach(() => {
    delete global.chrome;
    delete global.importScripts;
    delete global.TuneShiftCore;
  });

  it("starts the audio pipeline when semitones move away from zero", async () => {
    const sendResponse = vi.fn();

    const keepsPortOpen = messageListener(
      {
        type: core.MESSAGE_TYPES.SET_SEMITONES,
        tabId: 1,
        semitones: 1,
      },
      {},
      sendResponse
    );

    expect(keepsPortOpen).toBe(true);
    await flushMicrotasks();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      state: expect.objectContaining({
        enabled: true,
        semitones: 1,
        pipelineState: "waiting",
      }),
    });
  });
});
