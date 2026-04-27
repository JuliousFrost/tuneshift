(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.TuneShiftStreamSource = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class StreamingAudioSource {
    constructor(options) {
      const maxFrames = Number(options?.maxFrames);
      this.maxFrames = Number.isFinite(maxFrames) && maxFrames > 0 ? Math.floor(maxFrames) : 16384;
      this.buffer = new Float32Array(this.maxFrames * 2);
      this.readIndex = 0;
      this.writeIndex = 0;
      this.frameCount = 0;
    }

    get availableFrames() {
      return this.frameCount;
    }

    clear() {
      this.readIndex = 0;
      this.writeIndex = 0;
      this.frameCount = 0;
      this.buffer.fill(0);
    }

    append(leftChannel, rightChannel) {
      if (!leftChannel?.length) {
        return;
      }

      const frameCount = leftChannel.length;
      const right = rightChannel?.length ? rightChannel : leftChannel;

      for (let index = 0; index < frameCount; index += 1) {
        if (this.frameCount === this.maxFrames) {
          this.readIndex = (this.readIndex + 1) % this.maxFrames;
          this.frameCount -= 1;
        }

        const writeOffset = this.writeIndex * 2;
        this.buffer[writeOffset] = leftChannel[index];
        this.buffer[writeOffset + 1] = right[index] ?? leftChannel[index];
        this.writeIndex = (this.writeIndex + 1) % this.maxFrames;
        this.frameCount += 1;
      }
    }

    extract(target, numFrames) {
      if (!target || !numFrames || this.frameCount === 0) {
        return 0;
      }

      const framesToRead = Math.min(numFrames, this.frameCount);
      for (let index = 0; index < framesToRead; index += 1) {
        const readOffset = this.readIndex * 2;
        const targetOffset = index * 2;
        target[targetOffset] = this.buffer[readOffset];
        target[targetOffset + 1] = this.buffer[readOffset + 1];
        this.readIndex = (this.readIndex + 1) % this.maxFrames;
      }

      this.frameCount -= framesToRead;
      return framesToRead;
    }
  }

  return {
    StreamingAudioSource,
  };
});
