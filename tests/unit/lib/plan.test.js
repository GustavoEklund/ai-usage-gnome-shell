// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {accountSublabel, planLabel} from '../../../src/lib/plan.js';

describe('planLabel', () => {
    it('names the plans Anthropic sells', () => {
        expect(planLabel('default_claude_max_5x')).toBe('Max 5×');
        expect(planLabel('default_claude_max_20x')).toBe('Max 20×');
        expect(planLabel('default_claude_pro')).toBe('Pro');
        expect(planLabel('default_claude_free')).toBe('Free');
    });

    it('tidies a tier this build has never seen rather than dropping it', () => {
        expect(planLabel('default_claude_max_50x')).toBe('Max 50x');
        expect(planLabel('enterprise_seat')).toBe('Enterprise seat');
    });

    it('has nothing to say when there is no tier', () => {
        expect(planLabel(null)).toBeNull();
        expect(planLabel('')).toBeNull();
        expect(planLabel(undefined)).toBeNull();
    });
});

describe('accountSublabel', () => {
    it('joins the organisation and the plan', () => {
        expect(accountSublabel({organizationName: 'OKTO Payments', rateLimitTier: 'default_claude_max_5x'}))
            .toBe('OKTO Payments · Max 5×');
    });

    it('shows whichever half it has', () => {
        expect(accountSublabel({organizationName: 'Acme'})).toBe('Acme');
        expect(accountSublabel({rateLimitTier: 'default_claude_pro'})).toBe('Pro');
    });

    it('collapses to nothing when it knows nothing', () => {
        expect(accountSublabel({})).toBeNull();
        expect(accountSublabel()).toBeNull();
    });
});
