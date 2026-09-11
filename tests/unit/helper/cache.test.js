// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    emptyCache,
    entryFor,
    isBackingOff,
    parseCache,
    pruneCache,
    serializeCache,
    updateEntry,
} from '../../../src/helper/cache.js';

const NOW = Date.parse('2026-09-11T16:32:00Z');

describe('parseCache', () => {
    it('round-trips through serialize', () => {
        const cache = updateEntry(emptyCache(), 'claude:/home/me/.claude',
            {lastSuccessAt: '2026-09-11T16:00:00Z'});
        expect(parseCache(serializeCache(cache))).toEqual(cache);
    });

    it('starts over rather than failing on anything unusable', () => {
        for (const input of [null, undefined, '', '{ broken', 'null', '[]',
            '{"version":99,"accounts":{}}', '{"version":1}', '{"version":1,"accounts":null}']) {
            expect(parseCache(input)).toEqual(emptyCache());
        }
    });
});

describe('entryFor', () => {
    it('invents an empty entry for an account it has never seen', () => {
        expect(entryFor(emptyCache(), 'new')).toEqual({
            scanState: null, limits: null, lastSuccessAt: null, retryAfter: null,
        });
    });
});

describe('updateEntry', () => {
    it('merges into the existing entry without touching the others', () => {
        const first = updateEntry(emptyCache(), 'a', {lastSuccessAt: 'then', limits: []});
        const second = updateEntry(first, 'b', {lastSuccessAt: 'now'});
        const third = updateEntry(second, 'a', {lastSuccessAt: 'later'});

        expect(third.accounts.a).toMatchObject({lastSuccessAt: 'later', limits: []});
        expect(third.accounts.b.lastSuccessAt).toBe('now');
    });

    it('does not modify the cache it was given', () => {
        const original = emptyCache();
        updateEntry(original, 'a', {lastSuccessAt: 'then'});
        expect(original.accounts).toEqual({});
    });
});

describe('pruneCache', () => {
    it('keeps only the accounts still configured', () => {
        const cache = updateEntry(updateEntry(emptyCache(), 'a', {}), 'b', {});
        expect(Object.keys(pruneCache(cache, ['b']).accounts)).toEqual(['b']);
        expect(Object.keys(pruneCache(cache, []).accounts)).toEqual([]);
        expect(Object.keys(pruneCache(cache, ['a', 'b']).accounts)).toEqual(['a', 'b']);
    });
});

describe('isBackingOff', () => {
    it('holds off until the deadline passes', () => {
        expect(isBackingOff({retryAfter: '2026-09-11T16:40:00Z'}, NOW)).toBe(true);
        expect(isBackingOff({retryAfter: '2026-09-11T16:00:00Z'}, NOW)).toBe(false);
    });

    it('never holds off on a deadline it cannot read', () => {
        expect(isBackingOff({retryAfter: null}, NOW)).toBe(false);
        expect(isBackingOff({}, NOW)).toBe(false);
        expect(isBackingOff({retryAfter: 'soon'}, NOW)).toBe(false);
    });
});
