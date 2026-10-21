// All sound is synthesized with Web Audio: zero audio downloads.
// Footsteps are the core mechanic, so they are spatialized with HRTF panners.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private ambience: AudioNode[] = [];

  get ready(): boolean {
    return this.ctx !== null;
  }

  // Must run inside a user gesture.
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    if (this.ctx) this.master.gain.value = v;
  }

  setListener(pos: Vec3, fwd: Vec3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  private out(pos: Vec3 | null, maxDist: number): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return this.sfx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = 1;
    p.maxDistance = maxDist;
    p.rolloffFactor = 1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.sfx);
    return p;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    return src;
  }

  private thump(dest: AudioNode, t: number, f0: number, f1: number, dur: number, gain: number): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private cleanup(src: AudioScheduledSourceNode, node: AudioNode): void {
    if (node !== this.sfx) src.onended = () => node.disconnect();
  }

  footstep(pos: Vec3 | null, heavy: boolean, vol = 1, maxDist = 12): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = this.out(pos, maxDist);
    if (heavy) {
      this.noiseBurst(dest, t, 0.18, 'lowpass', 700, 0.7, 0.9 * vol);
      const o = this.thump(dest, t, 95, 42, 0.22, 1.1 * vol);
      if (Math.random() < 0.18) this.boardCreak(dest, t + 0.05, 0.25 * vol);
      this.cleanup(o, dest);
    } else {
      const s = this.noiseBurst(dest, t, 0.08, 'bandpass', 1500 + Math.random() * 500, 1.2, 0.35 * vol);
      this.thump(dest, t, 160, 80, 0.07, 0.25 * vol);
      this.cleanup(s, dest);
    }
  }

  private boardCreak(dest: AudioNode, t: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 260 + Math.random() * 120;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.35);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const lg = ctx.createGain();
    lg.gain.value = 25;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.45);
    lfo.stop(t + 0.45);
  }

  doorCreak(pos: Vec3, opening: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = this.out(pos, 22);
    this.boardCreak(dest, t, 0.5);
    this.boardCreak(dest, t + 0.18, 0.35);
    const o = this.thump(dest, t + (opening ? 0.02 : 0.32), 120, 50, 0.25, opening ? 0.3 : 0.9);
    this.cleanup(o, dest);
  }

  wardrobe(pos: Vec3): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dest = this.out(pos, 14);
    this.boardCreak(dest, t, 0.25);
    const o = this.thump(dest, t + 0.2, 140, 60, 0.2, 0.6);
    this.cleanup(o, dest);
  }

  // Sudden swipe + dissonant cluster when someone is tagged.
  sting(near: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const vol = near ? 0.32 : 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    g.connect(this.sfx);
    for (const f of [233, 247, 349, 370, 466]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.06, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      o.connect(lp).connect(g);
      o.start(t);
      o.stop(t + 1.7);
    }
    this.noiseBurst(this.sfx, t, 0.35, 'highpass', 900, 0.5, near ? 0.5 : 0.15);
    if (near) this.thump(this.sfx, t, 80, 30, 0.6, 1);
  }

  // Lantern sputter: quick crackle when your light gutters.
  sputter(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.noiseBurst(this.sfx, t + i * 0.035 + Math.random() * 0.02, 0.03, 'highpass', 2500, 0.7, 0.12);
    this.noiseBurst(this.sfx, t, 0.15, 'bandpass', 500, 1.5, 0.08);
  }

  heartbeat(vol: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.thump(this.sfx, t, 62, 40, 0.16, 0.7 * vol);
    this.thump(this.sfx, t + 0.2, 55, 38, 0.2, 0.5 * vol);
  }

  tick(high = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.value = high ? 1320 : 880;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
  }

  // Deep church-bell style toll: hunt begins / round over.
  bell(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, a] of [[110, 0.5], [220, 0.25], [264, 0.18], [330, 0.12], [440, 0.08]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 3.6);
    }
  }

  startAmbience(): void {
    if (!this.ctx || this.ambience.length) return;
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
    bus.connect(this.master);
    for (const f of [55, 58.3, 82.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      o.connect(g).connect(bus);
      o.start();
      this.ambience.push(o);
    }
    // wind: looping noise through slowly swept bandpass
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(bus);
    src.start();
    lfo.start();
    this.ambience.push(src, lfo, bus);
  }

  stopAmbience(): void {
    for (const n of this.ambience) {
      if (n instanceof AudioScheduledSourceNode) n.stop();
      n.disconnect();
    }
    this.ambience = [];
  }
}
