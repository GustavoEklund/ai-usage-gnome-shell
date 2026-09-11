// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    backoffSeconds,
    IDLE_REFRESH_MS,
    shouldFetchLimits,
} from '../../../../../src/helper/providers/claude/refreshPolicy.js';

const NOW = Date.parse('2026-09-11T16:32:00Z');
const ago = ms => new Date(NOW - ms).toISOString();

const ask = (overrides = {}) => shouldFetchLimits({
    hasCachedLimits: true,
    lastSuccessAt: ago(60000),
    newestActivityMs: NOW - 120000,
    now: NOW,
    ...overrides,
});

describe('shouldFetchLimits', () => {
    it('asks when there is nothing to show', () => {
        expect(ask({hasCachedLimits: false})).toBe(true);
    });

    it('asks when it has no idea when it last succeeded', () => {
        expect(ask({lastSuccessAt: null})).toBe(true);
        expect(ask({lastSuccessAt: 'recently'})).toBe(true);
    });

    it('asks when Claude Code wrote something since the last answer', () => {
        // A transcript newer than the last successful call means the numbers moved.
        expect(ask({lastSuccessAt: ago(60000), newestActivityMs: NOW - 1000})).toBe(true);
    });

    it('stays quiet while nothing has happened locally', () => {
        expect(ask({lastSuccessAt: ago(60000), newestActivityMs: NOW - 600000})).toBe(false);
        // No transcripts at all is not activity either.
        expect(ask({newestActivityMs: 0})).toBe(false);
    });

    it('asks anyway once the idle window passes, because quotas reset on a clock', () => {
        const quiet = {newestActivityMs: NOW - 3600000};
        expect(ask({...quiet, lastSuccessAt: ago(IDLE_REFRESH_MS - 1000)})).toBe(false);
        expect(ask({...quiet, lastSuccessAt: ago(IDLE_REFRESH_MS)})).toBe(true);
        expect(ask({...quiet, lastSuccessAt: ago(IDLE_REFRESH_MS + 1000)})).toBe(true);
    });

    it('takes the idle window as a parameter, so a test need not wait ten minutes', () => {
        expect(ask({
            newestActivityMs: 0, lastSuccessAt: ago(5000), idleRefreshMs: 1000,
        })).toBe(true);
    });
});

describe('backoffSeconds', () => {
    it('honours a sane Retry-After over anything it would have chosen', () => {
        expect(backoffSeconds({'retry-after': '90'}, 5)).toBe(90);
    });

    it('escalates, so returning at the same cadence does not earn the same refusal', () => {
        expect(backoffSeconds({}, 0)).toBe(300);
        expect(backoffSeconds({}, 1)).toBe(600);
        expect(backoffSeconds({}, 2)).toBe(1200);
        expect(backoffSeconds({}, 3)).toBe(2400);
    });

    it('caps the escalation at an hour', () => {
        expect(backoffSeconds({}, 4)).toBe(3600);
        expect(backoffSeconds({}, 99)).toBe(3600);
        expect(backoffSeconds({'retry-after': '999999'})).toBe(3600);
    });

    it('starts from the base when it has no header and no history', () => {
        expect(backoffSeconds(undefined)).toBe(300);
        expect(backoffSeconds({'retry-after': 'later'})).toBe(300);
        expect(backoffSeconds({'retry-after': '0'})).toBe(300);
        expect(backoffSeconds({'retry-after': '-5'}, -3)).toBe(300);
    });
});
