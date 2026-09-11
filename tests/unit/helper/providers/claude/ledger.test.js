// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    buildModels,
    buildWeek,
    createState,
    parseLine,
    scan,
} from '../../../../../src/helper/providers/claude/ledger.js';

const WEEK_START = '2026-09-06';
const TZ = 'UTC';

/** One assistant turn, in the shape Claude Code actually writes. */
function turn({
    id = 'msg_1',
    requestId = 'req_1',
    timestamp = '2026-09-08T10:00:00Z',
    model = 'claude-opus-5',
    usage = {input_tokens: 2, output_tokens: 100, cache_creation_input_tokens: 50,
        cache_read_input_tokens: 1000},
} = {}) {
    return JSON.stringify({
        type: 'assistant', timestamp, requestId, uuid: `uuid-${id}`,
        message: {id, model, usage},
    });
}

const encoder = new TextEncoder();

/**
 * An in-memory disk. Files are byte arrays, exactly like the real adapter hands
 * over, so offset arithmetic is exercised for real.
 */
function fakeDisk(contents, {mtimeMs = Date.parse('2026-09-09T10:00:00Z')} = {}) {
    const bytes = new Map(
        Object.entries(contents).map(([path, text]) => [path, encoder.encode(text)]));

    return {
        files: [...bytes.entries()].map(([path, data], index) => ({
            path, inode: index + 1, size: data.length, mtimeMs,
        })),
        readChunk: (path, offset, length) => bytes.get(path).subarray(offset, offset + length),
        append(path, text) {
            const merged = new Uint8Array([...bytes.get(path), ...encoder.encode(text)]);
            bytes.set(path, merged);
            return merged.length;
        },
        replace(path, text) {
            bytes.set(path, encoder.encode(text));
            return bytes.get(path).length;
        },
    };
}

/** Tokens recorded for one day, through the same path the UI uses. */
const tokensOn = (state, date) =>
    buildWeek(state).days.find(day => day.date === date).tokens;

/** Days that saw any usage at all. */
const activeDays = state =>
    buildWeek(state).days.filter(day => day.tokens > 0).map(day => day.date);

const run = (disk, state, overrides = {}) => scan({
    state, files: disk.files, readChunk: disk.readChunk,
    weekStart: WEEK_START, timeZone: TZ, ...overrides,
});

describe('parseLine', () => {
    it('reads a billable assistant turn', () => {
        expect(parseLine(turn())).toEqual({
            key: 'msg_1|req_1',
            timestamp: Date.parse('2026-09-08T10:00:00Z'),
            model: 'claude-opus-5',
            input: 2, output: 100, cacheWrite: 50, cacheRead: 1000,
        });
    });

    it('ignores everything that is not a billable assistant turn', () => {
        expect(parseLine('{"type":"user","message":{}}')).toBeNull();
        expect(parseLine('{"type":"attachment"}')).toBeNull();
        expect(parseLine('')).toBeNull();
        // A user turn whose payload quotes an assistant message verbatim, which is
        // what a subagent tool result looks like. It clears the cheap pre-filter, so
        // the type check behind it is the only thing keeping it out of the totals.
        expect(parseLine('{"type":"user","toolUseResult":{"role":"assistant"}}')).toBeNull();
    });

    it('survives a torn or truncated line instead of aborting the scan', () => {
        expect(parseLine('{"type":"assistant","mess')).toBeNull();
    });

    it('skips an assistant envelope with no message at all', () => {
        expect(parseLine('{"type":"assistant","timestamp":"2026-09-08T10:00:00Z"}')).toBeNull();
    });

    it('skips turns with nothing to count', () => {
        expect(parseLine(JSON.stringify({type: 'assistant', timestamp: '2026-09-08T10:00:00Z',
            message: {id: 'a', model: 'claude-opus-5'}}))).toBeNull();
        expect(parseLine(turn({model: '<synthetic>'}))).toBeNull();
        expect(parseLine(turn({model: null}))).toBeNull();
        expect(parseLine(turn({timestamp: 'whenever'}))).toBeNull();
    });

    it('falls back to the envelope uuid when the message has no id', () => {
        const line = JSON.stringify({
            type: 'assistant', timestamp: '2026-09-08T10:00:00Z', requestId: 'req_9',
            uuid: 'uuid-fallback',
            message: {model: 'claude-opus-5', usage: {output_tokens: 1}},
        });
        expect(parseLine(line).key).toBe('uuid-fallback|req_9');
    });

    it('gives up when there is no id to deduplicate on at all', () => {
        const line = JSON.stringify({
            type: 'assistant', timestamp: '2026-09-08T10:00:00Z',
            message: {model: 'claude-opus-5', usage: {output_tokens: 1}},
        });
        expect(parseLine(line)).toBeNull();
    });

    it('treats missing, negative or non-numeric counts as zero', () => {
        const entry = parseLine(turn({usage: {output_tokens: -5, input_tokens: 'lots'}}));
        expect(entry).toMatchObject({input: 0, output: 0, cacheWrite: 0, cacheRead: 0});
    });

    it('keys on the message alone when there is no request id', () => {
        const line = JSON.stringify({
            type: 'assistant', timestamp: '2026-09-08T10:00:00Z',
            message: {id: 'msg_1', model: 'claude-opus-5', usage: {output_tokens: 1}},
        });
        expect(parseLine(line).key).toBe('msg_1|');
    });
});

describe('scan / deduplication', () => {
    it('counts a repeated message once, which is a 2x difference on real data', () => {
        // A streaming message is written several times; this is the measured shape.
        const disk = fakeDisk({'a.jsonl': [turn(), turn(), turn()].join('\n') + '\n'});
        const {state} = run(disk, createState(WEEK_START));

        expect(Object.keys(state.entries)).toHaveLength(1);
        expect(tokensOn(state, '2026-09-08')).toBe(1152);
    });

    it('keeps the LAST occurrence, because output_tokens grows as it streams', () => {
        // Measured on real transcripts: one message's three lines read [1, 1, 282].
        // Keeping the first undercounts output by about 15%.
        const disk = fakeDisk({'a.jsonl': [
            turn({usage: {output_tokens: 1}}),
            turn({usage: {output_tokens: 1}}),
            turn({usage: {output_tokens: 282}}),
        ].join('\n') + '\n'});

        expect(tokensOn(run(disk, createState(WEEK_START)).state, '2026-09-08')).toBe(282);
    });

    it('corrects a total when the finished line only arrives on a later scan', () => {
        // The partial is all that exists when the first scan runs; the complete
        // line is appended afterwards and must replace it, not add to it.
        const partial = turn({usage: {output_tokens: 1}}) + '\n';
        const disk = fakeDisk({'a.jsonl': partial});
        const first = run(disk, createState(WEEK_START));
        expect(tokensOn(first.state, '2026-09-08')).toBe(1);

        disk.files[0].size = disk.append('a.jsonl', turn({usage: {output_tokens: 282}}) + '\n');
        expect(tokensOn(run(disk, first.state).state, '2026-09-08')).toBe(282);
    });

    it('counts distinct messages separately', () => {
        const disk = fakeDisk({'a.jsonl':
            [turn({id: 'm1', requestId: 'r1'}), turn({id: 'm2', requestId: 'r2'})].join('\n') + '\n'});
        expect(run(disk, createState(WEEK_START)).stats.entriesAdded).toBe(2);
    });

    it('deduplicates across files, as a resumed session produces', () => {
        const disk = fakeDisk({
            'a.jsonl': turn() + '\n',
            'b.jsonl': turn() + '\n',
        });
        const {state} = run(disk, createState(WEEK_START));
        expect(tokensOn(state, '2026-09-08')).toBe(1152);
    });
});

describe('scan / incremental reads', () => {
    it('reads nothing the second time when nothing was written', () => {
        const disk = fakeDisk({'a.jsonl': turn() + '\n'});
        const first = run(disk, createState(WEEK_START));
        const second = run(disk, first.state);

        expect(second.stats.bytesRead).toBe(0);
        expect(second.stats.entriesAdded).toBe(0);
        expect(second.state.entries).toEqual(first.state.entries);
    });

    it('reads only the bytes appended since last time', () => {
        const disk = fakeDisk({'a.jsonl': turn({id: 'm1', requestId: 'r1'}) + '\n'});
        const first = run(disk, createState(WEEK_START));

        const added = turn({id: 'm2', requestId: 'r2'}) + '\n';
        disk.files[0].size = disk.append('a.jsonl', added);
        const second = run(disk, first.state);

        expect(second.stats.bytesRead).toBe(encoder.encode(added).length);
        expect(second.stats.entriesAdded).toBe(1);
    });

    it('holds back a half-written trailing line and picks it up once complete', () => {
        const complete = turn({id: 'm1', requestId: 'r1'}) + '\n';
        const partial = turn({id: 'm2', requestId: 'r2'}).slice(0, 40);
        const disk = fakeDisk({'a.jsonl': complete + partial});

        const first = run(disk, createState(WEEK_START));
        expect(first.stats.entriesAdded).toBe(1);
        expect(first.state.files['a.jsonl'].offset).toBe(encoder.encode(complete).length);

        disk.files[0].size = disk.replace('a.jsonl',
            complete + turn({id: 'm2', requestId: 'r2'}) + '\n');
        expect(run(disk, first.state).stats.entriesAdded).toBe(1);
    });

    it('waits rather than guessing when a file so far holds no complete line', () => {
        const disk = fakeDisk({'a.jsonl': turn().slice(0, 30)});
        const {state, stats} = run(disk, createState(WEEK_START));

        expect(stats.entriesAdded).toBe(0);
        expect(state.files['a.jsonl'].offset).toBe(0);
    });

    it('keeps byte offsets exact when the transcript contains non-ASCII text', () => {
        // "ação" is 4 characters but 6 bytes; a character-based offset would
        // resume mid-sequence and corrupt every line after it.
        const first = JSON.stringify({type: 'user', message: {content: 'ação ção ção'}}) + '\n';
        const disk = fakeDisk({'a.jsonl': first + turn() + '\n'});
        const result = run(disk, createState(WEEK_START));

        expect(result.stats.entriesAdded).toBe(1);
        expect(result.state.files['a.jsonl'].offset).toBe(disk.files[0].size);
    });
});

describe('scan / bounded reads', () => {
    it('reads a file in windows without losing or double-counting anything', () => {
        const lines = Array.from({length: 20}, (_unused, index) =>
            turn({id: `m${index}`, requestId: `r${index}`, usage: {output_tokens: 1}}));
        const disk = fakeDisk({'a.jsonl': lines.join('\n') + '\n'});

        // A window far smaller than the file, so every boundary case is hit.
        const {state, stats} = run(disk, createState(WEEK_START), {chunkBytes: 200});

        expect(stats.entriesAdded).toBe(20);
        expect(tokensOn(state, '2026-09-08')).toBe(20);
        expect(state.files['a.jsonl'].offset).toBe(disk.files[0].size);
    });

    it('widens the window for a record longer than it, rather than stalling', () => {
        // Transcripts do contain single lines of several megabytes when a tool
        // returns a lot of output; a fixed window must not deadlock on one.
        const huge = turn({id: 'big', requestId: 'rb',
            usage: {output_tokens: 7, input_tokens: 0}});
        const disk = fakeDisk({'a.jsonl': huge + '\n' + turn({id: 'after', requestId: 'ra',
            usage: {output_tokens: 3}}) + '\n'});

        const {state, stats} = run(disk, createState(WEEK_START), {chunkBytes: 8});

        expect(stats.entriesAdded).toBe(2);
        expect(tokensOn(state, '2026-09-08')).toBe(10);
    });

    it('still holds back a half-written record when the window ends at one', () => {
        const complete = turn({id: 'm1', requestId: 'r1', usage: {output_tokens: 1}}) + '\n';
        const disk = fakeDisk({'a.jsonl': complete + '{"type":"assistant","mess'});

        const {state, stats} = run(disk, createState(WEEK_START), {chunkBytes: 64});
        expect(stats.entriesAdded).toBe(1);
        expect(state.files['a.jsonl'].offset).toBe(encoder.encode(complete).length);
    });
});

describe('scan / file lifecycle', () => {
    it('re-reads a file that was truncated', () => {
        const disk = fakeDisk({'a.jsonl': turn({id: 'm1', requestId: 'r1'}) + '\n'});
        const first = run(disk, createState(WEEK_START));

        disk.files[0].size = disk.replace('a.jsonl',
            turn({id: 'm9', requestId: 'r9', usage: {output_tokens: 1}}) + '\n');
        const second = run(disk, first.state);
        expect(second.stats.entriesAdded).toBe(1);
        expect(second.state.files['a.jsonl'].offset).toBe(disk.files[0].size);
    });

    it('re-reads a path whose inode changed, because it is a different file', () => {
        const disk = fakeDisk({'a.jsonl': turn({id: 'm1', requestId: 'r1'}) + '\n'});
        const first = run(disk, createState(WEEK_START));

        disk.files[0].inode = 999;
        expect(run(disk, first.state).stats.bytesRead).toBeGreaterThan(0);
    });

    it('never opens a file last written before the week began', () => {
        const disk = fakeDisk({'old.jsonl': turn() + '\n'},
            {mtimeMs: Date.parse('2026-08-20T10:00:00Z')});
        const {stats} = run(disk, createState(WEEK_START));

        expect(stats.filesRead).toBe(0);
        expect(stats.filesSkipped).toBe(1);
    });

    it('forgets files Claude Code has pruned', () => {
        const disk = fakeDisk({'a.jsonl': turn() + '\n'});
        const first = run(disk, createState(WEEK_START));
        expect(first.state.files).toHaveProperty('a.jsonl');

        const second = scan({state: first.state, files: [], readChunk: disk.readChunk,
            weekStart: WEEK_START, timeZone: TZ});
        expect(second.state.files).toEqual({});
    });
});

describe('scan / week boundaries', () => {
    it('ignores entries from outside the week being accumulated', () => {
        const disk = fakeDisk({'a.jsonl': [
            turn({id: 'inside', requestId: 'r1', timestamp: '2026-09-08T10:00:00Z'}),
            turn({id: 'before', requestId: 'r2', timestamp: '2026-09-05T10:00:00Z'}),
            turn({id: 'after', requestId: 'r3', timestamp: '2026-09-14T10:00:00Z'}),
        ].join('\n') + '\n'});

        const {state, stats} = run(disk, createState(WEEK_START));
        expect(stats.entriesAdded).toBe(1);
        expect(activeDays(state)).toEqual(['2026-09-08']);
    });

    it('starts from zero when the week rolls over', () => {
        const disk = fakeDisk({'a.jsonl': turn() + '\n'});
        const previous = run(disk, createState('2026-08-30')).state;

        const {state} = run(disk, previous);
        expect(state.weekStart).toBe(WEEK_START);
        expect(activeDays(state)).toEqual(['2026-09-08']);
    });

    it('buckets by the viewer\'s own day, not by UTC', () => {
        // 02:30 UTC on Saturday is still Friday evening in Sao Paulo.
        const disk = fakeDisk({'a.jsonl': turn({timestamp: '2026-09-12T02:30:00Z'}) + '\n'});

        expect(activeDays(run(disk, createState(WEEK_START), {timeZone: 'UTC'}).state))
            .toEqual(['2026-09-12']);
        expect(activeDays(run(disk, createState(WEEK_START),
            {timeZone: 'America/Sao_Paulo'}).state)).toEqual(['2026-09-11']);
    });

    it('starts fresh when handed no previous state at all', () => {
        const disk = fakeDisk({'a.jsonl': turn() + '\n'});
        expect(run(disk, null).stats.entriesAdded).toBe(1);
    });
});

describe('buildWeek', () => {
    it('always returns Sunday through Saturday, zeros included', () => {
        const disk = fakeDisk({'a.jsonl': turn() + '\n'});
        const week = buildWeek(run(disk, createState(WEEK_START)).state);

        expect(week).toMatchObject({startsOn: 'sunday', start: WEEK_START});
        expect(week.days).toHaveLength(7);
        expect(week.days.map(d => d.date)).toEqual([
            '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09',
            '2026-09-10', '2026-09-11', '2026-09-12',
        ]);
        expect(week.days[0]).toEqual({date: '2026-09-06', tokens: 0,
            breakdown: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}});
        expect(week.days[2]).toEqual({date: '2026-09-08', tokens: 1152,
            breakdown: {input: 2, output: 100, cacheWrite: 50, cacheRead: 1000}});
    });
});

describe('buildModels', () => {
    it('lists the busiest model first', () => {
        const disk = fakeDisk({'a.jsonl': [
            turn({id: 'm1', requestId: 'r1', model: 'claude-haiku-4-5-20251001',
                usage: {output_tokens: 10}}),
            turn({id: 'm2', requestId: 'r2', model: 'claude-opus-5',
                usage: {output_tokens: 5000}}),
        ].join('\n') + '\n'});

        expect(buildModels(run(disk, createState(WEEK_START)).state)).toEqual([
            {id: 'claude-opus-5', tokens: 5000,
                breakdown: {input: 0, output: 5000, cacheWrite: 0, cacheRead: 0}},
            {id: 'claude-haiku-4-5-20251001', tokens: 10,
                breakdown: {input: 0, output: 10, cacheWrite: 0, cacheRead: 0}},
        ]);
    });

    it('leaves out a model that consumed nothing', () => {
        const disk = fakeDisk({'a.jsonl': turn({usage: {output_tokens: 0}}) + '\n'});
        expect(buildModels(run(disk, createState(WEEK_START)).state)).toEqual([]);
    });
});
