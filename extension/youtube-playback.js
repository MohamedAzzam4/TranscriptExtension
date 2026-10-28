(() => {
  // One start attempt belongs to a video visit, not to subtitle retries. State
  // survives media-element replacement so a user's pause is never reset by it.
  function create({ media, state, eligible, report }) {
    let disposed = false;
    const played = () => { state.finished = true; report('', 'Playing'); };
    const paused = () => { if (!state.attempted) state.finished = true; };
    media.addEventListener('play', played);
    media.addEventListener('pause', paused);
    function interrupt() { state.finished = true; }
    async function tick() {
      if (disposed || state.finished || state.attempted) return;
      if (!eligible()) return;
      if (!media.paused || media.ended) { state.finished = true; return; }
      if (media.readyState < 2) return;
      state.attempted = true;
      try {
        await media.play();
        if (!disposed && !state.finished) { state.finished = true; report('', 'Automatic playback started'); }
      } catch (error) {
        if (disposed || state.finished) return;
        state.finished = true;
        const message = error.name === 'NotAllowedError'
          ? 'Chrome blocked automatic playback — press Play.'
          : 'Automatic playback could not start — press Play.';
        report(message, message);
      }
    }
    return { tick, interrupt, dispose() {
      disposed = true;
      media.removeEventListener('play', played); media.removeEventListener('pause', paused);
    } };
  }
  globalThis.DubYouTubePlayback = { create };
})();
