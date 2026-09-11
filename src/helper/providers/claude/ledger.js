// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Token history, read from the session transcripts Claude Code writes under
// ~/.claude/projects/**/*.jsonl. The API does not expose a per-day or per-model
// breakdown (seven_day_breakdown comes back null), so this is the only source.
//
// Two properties of those files shape everything here:
//
//   * They are append-only, so a scan only ever needs the bytes added since last
//     time. The offsets live in the scan state and make a refresh nearly free.
//   * The same assistant message is written several times as it streams: measured
//     on this machine, 2507 lines for 1240 real messages. Counting them all
//     inflates every total by about 2x, so they must be deduplicated by message id.
//
//     Crucially, the repeats are NOT identical. `output_tokens` grows as the
//     response streams — a real key reads [1, 1, 282] across its three lines — so
//     the LAST occurrence is the complete one. Keeping the first instead
//     undercounts output by about 15%, which is how this was found: cross-checking
//     against ccusage showed a systematic 0.057% shortfall that turned out to sit
//     entirely in output_tokens. Hence the state below keeps one record per
//     message and lets a later occurrence overwrite it, rather than accumulating
//     into day and model buckets that cannot be corrected after the fact.
//
// No file access here: the caller passes in a `readChunk`, which is what lets
// every branch below be tested without a disk. It hands back raw bytes rather
// than a string on purpose — offsets into these files are byte offsets, and a
// transcript containing any non-ASCII character makes character indices and byte
// indices disagree ("acao" with a cedilla is 6 characters but 8 bytes). Scanning
// for the line break at the byte level keeps the resume offset exact.

import {dateKey, earliestInstantFor, weekKeys} from '../../calendar.js';

/** Placeholder model id Claude Code writes for entries with no real inference. */
const SYNTHETIC_MODEL = '<synthetic>';

// Read in bounded windows rather than swallowing a file whole. The first scan
// covers ~100 MB of transcripts, and decoding that in one piece produces enough
// garbage to have GJS collecting while an async GIO callback is in flight — which
// GJS refuses to run, leaving the helper wedged in its main loop forever. Bounded
// windows keep peak allocation flat; the total work is identical.
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

const EMPTY_BREAKDOWN = Object.freeze({input: 0, output: 0, cacheWrite: 0, cacheRead: 0});

/**
 * @param {string} weekStart Sunday of the week being accumulated, "YYYY-MM-DD".
 * @returns {object} An empty scan state.
 */
export function createState(weekStart) {
    return {weekStart, files: {}, entries: {}};
}

/**
 * @param {object} breakdown
 * @returns {number}
 */
export function totalTokens(breakdown) {
    return breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.cacheRead;
}

/**
 * @param {*} value
 * @returns {number}
 */
function count(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Read one transcript line. Returns null for anything that is not a billable
 * assistant turn, which is the overwhelming majority of lines.
 *
 * @param {string} line
 * @returns {?object}
 */
export function parseLine(line) {
    // Cheap reject first: most lines are user turns, attachments or metadata, and
    // parsing 100 MB of JSON to discard it is the difference between a refresh
    // that is free and one that is not.
    if (!line.includes('"assistant"'))
        return null;

    let entry;
    try {
        entry = JSON.parse(line);
    } catch {
        // A torn write or a truncated file: skip the line, keep the scan going.
        return null;
    }

    // No optional chaining: JSON.parse only yields null for the literal `null`,
    // which cannot contain the substring the pre-filter above requires. Any other
    // shape — number, string, array — answers `undefined` here without throwing.
    if (entry.type !== 'assistant')
        return null;

    const message = entry.message;
    const usage = message?.usage;
    if (!usage)
        return null;

    const model = message.model;
    if (typeof model !== 'string' || model === SYNTHETIC_MODEL)
        return null;

    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp))
        return null;

    const id = message.id ?? entry.uuid;
    if (typeof id !== 'string')
        return null;

    return {
        key: `${id}|${entry.requestId ?? ''}`,
        timestamp,
        model,
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheWrite: count(usage.cache_creation_input_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
    };
}

/**
 * Fold the per-message records into totals, grouped by whichever field is named.
 *
 * @param {object} entries
 * @param {string} field 'day' or 'model'.
 * @returns {object}
 */
function groupBy(entries, field) {
    const buckets = {};
    for (const record of Object.values(entries)) {
        const bucket = buckets[record[field]] ?? {...EMPTY_BREAKDOWN};
        bucket.input += record.input;
        bucket.output += record.output;
        bucket.cacheWrite += record.cacheWrite;
        bucket.cacheRead += record.cacheRead;
        buckets[record[field]] = bucket;
    }
    return buckets;
}

/**
 * Where to resume reading a file, and whether the state we hold for it is still
 * valid. A rotated or truncated file (different inode, or shorter than the offset
 * we recorded) has to be read from the beginning again.
 *
 * @param {?object} previous
 * @param {object} file
 * @returns {number}
 */
function resumeOffset(previous, file) {
    if (!previous || previous.inode !== file.inode || file.size < previous.offset)
        return 0;
    return previous.offset;
}

/**
 * Fold every transcript into the running totals for the current week.
 *
 * @param {object} input
 * @param {object} input.state Previous state, from the cache.
 * @param {Array<{path: string, inode: *, size: number, mtimeMs: number}>} input.files
 * @param {Function} input.readChunk `(path, offset, length) => Uint8Array`
 * @param {string} input.weekStart Sunday of the current week, "YYYY-MM-DD".
 * @param {string} [input.timeZone]
 * @param {number} [input.chunkBytes] Read window; lowered by tests.
 * @returns {{state: object, stats: object}}
 */
export function scan({state, files, readChunk, weekStart, timeZone,
    chunkBytes = DEFAULT_CHUNK_BYTES}) {
    // A new week starts from zero rather than trying to subtract the old one.
    const working = state?.weekStart === weekStart ? state : createState(weekStart);

    const daysOfWeek = new Set(weekKeys(weekStart));
    const cutoff = earliestInstantFor(weekStart);
    const nextFiles = {};
    const stats = {filesRead: 0, bytesRead: 0, entriesAdded: 0, filesSkipped: 0};
    const decoder = new TextDecoder();

    for (const file of files) {
        // Nothing written since the week began can contain an entry from it.
        if (file.mtimeMs < cutoff) {
            stats.filesSkipped++;
            continue;
        }

        const offset = resumeOffset(working.files[file.path], file);
        if (file.size <= offset) {
            nextFiles[file.path] = {inode: file.inode, size: file.size, offset};
            stats.filesSkipped++;
            continue;
        }

        stats.filesRead++;
        let cursor = offset;
        let window = chunkBytes;

        while (cursor < file.size) {
            const bytes = readChunk(file.path, cursor, Math.min(window, file.size - cursor));
            stats.bytesRead += bytes.length;

            // Stop at the last newline: the tail may be a line Claude Code is
            // still writing, and resuming from before it is how we pick it up
            // next time.
            const lastNewline = bytes.lastIndexOf(0x0a);
            if (lastNewline === -1) {
                // No complete line in this window. At end of file that is a
                // half-written record and we simply wait; otherwise the record is
                // longer than the window, so widen it and look again.
                if (cursor + bytes.length >= file.size)
                    break;
                window *= 2;
                continue;
            }

            for (const line of decoder.decode(bytes.subarray(0, lastNewline)).split('\n')) {
                const entry = parseLine(line);
                if (entry === null)
                    continue;

                const day = dateKey(entry.timestamp, timeZone);
                if (!daysOfWeek.has(day))
                    continue;

                // Last write wins: a later line for the same message carries the
                // finished response, and the earlier ones were mid-stream.
                working.entries[entry.key] = {
                    day,
                    model: entry.model,
                    input: entry.input,
                    output: entry.output,
                    cacheWrite: entry.cacheWrite,
                    cacheRead: entry.cacheRead,
                };
                stats.entriesAdded++;
            }

            cursor += lastNewline + 1;
            window = chunkBytes;
        }

        nextFiles[file.path] = {inode: file.inode, size: file.size, offset: cursor};
    }

    // Assigning rather than merging drops files that have since been pruned.
    working.files = nextFiles;

    return {state: working, stats};
}

/**
 * The Sunday-to-Saturday view the popup draws, always seven entries so the chart
 * keeps its shape on a Monday.
 *
 * @param {object} state
 * @returns {{startsOn: string, start: string, days: Array<object>}}
 */
export function buildWeek(state) {
    const byDay = groupBy(state.entries, 'day');
    return {
        startsOn: 'sunday',
        start: state.weekStart,
        days: weekKeys(state.weekStart).map(date => {
            const breakdown = byDay[date] ?? EMPTY_BREAKDOWN;
            return {date, tokens: totalTokens(breakdown), breakdown: {...breakdown}};
        }),
    };
}

/**
 * Models used this week, busiest first.
 *
 * @param {object} state
 * @returns {Array<object>}
 */
export function buildModels(state) {
    return Object.entries(groupBy(state.entries, 'model'))
        .map(([id, breakdown]) => ({id, tokens: totalTokens(breakdown), breakdown: {...breakdown}}))
        .filter(model => model.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens);
}
