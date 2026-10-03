// The two-note ding Taro plays in the call, made with Web Audio from the same recipe as
// makeDingPcm in packages/api/src/services/audio.ts: C6 then E6, 240 ms each, 30 ms apart,
// each a sine plus its second harmonic at a quarter level, decaying as exp(-3t).
// Call it only from a click; it never autoplays.
export function playDing(): void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const TONE = 0.24, GAP = 0.03, ATTACK = 0.0075, RELEASE = 0.0125, STEPS = 96;
  const master = ctx.createGain();
  master.gain.value = 0.2;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;
  [1046.5, 1318.5].forEach((freq, i) => {
    const start = t0 + i * (TONE + GAP);
    const env = ctx.createGain();
    env.gain.value = 0;
    const curve = new Float32Array(STEPS);
    for (let s = 0; s < STEPS; s++) {
      const t = (s / (STEPS - 1)) * TONE;
      const attack = t < ATTACK ? t / ATTACK : 1;
      const release = t > TONE - RELEASE ? Math.max(0, (TONE - t) / RELEASE) : 1;
      curve[s] = Math.exp(-3 * t) * attack * release;
    }
    env.gain.setValueCurveAtTime(curve, start, TONE);
    env.connect(master);
    for (const [f, amp] of [[freq, 1], [freq * 2, 0.25]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.value = amp;
      osc.connect(g).connect(env);
      osc.start(start);
      osc.stop(start + TONE + 0.01);
    }
  });
  window.setTimeout(() => void ctx.close(), 1000);
}
