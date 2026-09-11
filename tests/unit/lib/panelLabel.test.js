// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    buildPanelLabel,
    PanelLimitMode,
    selectPanelLimit,
} from '../../../src/lib/panelLabel.js';

const NOW = new Date('2026-09-11T16:32:00Z').getTime();

const limit = (role, percent, resetsAt, label = role) =>
    ({id: role, role, label, percent, resetsAt, severity: 'normal'});

const snapshotOf = (...accounts) => ({
    providers: [{id: 'claude', accounts}],
});

const account = (label, ...limits) => ({id: label, label, limits});

const SESSION = limit('session', 21, '2026-09-11T18:30:00Z', 'Session');
const WEEKLY = limit('weekly', 29, '2026-09-13T22:00:00Z', 'Weekly');
const FABLE = limit('scoped', 0, '2026-09-13T22:00:00Z', 'Fable · weekly');
const ONE_ACCOUNT = snapshotOf(account('me@example.com', SESSION, WEEKLY, FABLE));

describe('selectPanelLimit', () => {
    it('tracks the session limit by default', () => {
        expect(selectPanelLimit(ONE_ACCOUNT, PanelLimitMode.SESSION).limit).toBe(SESSION);
    });

    it('tracks the weekly limit when asked', () => {
        expect(selectPanelLimit(ONE_ACCOUNT, PanelLimitMode.WEEKLY).limit).toBe(WEEKLY);
    });

    it('tracks whichever limit is closest to biting', () => {
        expect(selectPanelLimit(ONE_ACCOUNT, PanelLimitMode.HIGHEST).limit).toBe(WEEKLY);
    });

    it('prefers the busiest account when several expose the same role', () => {
        const many = snapshotOf(
            account('personal', limit('session', 10, null)),
            account('work', limit('session', 74, null)));
        expect(selectPanelLimit(many, PanelLimitMode.SESSION).account.label).toBe('work');
    });

    it('falls back to the busiest available limit rather than blanking the panel', () => {
        // A provider that has no session-role limit at all.
        const weeklyOnly = snapshotOf(account('me', WEEKLY, FABLE));
        expect(selectPanelLimit(weeklyOnly, PanelLimitMode.SESSION).limit).toBe(WEEKLY);
    });

    it('returns nothing when there is nothing to show', () => {
        expect(selectPanelLimit(null, PanelLimitMode.SESSION)).toBeNull();
        expect(selectPanelLimit({}, PanelLimitMode.SESSION)).toBeNull();
        expect(selectPanelLimit({providers: [{id: 'x'}]}, PanelLimitMode.SESSION)).toBeNull();
        expect(selectPanelLimit(snapshotOf(account('me')), PanelLimitMode.SESSION)).toBeNull();
        // An account the provider could not enumerate limits for at all.
        expect(selectPanelLimit(snapshotOf({id: 'me'}), PanelLimitMode.SESSION)).toBeNull();
    });
});

describe('buildPanelLabel', () => {
    it('renders the shape from the brief: percent, separator, time left', () => {
        const result = buildPanelLabel({snapshot: ONE_ACCOUNT, now: NOW});
        expect(result.text).toBe('21% · 1h58m');
        expect(result.limit).toBe(SESSION);
        expect(result.isStale).toBe(false);
    });

    it('honours the percent and time toggles independently', () => {
        const base = {snapshot: ONE_ACCOUNT, now: NOW};
        expect(buildPanelLabel({...base, showTime: false}).text).toBe('21%');
        expect(buildPanelLabel({...base, showPercent: false}).text).toBe('1h58m');
        expect(buildPanelLabel({...base, showPercent: false, showTime: false}).text).toBe('');
    });

    it('drops the countdown once the reset is due instead of showing 0m', () => {
        const due = snapshotOf(account('me', limit('session', 21, '2026-09-11T16:00:00Z')));
        expect(buildPanelLabel({snapshot: due, now: NOW}).text).toBe('21%');
    });

    it('drops the countdown when the limit has no reset time', () => {
        const noReset = snapshotOf(account('me', limit('session', 21, null)));
        expect(buildPanelLabel({snapshot: noReset, now: NOW}).text).toBe('21%');
    });

    it('shows a placeholder rather than a blank panel when there is no data', () => {
        const result = buildPanelLabel({snapshot: null, now: NOW});
        expect(result.text).toBe('--');
        expect(result.limit).toBeNull();
        expect(result.accessibleName).toBe('AI Usage: no data yet');
    });

    it('handles a limit whose percent never arrived', () => {
        const broken = snapshotOf(account('me', limit('session', null, null)));
        expect(buildPanelLabel({snapshot: broken, now: NOW}).text).toBe('--');
    });

    it('carries staleness through from the status', () => {
        const result = buildPanelLabel({
            snapshot: ONE_ACCOUNT,
            now: NOW,
            status: {isStale: true, title: 'Usage percentages are frozen'},
        });
        expect(result.isStale).toBe(true);
        expect(result.accessibleName)
            .toBe('Session: 21%, resets in 1h58m. Usage percentages are frozen');
    });

    it('spells the whole thing out for a screen reader', () => {
        expect(buildPanelLabel({snapshot: ONE_ACCOUNT, now: NOW}).accessibleName)
            .toBe('Session: 21%, resets in 1h58m');
    });

    it('omits the countdown from the accessible name when there is none', () => {
        const noReset = snapshotOf(account('me', limit('session', 21, null, 'Session')));
        expect(buildPanelLabel({snapshot: noReset, now: NOW}).accessibleName)
            .toBe('Session: 21%');
    });

    it('routes its own words through gettext', () => {
        const result = buildPanelLabel({
            snapshot: ONE_ACCOUNT,
            now: NOW,
            gettext: text => text === 'resets in' ? 'reinicia em' : text,
        });
        expect(result.accessibleName).toContain('reinicia em');
    });

    it('defaults `now` to the real clock', () => {
        expect(buildPanelLabel({snapshot: ONE_ACCOUNT}).text).toContain('21%');
    });
});
