(() => {
  if (globalThis.DubYouTubeCaptions) return;
  const language = value => String(value || '').toLowerCase().replace(/_/g, '-').slice(0, 32);
  const baseLanguage = value => language(value).split('-')[0];
  function videoId(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== 'youtu.be') return null;
      const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }
  function captionUrl(value, id, target = '') {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password
      || !/(^|\.)(?:youtube\.com|video\.google\.com)$/.test(url.hostname)
      || !/^\/(?:api\/)?timedtext$/.test(url.pathname)
      || (url.searchParams.has('v') && url.searchParams.get('v') !== id)) throw new Error('Invalid YouTube caption source.');
    if (url.searchParams.has('tlang') && !target) throw new Error('A translated track cannot be the source transcript.');
    url.searchParams.set('fmt', 'json3');
    if (target) url.searchParams.set('tlang', language(target));
    return url.href;
  }
  function tracks(raw, id) {
    return (Array.isArray(raw) ? raw : []).slice(0, 150).flatMap(item => {
      try {
        const url = captionUrl(item.baseUrl || item.url, id);
        const lang = language(item.languageCode || item.language || new URL(url).searchParams.get('lang'));
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(lang)) return [];
        const kind = item.kind === 'asr' || item.kind === 'automatic' ? 'automatic' : 'manual';
        const name = String(item.name?.simpleText || item.name?.runs?.map(run => run.text).join('') || item.name || lang).slice(0, 180);
        const rawId = String(item.vssId || item.id || '');
        const trackId = /^[\w.:-]{1,180}$/.test(rawId) ? rawId : `${kind}:${lang}`;
        return [{ id: trackId, language: lang, kind, name, url, translatable: item.isTranslatable === true || item.translatable === true }];
      } catch { return []; }
    });
  }
  function selectTrack(values, requestedLanguage, selectedId = '') {
    const eligible = values.filter(track => baseLanguage(track.language) === baseLanguage(requestedLanguage));
    if (selectedId && selectedId !== 'auto') return eligible.find(track => track.id === selectedId) || null;
    return [...eligible].sort((a, b) => (a.kind === 'automatic') - (b.kind === 'automatic')
      || (a.language !== language(requestedLanguage)) - (b.language !== language(requestedLanguage)))[0] || null;
  }
  function estimatedWords(text, start, end) {
    const tokens = text.match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || [];
    return tokens.map((text, index) => ({ text, start: start + (end - start) * index / tokens.length,
      end: start + (end - start) * (index + 1) / tokens.length }));
  }
  function normalizeCues(values, duration = 0) {
    if (!Array.isArray(values) || values.length > 50000) throw new Error('Invalid or oversized caption track.');
    const cues = [];
    for (const raw of values) {
      const start = Number(raw.start), end = Number(raw.end);
      const text = String(raw.text || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || text.length > 2000
        || (duration > 0 && end > duration + 30)) throw new Error('Caption timing is invalid for this video.');
      const previous = cues.at(-1);
      if (previous && start < previous.start) throw new Error('Caption track is not ordered.');
      if (previous && start < previous.end && (start === previous.start || text === previous.text || text.startsWith(previous.text))) {
        previous.text = text; previous.end = Math.max(previous.end, end);
        previous.words = estimatedWords(text, previous.start, previous.end); previous.timing = 'estimated-within-cue';
        continue;
      }
      if (previous && start < previous.end) {
        previous.end = start;
        previous.words = estimatedWords(previous.text, previous.start, start);
      }
      const words = Array.isArray(raw.words) ? raw.words : [];
      const validWords = words.length <= 2000 && words.length && words.every(word => typeof word.text === 'string'
        && Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)) && word.end > word.start && word.start >= start && word.end <= end);
      cues.push({ id: `youtube:${cues.length}`, start, end, text, complete: true, boundary: 'sentence',
        timing: raw.timing === 'platform-word-offsets' && validWords ? raw.timing : 'estimated-within-cue',
        words: validWords ? words.map(word => ({ text: word.text.slice(0, 100), start: Number(word.start), end: Number(word.end) })) : estimatedWords(text, start, end) });
    }
    if (!cues.length) throw new Error('YouTube returned an empty caption track.');
    return cues;
  }
  function parseJson3(payload, duration = 0) {
    const values = [];
    for (const event of payload.events || []) {
      const text = (event.segs || []).map(segment => String(segment.utf8 || '')).join('').replace(/\u200b/g, '');
      if (!text.trim()) continue;
      const start = Number(event.tStartMs) / 1000;
      const end = start + Number(event.dDurationMs || 0) / 1000;
      const previous = values.at(-1);
      if (event.aAppend && previous) {
        previous.text += text; previous.end = Math.max(previous.end, end);
        delete previous.words; delete previous.timing;
        continue;
      }
      const parts = (event.segs || []).filter(segment => String(segment.utf8 || '').trim());
      const precise = parts.length && parts.every(segment => Number.isFinite(Number(segment.tOffsetMs))
        && (String(segment.utf8).match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || []).length === 1);
      const words = precise ? parts.map((segment, index) => ({
        text: String(segment.utf8).match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/u)[0],
        start: start + Number(segment.tOffsetMs) / 1000,
        end: index + 1 < parts.length ? start + Number(parts[index + 1].tOffsetMs) / 1000 : end
      })) : [];
      values.push({ text, start, end, ...(words.length && words.every(word => word.end > word.start && word.start >= start && word.end <= end)
        ? { words, timing: 'platform-word-offsets' } : {}) });
    }
    values.forEach((cue, index) => { if (cue.end <= cue.start) cue.end = values[index + 1]?.start || cue.start + 2; });
    return normalizeCues(values, duration);
  }
  function alignTranslation(cues, start, end) {
    return cues.filter(cue => Math.min(end, cue.end) - Math.max(start, cue.start) > 0)
      .map(cue => cue.text).filter((text, index, all) => index === 0 || text !== all[index - 1]).join(' ');
  }
  function cacheIdentity(id, track) {
    if (!/^[\w-]{11}$/.test(id) || !/^[\w.:-]{1,180}$/.test(track?.id || '')
      || !/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(track?.language || '') || !['manual', 'automatic'].includes(track.kind)) throw new Error('Invalid caption cache identity.');
    return `youtube:${id}|${track.language}|captions:${encodeURIComponent(track.id)}:${track.kind}`;
  }
  globalThis.DubYouTubeCaptions = Object.freeze({ language, baseLanguage, videoId, captionUrl, tracks, selectTrack, normalizeCues, parseJson3, alignTranslation, cacheIdentity });
})();
