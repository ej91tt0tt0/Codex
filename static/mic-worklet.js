class AsterMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const count = Math.min(input.length - offset, this.samples.length - this.offset);
      this.samples.set(input.subarray(offset, offset + count), this.offset);
      this.offset += count;
      offset += count;
      if (this.offset === this.samples.length) {
        const packet = this.samples;
        this.port.postMessage(packet, [packet.buffer]);
        this.samples = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('yorisoi-microphone', AsterMicrophone);
