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
    withUpdates,
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

describe('withUpdates', () => {
    it('keeps the update check beside the accounts, and survives a round trip', () => {
        const entry = {latest: '0.2.0', checkedAt: '2026-09-11T16:00:00Z'};
        const cache = withUpdates(updateEntry(emptyCache(), 'a', {limits: []}), entry);

        expect(cache.updates).toEqual(entry);
        expect(parseCache(serializeCache(cache))).toEqual(cache);
    });

    it('is absent, not undefined, when nothing has been checked', () => {
        expect(emptyCache().updates).toBeNull();
        expect(parseCache('{"version":1,"accounts":{}}').updates).toBeNull();
    });

    it('is not lost when an account entry is written or the cache is pruned', () => {
        const entry = {latest: '0.2.0'};
        const cache = withUpdates(emptyCache(), entry);

        expect(updateEntry(cache, 'a', {limits: []}).updates).toEqual(entry);
        expect(pruneCache(updateEntry(cache, 'a', {}), []).updates).toEqual(entry);
    });
});

describe('entryFor', () => {
    it('invents an empty entry for an account it has never seen', () => {
        expect(entryFor(emptyCache(), 'new')).toEqual({
            scanState: null, limits: null, lastSuccessAt: null, retryAfter: null,
            rateLimitStrikes: 0,
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
