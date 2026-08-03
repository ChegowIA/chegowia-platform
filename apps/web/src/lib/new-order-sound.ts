let audioContext: AudioContext | null = null;
let unlocked = false;
let activeAlertTimers: number[] = [];

function context() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) audioContext = new AudioContextCtor();
  return audioContext;
}

export async function unlockNewOrderSound() {
  const ctx = context();
  if (!ctx || unlocked) return;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ctx.destination);
  const oscillator = ctx.createOscillator();
  oscillator.connect(gain);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.01);
  unlocked = true;
}

export async function playNewOrderSound() {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

  const now = ctx.currentTime + 0.02;
  playCashierCall(ctx, now);
  playCashierCall(ctx, now + 0.78);
}

export function playNewOrderAlert(repetitions = 4) {
  activeAlertTimers.forEach((timer) => window.clearTimeout(timer));
  activeAlertTimers = [];
  const safeRepetitions = Math.max(1, Math.min(8, Math.floor(repetitions)));
  for (let repetition = 0; repetition < safeRepetitions; repetition += 1) {
    activeAlertTimers.push(window.setTimeout(() => playNewOrderSound(), repetition * 2_000));
  }
}

function playCashierCall(ctx: AudioContext, startAt: number) {
  playBellStrike(ctx, startAt);
  playBellTone(ctx, startAt, 1046.5, 0.36, 0.16);
  playBellTone(ctx, startAt + 0.18, 784, 0.44, 0.14);
  playCallPulse(ctx, startAt + 0.52, 587.33, 0.1);
  playCallPulse(ctx, startAt + 0.65, 587.33, 0.1);
}

function playBellTone(ctx: AudioContext, startAt: number, frequency: number, duration: number, volume: number) {
  const partials = [
    { frequency, volume, duration },
    { frequency: frequency * 2.01, volume: volume * 0.32, duration: duration * 0.7 },
    { frequency: frequency * 3.08, volume: volume * 0.16, duration: duration * 0.42 },
  ];

  partials.forEach((partial) => {
    playTone(ctx, startAt, partial.frequency, partial.duration, partial.volume, "triangle");
  });
}

function playCallPulse(ctx: AudioContext, startAt: number, frequency: number, duration: number) {
  playTone(ctx, startAt, frequency, duration, 0.12, "square");
  playTone(ctx, startAt + 0.012, frequency * 1.5, duration * 0.75, 0.035, "sine");
}

function playBellStrike(ctx: AudioContext, startAt: number) {
  const duration = 0.07;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i += 1) {
    const decay = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * decay * decay;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(2200, startAt);
  filter.Q.setValueAtTime(9, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(startAt);
  source.stop(startAt + duration + 0.02);
}

function playTone(
  ctx: AudioContext,
  startAt: number,
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType,
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}
