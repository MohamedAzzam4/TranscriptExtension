#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/compare-transcript.mjs <experiment.json>");
  process.exit(1);
}

const experiment = JSON.parse(readFileSync(resolve(input), "utf8"));
const asr = orderedText(experiment.asrSegments || []);
const captions = orderedText(experiment.captionSegments || []);
const hypothesis = tokenize(asr);
const reference = tokenize(captions);

console.log(`Video: ${experiment.page?.title || "Unknown"}`);
console.log(`Audio language: ${experiment.audioLanguage || "unknown"}`);
console.log(`Caption language: ${experiment.captionLanguage || "unknown"}`);
console.log(`ASR segments: ${(experiment.asrSegments || []).length}`);
console.log(`Caption segments: ${(experiment.captionSegments || []).length}`);

if (!reference.length) {
  console.log("\nNo comparison captions were collected; WER cannot be calculated.");
  process.exit(0);
}

if (normalizeLanguage(experiment.audioLanguage) !== normalizeLanguage(experiment.captionLanguage)) {
  console.log("\nWARNING: audio and caption languages differ. WER would not measure transcription accuracy.");
  process.exit(0);
}

const score = wordErrorRate(reference, hypothesis);
const timing = timingSummary(experiment.asrSegments || [], experiment.captionSegments || []);
console.log("\nComparison (captions are the reference):");
console.log(`WER: ${(score.wer * 100).toFixed(2)}%`);
console.log(`Reference words: ${reference.length}`);
console.log(`ASR words: ${hypothesis.length}`);
console.log(`Substitutions: ${score.substitutions}`);
console.log(`Deletions: ${score.deletions}`);
console.log(`Insertions: ${score.insertions}`);
if (timing.medianNearestStartDelta !== null) {
  console.log(`Median nearest segment-start difference: ${timing.medianNearestStartDelta.toFixed(2)}s`);
}
console.log(`Caption timeline covered by ASR: ${(timing.captionCoverage * 100).toFixed(1)}%`);
console.log("\nInterpretation: WER is valid only when captions closely represent the words actually spoken in this audio track.");

function orderedText(segments) {
  return [...segments]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((segment) => segment.text)
    .filter(Boolean)
    .join(" ");
}

function tokenize(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function normalizeLanguage(value) {
  return String(value || "").toLowerCase().split(/[-_]/)[0];
}

function wordErrorRate(referenceWords, hypothesisWords) {
  const columns = hypothesisWords.length + 1;
  let previous = Array.from({ length: columns }, (_value, column) => ({
    cost: column,
    substitutions: 0,
    deletions: 0,
    insertions: column
  }));

  for (let row = 1; row <= referenceWords.length; row += 1) {
    const current = Array(columns);
    current[0] = { cost: row, substitutions: 0, deletions: row, insertions: 0 };
    for (let column = 1; column < columns; column += 1) {
      if (referenceWords[row - 1] === hypothesisWords[column - 1]) {
        current[column] = { ...previous[column - 1] };
        continue;
      }
      const substitution = increment(previous[column - 1], "substitutions");
      const deletion = increment(previous[column], "deletions");
      const insertion = increment(current[column - 1], "insertions");
      current[column] = [substitution, deletion, insertion]
        .sort((a, b) => a.cost - b.cost)[0];
    }
    previous = current;
  }

  const result = previous.at(-1);
  return { ...result, wer: result.cost / referenceWords.length };
}

function increment(cell, operation) {
  return { ...cell, cost: cell.cost + 1, [operation]: cell[operation] + 1 };
}

function timingSummary(asrSegments, captionSegments) {
  const validAsr = asrSegments.filter(validTime);
  const validCaptions = captionSegments.filter(validTime);
  const deltas = validCaptions
    .filter(() => validAsr.length)
    .map((caption) => Math.min(...validAsr.map((segment) => Math.abs(segment.start - caption.start))))
    .sort((a, b) => a - b);

  const totalCaptionDuration = validCaptions.reduce((total, segment) => total + duration(segment), 0);
  const coveredCaptionDuration = validCaptions.reduce((total, caption) => {
    const covered = validAsr.some((asrSegment) => overlap(asrSegment, caption) > 0);
    return total + (covered ? duration(caption) : 0);
  }, 0);

  return {
    medianNearestStartDelta: deltas.length ? median(deltas) : null,
    captionCoverage: totalCaptionDuration ? coveredCaptionDuration / totalCaptionDuration : 0
  };
}

function validTime(segment) {
  return Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start;
}

function duration(segment) {
  return Math.max(0, segment.end - segment.start);
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}
