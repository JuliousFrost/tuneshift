const { StreamingAudioSource } = require("../extension/lib/tuneshift-stream-source.js");

describe("StreamingAudioSource", () => {
  it("extracts appended stereo samples in order", () => {
    const source = new StreamingAudioSource({ maxFrames: 8 });
    const left = new Float32Array([0.1, 0.2, 0.3]);
    const right = new Float32Array([0.4, 0.5, 0.6]);
    const target = new Float32Array(6);

    source.append(left, right);
    const extractedFrames = source.extract(target, 3, 0);

    expect(extractedFrames).toBe(3);
    expect(Array.from(target)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.1, 5),
        expect.closeTo(0.4, 5),
        expect.closeTo(0.2, 5),
        expect.closeTo(0.5, 5),
        expect.closeTo(0.3, 5),
        expect.closeTo(0.6, 5),
      ])
    );
    expect(source.availableFrames).toBe(0);
  });

  it("duplicates mono input into both channels", () => {
    const source = new StreamingAudioSource({ maxFrames: 4 });
    const mono = new Float32Array([0.25, -0.25]);
    const target = new Float32Array(4);

    source.append(mono);
    const extractedFrames = source.extract(target, 2, 0);

    expect(extractedFrames).toBe(2);
    expect(Array.from(target)).toEqual([0.25, 0.25, -0.25, -0.25]);
  });

  it("drops the oldest frames when the ring buffer overflows", () => {
    const source = new StreamingAudioSource({ maxFrames: 2 });
    const target = new Float32Array(4);

    source.append(new Float32Array([1, 2]), new Float32Array([10, 20]));
    source.append(new Float32Array([3]), new Float32Array([30]));

    const extractedFrames = source.extract(target, 2, 0);

    expect(extractedFrames).toBe(2);
    expect(Array.from(target)).toEqual([2, 20, 3, 30]);
  });
});
