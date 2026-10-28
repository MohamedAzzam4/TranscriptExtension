(() => {
  function createHoverPause({ media, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let owned = false, expectedPause = false, leaving = null, enabled = false;
    function interrupt() { owned = false; expectedPause = false; }
    function release(resume = true) {
      clearTimer(leaving); leaving = null;
      const shouldResume = resume && owned && media.paused && !media.ended;
      interrupt();
      if (shouldResume) void Promise.resolve(media.play()).catch(() => {});
    }
    function enter() {
      clearTimer(leaving); leaving = null;
      if (!enabled || owned || media.paused || media.ended) return;
      owned = true; expectedPause = true;
      media.pause();
    }
    function leave() { clearTimer(leaving); leaving = setTimer(() => release(), 0); }
    function onPause() { if (expectedPause) expectedPause = false; else interrupt(); }
    media.addEventListener('pause', onPause);
    media.addEventListener('play', interrupt);
    return { enter, leave, interrupt, release,
      configure(value) { enabled = Boolean(value); if (!enabled) release(); },
      dispose(resume = false) { release(resume); media.removeEventListener('pause', onPause); media.removeEventListener('play', interrupt); } };
  }
  globalThis.DubWordInteractions = { createHoverPause };
})();
