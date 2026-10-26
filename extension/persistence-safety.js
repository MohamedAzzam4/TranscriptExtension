(() => {
  if (globalThis.DubPersistenceSafety) return;
  const learning = globalThis.DubTranscriptLearning;
  // Explicit persisted contracts. Acquisition objects never cross this boundary.
  const experimentFields = new Set('schemaVersion id createdAt finishedAt platform page audioLanguage captionLanguage captionsUsedAsInput settings pipeline epochs asrSegments captionSegments evaluation audioCoverage runtimeSamples transcriptReference'.split(' '));
  const pageFields = new Set('title url videoIdentity playerFrameUrl duration'.split(' '));
  const libraryFields = new Set('schemaVersion key identity title url platform audioLanguage duration segmentCount sourceExperimentId savedAt updatedAt segments bytes'.split(' '));
  const vocabularyFields = new Set('word normalizedWord title germanDefinition germanDefinitions senses lemma definitionLemma example exampleTranslation examples isVerb pronunciation grammar context contextTranslation clip video germanSourceUrl dictionaryContract savedAt englishDefinition englishDefinitions englishSourceUrl directMeanings partOfSpeech grammarNotes'.split(' '));
  const nestedFields = new Set(('id key identity title url videoIdentity playerFrameUrl platform audioLanguage captionLanguage createdAt finishedAt savedAt updatedAt schemaVersion '
    + 'requested mode status sourceKind sourceHost sourceExperimentId sourceTranscriptSavedAt transcriptIdentity transcriptKey transcriptReference selectedAudioTrack selectedAudio audioTrack '
    + 'model device computeType beamSize duration progress downloadProgress downloadedBytes downloadBytesPerSecond decodeProgress decodedSeconds acquisitionKind fallbackReason fallbackError '
    + 'diagnostics discoveryDiagnostics candidateSummary candidates diagnosticsVersion version attempts selectedAttempt browserDecoder state phase kind reason error message action label value code '
    + 'attempt index startedAt completedAt elapsedSeconds elapsedMs bytes totalBytes bytesPerSecond mediaSeconds decodedFrames decodedSamples sampleRate channels codec container supported available '
    + 'webCodecsSupported audioContextAvailable webCodecsAvailable browserAudioDecodeAvailable decodedSeconds pcmSeconds transferredBytes chunkCount chunkIndex sourceCount sourceIndex host protocol '
    + 'language role selected trackId representationCount mimeType codecs bitrate sampleRate sampleRateHz channelCount bandwidth contentType label '
    + 'start end text complete boundary words word mediaTime currentTime playbackRate playing paused epochId mediaStart anchored reason wallTime elapsed recognition latency '
    + 'serverUrl batchModel syncOffset captionPreferences translationPreferences collectCaptions enabled targetLanguage provider fontSize horizontalPosition verticalPosition backgroundOpacity '
    + 'textOpacity textColor backgroundColor fontFamily edgeStyle bold summary preterite present infinitive participle auxiliary perfect separable cases governments conjugations sectionId tense mood person form '
    + 'senseId senseIds sourceSenseId sourceSenseIds definition government german source unassigned examples timing title key platform auxiliaries baseForms '
    + 'coverage coverageStart coverageEnd coverageSeconds coverageRatio ranges count segmentCount wordCount cueCount coveredDuration '
    + 'asrWordCount captionWordCount agreementEstimate sampledAt sampleDuration note status boundary ratio coveragePercent '
    + 'expectedDuration actualDuration durationDelta timingSource timing wordTiming fingerprint sourceVersion sourceLanguage transcriptHash sourceSegmentCount originalSegmentCount '
    + 'epochCount sampleCount textLength captureMode frameCount inspectedFrameCount accessibleFrameCount blockedFrameCount successfulFrameCount frameId readyState width height visible sourceType '
    + 'contentHash libraryKey segmentCount committedSegmentCount asrSegmentCount captionSegmentCount processingLag mediaClock recognizerReady stabilizationDelay at anchoredAt '
    + 'browserAudioFallback browserDecodeAttempted candidateCount candidateIndex containerFormat currentSourceKind dash decodedDuration decoding details discovery discoveryKind discoverySource '
    + 'durationHint durationSeconds environment expectedBytes extensionVersion failureCategory failureMessage hls implementation inspectedRepresentationCount inspectionError isolatedBridge '
    + 'layout level libavcodecVersion mainWorldObserver mainWorldVersion mediaFrameId mediaSegmentCount name networkObserver observedAt observedFrameId observerInjection observerReportedDrm '
    + 'offlineAudioContextAvailable percent playlistType profile profileHint protectedPlaybackObserved protectionDetectedCount pyavVersion pythonVersion receivedBytes remainingTimeTranscription '
    + 'replay replayHeaderNames representationIndex representationKey requestedLanguage responseStatus restoredFrom running scope selectedAudioRendition selectedByPlayer selectedChildHost '
    + 'stage statusHistory strategy transcribing type userAgentFamily variantCount worker workerVersion wrappedSegmentCount wrapperKind '
    + 'attemptKey sourceAttempt availableAudioLanguages audioRenditionCount hasLiveBuffer captionsUsedAsInput modelName beamSize '
    + 'finalError category batchDuration batchJobId availableAudioLanguages bridgeVersion mainWorldVersion workerVersion '
    + 'accountDataStored alignment alignmentStatus application audioStored browserLanguage captionSegmentCount collectedAt collectedLanguage collector command '
    + 'contextTypes cookiesStored csv default detectedLanguage documentTitle documentUrls downloadableId encryptedEventObserved entries episodeNumber episodeTitle '
    + 'files formatId formatversion frameCount headersStored injectImmediately injected japanese jpn jobId justification lastReport lastSnapshotAt layout '
    + 'licenseTrafficInspected mediaKeysAttached mediaUrlsStored method netflixId origin pageObserver privacy prop protection queryTokensStored queued reasons referer referrer '
    + 'releaseYear replayHeaderNames reportCount representationGroups requestType resetTranslationCache sameLanguageSubtitleCount seasonNumber selectedRole seriesId seriesTitle '
    + 'sourceCandidates sourceText subtitles subtitleConclusion target tracks translatedAt translatedText visibleTitleText world wrapping '
    + 'eligible reason message urlHost format formatId extension languageHint audioRole channelCount sourceKind isDefault audioOnly sourceIdentity requestIdentity '
    + 'transcriptSavedAt transcriptFingerprint segmentFingerprint audioSeconds mediaSecondsSent receivedAt timestamp offset pipelineMode stoppedAt endReason').split(/\s+/));
  const forbidden = /^(?:cookie|cookies|authorization|headers|requestHeaders|responseHeaders|apiKey|googleApiKey|password|username|token|sig|signature|signedUrl|sourceUrl|mediaUrl|audioUrl|manifestUrl|pcm|audio|compressedAudio|audioBytes|data|base64|drm|drmMaterial|license|licenseUrl|keys|secret)$/i;
  function cleanString(value, key) {
    if (key === 'serverUrl') {
      try {
        const url = new URL(value);
        if (!/^(?:wss?|https?):$/.test(url.protocol)) return null;
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.toString();
      } catch { return null; }
    }
    if (/^(?:url|playerFrameUrl|serverUrl|germanSourceUrl|englishSourceUrl)$/i.test(key)) return learning.stablePageUrl(value);
    return value.replace(/https?:\/\/[^\s<>"„“]+/gi, raw => learning.stablePageUrl(raw) || '[removed-url]')
      .replace(/\b(?:Bearer\s+)[\w.+/=-]+/gi, '[removed-authorization]')
      .replace(/\b(token|sig|signature|api[_-]?key|password|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi, '$1=[removed]');
  }
  function project(value, fields = nestedFields, key = '', depth = 0) {
    if (depth > 32) return null;
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return cleanString(value, key);
    if (Array.isArray(value)) return value.map(item => project(item, fields, key, depth + 1));
    const output = {};
    for (const [name, item] of Object.entries(value)) {
      if (!fields.has(name) || forbidden.test(name)) continue;
      const childFields = name === 'page' ? pageFields : nestedFields;
      output[name] = project(item, childFields, name, depth + 1);
    }
    return output;
  }
  function sanitizeRecord(key, value) {
    if (key === 'savedVocabulary') return (Array.isArray(value) ? value : []).map(item => project(item, vocabularyFields));
    if (key.startsWith('experiment:')) return project(value, experimentFields);
    if (key.startsWith('transcript-library:')) return project(value, libraryFields);
    if (key === 'transcriptLibraryIndex') return project(value, libraryFields);
    // Research has its own source-honest projection; no opaque transport fields
    // are accepted by the general experiment/library contracts above.
    return value;
  }
  function sanitizeUpdate(update) {
    return Object.fromEntries(Object.entries(update).map(([key, value]) => [key, sanitizeRecord(key, value)]));
  }
  globalThis.DubPersistenceSafety = Object.freeze({ sanitizeRecord, sanitizeUpdate, project });
})();
