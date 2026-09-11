// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    addDays,
    dateKey,
    earliestInstantFor,
    startOfWeekKey,
    weekdayIndex,
    weekKeys,
} from '../../../src/helper/calendar.js';

describe('dateKey', () => {
    it('buckets an instant into the local day, not the UTC one', () => {
        const lateNight = Date.parse('2026-09-12T02:30:00Z');
        expect(dateKey(lateNight, 'UTC')).toBe('2026-09-12');
        expect(dateKey(lateNight, 'America/Sao_Paulo')).toBe('2026-09-11');
        expect(dateKey(lateNight, 'Asia/Tokyo')).toBe('2026-09-12');
    });

    it('uses the system zone when none is given', () => {
        expect(dateKey(Date.parse('2026-09-11T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('weekdayIndex', () => {
    it('counts from Sunday', () => {
        expect(weekdayIndex('2026-09-06')).toBe(0);
        expect(weekdayIndex('2026-09-11')).toBe(5);
        expect(weekdayIndex('2026-09-12')).toBe(6);
    });
});

describe('addDays', () => {
    it('moves forwards and backwards across month ends', () => {
        expect(addDays('2026-09-11', 1)).toBe('2026-09-12');
        expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2026-09-11', 0)).toBe('2026-09-11');
    });
});

describe('startOfWeekKey', () => {
    it('finds the Sunday of the containing week', () => {
        // 2026-09-11 is a Friday.
        expect(startOfWeekKey(Date.parse('2026-09-11T12:00:00Z'), 'UTC')).toBe('2026-09-06');
    });

    it('treats Sunday itself as the start', () => {
        expect(startOfWeekKey(Date.parse('2026-09-06T12:00:00Z'), 'UTC')).toBe('2026-09-06');
    });

    it('rolls back a week on Saturday night in a behind-UTC zone', () => {
        // 2026-09-13T02:00Z is Sunday in UTC but still Saturday in Sao Paulo,
        // so the two zones disagree about which week it belongs to.
        const instant = Date.parse('2026-09-13T02:00:00Z');
        expect(startOfWeekKey(instant, 'UTC')).toBe('2026-09-13');
        expect(startOfWeekKey(instant, 'America/Sao_Paulo')).toBe('2026-09-06');
    });
});

describe('weekKeys', () => {
    it('lists Sunday through Saturday', () => {
        expect(weekKeys('2026-09-06')).toEqual([
            '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09',
            '2026-09-10', '2026-09-11', '2026-09-12',
        ]);
    });
});

describe('earliestInstantFor', () => {
    it('is early enough to cover every time zone', () => {
        const bound = earliestInstantFor('2026-09-06');
        // Kiritimati, UTC+14, starts its day earliest of anywhere on earth.
        const earliestRealStart = Date.parse('2026-09-05T10:00:00Z');
        expect(bound).toBeLessThanOrEqual(earliestRealStart);
    });
});
