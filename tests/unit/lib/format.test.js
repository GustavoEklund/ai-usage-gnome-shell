// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    formatClockTime,
    formatDuration,
    formatElapsed,
    formatExactTokens,
    formatPercent,
    formatTokens,
    modelLabel,
} from '../../../src/lib/format.js';

describe('formatTokens', () => {
    it('abbreviates the way ccusage and /usage do', () => {
        expect(formatTokens(113619555)).toBe('113.6M');
        expect(formatTokens(945910)).toBe('945.9K');
        expect(formatTokens(1000)).toBe('1K');
        expect(formatTokens(999)).toBe('999');
    });

    it('treats absent or nonsensical counts as zero', () => {
        expect(formatTokens(0)).toBe('0');
        expect(formatTokens(-5)).toBe('0');
        expect(formatTokens(Number.NaN)).toBe('0');
        expect(formatTokens(undefined)).toBe('0');
    });

    it('follows the locale', () => {
        expect(formatTokens(113619555, 'pt-BR')).toContain('113,6');
    });
});

describe('formatExactTokens', () => {
    it('groups digits for the detail line', () => {
        expect(formatExactTokens(113619555)).toBe('113,619,555');
        expect(formatExactTokens(0)).toBe('0');
        expect(formatExactTokens(Number.NaN)).toBe('0');
    });
});

describe('formatDuration', () => {
    it('uses the compact hours-and-minutes shape of the panel', () => {
        expect(formatDuration(3 * 3600000 + 27 * 60000)).toBe('3h27m');
        expect(formatDuration(3 * 3600000 + 5 * 60000)).toBe('3h05m');
        expect(formatDuration(3600000)).toBe('1h00m');
    });

    it('drops the hour segment below an hour', () => {
        expect(formatDuration(27 * 60000)).toBe('27m');
        expect(formatDuration(60000)).toBe('1m');
    });

    it('never prints a rounded-down zero', () => {
        expect(formatDuration(59999)).toBe('<1m');
        expect(formatDuration(1)).toBe('<1m');
    });

    it('returns null once the reset is due, so the caller can drop the segment', () => {
        expect(formatDuration(0)).toBeNull();
        expect(formatDuration(-1)).toBeNull();
        expect(formatDuration(Number.NaN)).toBeNull();
        expect(formatDuration(undefined)).toBeNull();
    });
});

describe('formatPercent', () => {
    it('renders the API percentages', () => {
        expect(formatPercent(21)).toBe('21%');
        expect(formatPercent(0)).toBe('0%');
        expect(formatPercent(100)).toBe('100%');
    });

    it('clamps out-of-range values instead of showing them', () => {
        expect(formatPercent(150)).toBe('100%');
        expect(formatPercent(-5)).toBe('0%');
        expect(formatPercent(Number.NaN)).toBe('0%');
    });
});

describe('formatClockTime', () => {
    it('renders a 24h wall clock in an explicit zone', () => {
        expect(formatClockTime(new Date('2026-09-11T14:32:00Z'), {timeZone: 'UTC'}))
            .toBe('14:32');
    });

    it('falls back to the system zone when none is given', () => {
        expect(formatClockTime(new Date('2026-09-11T14:32:00Z')))
            .toMatch(/^\d{2}:\d{2}$/);
    });
});

describe('formatElapsed', () => {
    it('picks the largest unit that still has a value', () => {
        expect(formatElapsed(3 * 24 * 3600000)).toBe('3 days ago');
        expect(formatElapsed(2 * 3600000)).toBe('2 hr. ago');
        expect(formatElapsed(5 * 60000)).toBe('5 min. ago');
    });

    it('says "this minute" rather than "0 minutes ago"', () => {
        expect(formatElapsed(30000)).toBe('this minute');
        expect(formatElapsed(0)).toBe('this minute');
        expect(formatElapsed(-1)).toBe('this minute');
        expect(formatElapsed(Number.NaN)).toBe('this minute');
    });
});

describe('modelLabel', () => {
    it('names the current Claude models', () => {
        expect(modelLabel('claude-opus-5')).toBe('Opus 5');
        expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
        expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1');
        expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    });

    it('keeps the long-context marker', () => {
        expect(modelLabel('claude-opus-5[1m]')).toBe('Opus 5 1M');
    });

    it('tidies unknown ids instead of hiding them', () => {
        expect(modelLabel('gpt-4o')).toBe('Gpt 4o');
        expect(modelLabel('<synthetic>')).toBe('<synthetic>');
        expect(modelLabel('claude-')).toBe('claude-');
        expect(modelLabel('opus')).toBe('Opus');
    });

    it('has something to show when the id is missing', () => {
        expect(modelLabel('')).toBe('Unknown model');
        expect(modelLabel(null)).toBe('Unknown model');
        expect(modelLabel(undefined)).toBe('Unknown model');
    });
});
