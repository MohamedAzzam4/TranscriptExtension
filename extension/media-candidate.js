(() => {
  if (globalThis.DubTranscriptMediaCandidate?.version === 1) return;

  function classify(url, contentType = "", baseUrl = "") {
    let pathname = "";
    try {
      pathname = new URL(String(url || ""), baseUrl || undefined).pathname;
    } catch {
      pathname = String(url || "").split(/[?#]/, 1)[0];
    }
    const value = `${pathname} ${contentType || ""}`.toLowerCase();
    if (/\.m3u8(?:$|[\s?#])|mpegurl/.test(value)) return "hls";
    if (/\.mpd(?:$|[\s?#])|dash\+xml/.test(value)) return "dash";
    if (/\.(?:m4a|mp3|aac|oga|ogg|opus)(?:$|[\s?#])|audio\//.test(value)) {
      return "audio";
    }
    if (/\.(?:mp4|webm|mov|mkv)(?:$|[\s?#])|video\//.test(value)) return "media";
    if (/(?:videoplayback|manifest|playlist)(?:[\s/?#=&.-]|$)/.test(value)) {
      return "unknown-media";
    }
    return null;
  }

  globalThis.DubTranscriptMediaCandidate = Object.freeze({
    version: 1,
    classify
  });
})();
