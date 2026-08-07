(() => {
  if (globalThis.DubTranscriptLocalMedia?.version === 1) return;

  const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const PLAYER_CONTAINER_SELECTOR = [
    "#movie_player",
    ".html5-video-player",
    "[data-uia='video-canvas']",
    "[class*='video-player']",
    "[class*='videoPlayer']",
    "[class*='player-container']"
  ].join(",");

  function authorizedLoopbackOrigin(pageUrl) {
    let parsed;
    try {
      parsed = new URL(String(pageUrl || ""));
    } catch {
      return null;
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed.origin : null;
  }

  function overlayPlacement(video, documentRef) {
    const matched = video?.closest?.(PLAYER_CONTAINER_SELECTOR) || null;
    const fallback = video?.parentElement || null;
    const candidate = matched || fallback;
    const usesDocumentViewport = Boolean(
      candidate
      && documentRef
      && (candidate === documentRef.body || candidate === documentRef.documentElement)
    );
    return {
      container: usesDocumentViewport ? documentRef.documentElement : candidate,
      viewportFixed: usesDocumentViewport
    };
  }

  globalThis.DubTranscriptLocalMedia = Object.freeze({
    version: 1,
    authorizedLoopbackOrigin,
    overlayPlacement
  });
})();
