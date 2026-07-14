class Pcm16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.chunkLength = Math.round(sampleRate * 0.5);
    this.port.onmessage = (event) => {
      if (event.data?.type === "reset") this.samples.length = 0;
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;

    for (let frame = 0; frame < channels[0].length; frame += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[frame] || 0;
      this.samples.push(mixed / channels.length);
    }

    while (this.samples.length >= this.chunkLength) {
      const source = this.samples.splice(0, this.chunkLength);
      const pcm = this.resampleTo16Khz(source);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }

  resampleTo16Khz(source) {
    const targetLength = 8000;
    const result = new Int16Array(targetLength);
    const ratio = source.length / targetLength;

    for (let target = 0; target < targetLength; target += 1) {
      const start = Math.floor(target * ratio);
      const end = Math.max(start + 1, Math.floor((target + 1) * ratio));
      let total = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
        total += source[sourceIndex] || 0;
      }
      const sample = Math.max(-1, Math.min(1, total / (end - start)));
      result[target] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return result;
  }
}

registerProcessor("pcm16-worklet", Pcm16Worklet);

