# Local learning and transcript library

Extension 0.8.0 adds learning and persistence features without an AI API.

## Word card

Clicking a caption word requests German and English Wiktionary data and builds a deterministic card. Depending on the source entry, it can show:

- German meanings and a short English gloss.
- The word type and IPA pronunciation.
- Noun article, singular, and plural.
- Verb Präteritum, Partizip II, Perfekt, auxiliary, and separability.
- Up to four examples, with each German sentence immediately followed by its English translation when one is available.
- Source-listed collocations, subject domains, and synonyms.

Unavailable sections are hidden. The extension does not generate simplified meanings, usage-frequency claims, synonym distinctions, or B2 exam advice, because doing so reliably would require a curated linguistic dataset or a language model.

**Replay clip** temporarily plays the selected word and restores the previous time, pause state, and playback rate. Batch transcripts use the recognizer's word timestamps. Live cues without word timestamps use a proportional estimate inside the caption, so their replay boundary can be less precise.

**YouGlish** opens the selected word on the German YouGlish site in a new tab.

## Transcript library

A completed batch transcript is saved automatically. A live transcript is promoted only when its audio coverage forms one continuous range from the beginning to the end of the video. Partial live sessions are never treated as complete.

The identity is derived from the stable page and audio language. For YouTube it uses the video ID; for other sites it uses the host and page path. Expiring media queries, signed URLs, request headers, cookies, DRM data, and API secrets are not saved.

When **Analyze automatically** is clicked again on the same identity, the extension restores the structured cues and starts synchronized playback without launching transcription. The popup's **Saved transcripts** panel supports one-click TXT download and deletion.

The library uses `chrome.storage.local`, is limited to 20 transcripts and approximately 7.5 MB, and disappears if extension storage is cleared. Download important transcripts as UTF-8 text for durable storage.
