// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    BAR_MAXIMUM,
    barValue,
    DANGER_FRACTION,
    overdriveStart,
} from '../../../src/lib/barScale.js';

describe('barValue', () => {
    it('maps a fraction onto the range BarLevel accepts', () => {
        expect(barValue(0)).toBe(0);
        expect(barValue(0.5)).toBe(1);
        expect(barValue(1)).toBe(BAR_MAXIMUM);
    });

    it('clamps rather than letting BarLevel reject the value', () => {
        // BarLevel's `value` property is declared 0..2 and would warn outside it.
        expect(barValue(1.5)).toBe(BAR_MAXIMUM);
        expect(barValue(-1)).toBe(0);
        expect(barValue(Number.NaN)).toBe(0);
        expect(barValue(undefined)).toBe(0);
    });
});

describe('overdriveStart', () => {
    it('puts the danger zone at 90% of the bar', () => {
        expect(overdriveStart(true)).toBe(BAR_MAXIMUM * DANGER_FRACTION);
        expect(barValue(DANGER_FRACTION)).toBe(overdriveStart(true));
    });

    it('disables the danger zone by starting it at the very end', () => {
        expect(overdriveStart(false)).toBe(BAR_MAXIMUM);
    });

    it('stays inside the 1..2 range BarLevel declares for the property', () => {
        expect(overdriveStart(true)).toBeGreaterThanOrEqual(1);
        expect(overdriveStart(false)).toBeLessThanOrEqual(2);
    });
});
