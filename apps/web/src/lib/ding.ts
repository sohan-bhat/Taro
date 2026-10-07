// The chime Taro plays in the call (public/taro-chime.wav, the same sound the API sends into
// meetings). Call it only from a click; it never autoplays.
export function playDing(): void {
  const audio = new Audio('/taro-chime.wav');
  audio.volume = 0.6;
  void audio.play().catch(() => {});
}
