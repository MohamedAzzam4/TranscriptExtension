(() => {
  if (window.__dubYouTubeBridge) return;
  window.__dubYouTubeBridge = true;
  // Page objects are untrusted; return only caption metadata, never the full
  // player response, cookies, account data or audio representations.
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.type !== 'DUB_YT_METADATA_REQUEST'
      || !/^[\w-]{11}$/.test(request.videoId || '') || typeof request.requestId !== 'string' || request.requestId.length > 100) return;
    const player = document.querySelector('#movie_player');
    let snapshot = null;
    try {
      let response = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      if (typeof response === 'string') response = JSON.parse(response);
      if (response?.videoDetails?.videoId !== request.videoId) throw new Error('Player response belongs to another video.');
      const captions = response.captions?.playerCaptionsTracklistRenderer;
      const audio = player?.getAudioTrack?.();
      snapshot = { videoId: response.videoDetails.videoId, title: response.videoDetails.title,
        duration: Number(response.videoDetails.lengthSeconds) || 0,
        isLive: response.videoDetails.isLive === true || response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true,
        audioLanguage: typeof audio?.languageCode === 'string' ? audio.languageCode : '',
        tracks: (captions?.captionTracks || []).slice(0, 150).map(track => ({
          baseUrl: String(track.baseUrl || '').slice(0, 32000), languageCode: track.languageCode,
          kind: track.kind, vssId: track.vssId, name: track.name, isTranslatable: track.isTranslatable
        })),
        translationLanguages: (captions?.translationLanguages || []).map(item => item.languageCode).slice(0, 300) };
    } catch { /* The isolated adapter retries while a new player is initializing. */ }
    window.postMessage({ type: 'DUB_YT_METADATA_RESPONSE', requestId: request.requestId, snapshot }, location.origin);
  });
})();
