// One shared AudioContext for editor previews (timeline, asset editor, audio studio). Browsers start it suspended until a user gesture.
export function audioContext(app) {
  if (!app._ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('Web Audio is not available in this browser.'); app._ac = new AC(); }
  return app._ac;
}
export async function playOneShot(app, assetId, { volume = 1, rate = 1, dest = null } = {}) {
  const ac = audioContext(app);
  await ac.resume().catch(() => {});
  const buf = await app.assets.loadAudio(assetId, ac);
  const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = ac.createGain(); g.gain.value = volume;
  src.connect(g); g.connect(dest || ac.destination); src.start();
  return { src, gain: g };
}
