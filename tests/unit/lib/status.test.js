// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it, vi} from 'vitest';

import {describeStatus, Severity, StatusCode} from '../../../src/lib/status.js';

const NOW = new Date('2026-09-11T16:32:00Z').getTime();
const opts = {now: NOW, timeZone: 'UTC'};

describe('describeStatus / healthy', () => {
    it('says nothing when everything works', () => {
        const result = describeStatus({code: StatusCode.OK}, opts);
        expect(result).toEqual({
            code: 'ok',
            severity: Severity.OK,
            isStale: false,
            title: null,
            detail: null,
            hint: null,
            command: null,
        });
    });

    it('treats a missing status as healthy rather than broken', () => {
        expect(describeStatus(null, opts).code).toBe(StatusCode.OK);
        expect(describeStatus(undefined, opts).isStale).toBe(false);
        expect(describeStatus({}, opts).severity).toBe(Severity.OK);
    });

    it('defaults `now` to the real clock when not injected', () => {
        expect(describeStatus({code: StatusCode.OK}).isStale).toBe(false);
    });
});

describe('describeStatus / token expiry', () => {
    it('explains what expired, that we never refresh it, and what to run', () => {
        const result = describeStatus({
            code: StatusCode.TOKEN_EXPIRED,
            params: {expiredAt: '2026-09-11T14:32:00Z'},
        }, opts);

        expect(result.severity).toBe(Severity.WARNING);
        expect(result.isStale).toBe(true);
        expect(result.title).toBe('Usage percentages are frozen');
        expect(result.detail).toContain('expired 2 hr. ago');
        expect(result.detail).toContain('never refreshes it');
        // Half the popup is read from local transcripts and needs no token, so the
        // message must not claim everything is stale.
        expect(result.detail).toContain('Token counts come from local files and are still current');
        expect(result.command).toBe('claude auth status');
        expect(result.hint).toMatch(/Using Claude Code refreshes the token/);
    });

    it('still explains itself when the expiry timestamp is missing or unparseable', () => {
        const missing = describeStatus({code: StatusCode.TOKEN_EXPIRED}, opts);
        expect(missing.detail).toContain('has expired');
        expect(missing.command).toBe('claude auth status');

        const broken = describeStatus({
            code: StatusCode.TOKEN_EXPIRED,
            params: {expiredAt: 'not-a-date'},
        }, opts);
        expect(broken.detail).toContain('has expired');
    });
});

describe('describeStatus / needs the user', () => {
    it('points at the missing credentials and the command that creates them', () => {
        const result = describeStatus({
            code: StatusCode.NOT_SIGNED_IN,
            params: {path: '/home/me/.claude'},
        }, opts);
        expect(result.severity).toBe(Severity.ERROR);
        expect(result.detail).toBe('No Claude credentials were found in /home/me/.claude.');
        expect(result.command).toBe('claude auth login');
    });

    it('falls back to the default config path', () => {
        expect(describeStatus({code: StatusCode.NOT_SIGNED_IN}, opts).detail)
            .toContain('~/.claude');
        expect(describeStatus({code: StatusCode.CONFIG_NOT_FOUND}, opts).detail)
            .toContain('~/.claude');
    });

    it('sends a missing installation to Settings, not to a command', () => {
        const result = describeStatus({
            code: StatusCode.CONFIG_NOT_FOUND,
            params: {path: '/opt/claude'},
        }, opts);
        expect(result.detail).toContain('/opt/claude');
        expect(result.command).toBeNull();
        expect(result.hint).toMatch(/Settings/);
    });

    it('separates a revoked token from an expired one', () => {
        const result = describeStatus({code: StatusCode.TOKEN_REJECTED}, opts);
        expect(result.severity).toBe(Severity.ERROR);
        expect(result.detail).toContain('401');
        expect(result.detail).toContain('revoked');
        expect(result.command).toBe('claude auth login');
    });
});

describe('describeStatus / transient', () => {
    it('says how old the numbers are when the network is down', () => {
        const result = describeStatus({
            code: StatusCode.NETWORK_ERROR,
            params: {lastSuccessAt: '2026-09-11T14:32:00Z'},
        }, opts);
        expect(result.severity).toBe(Severity.WARNING);
        expect(result.detail).toBe('Showing the values from 14:32.');
        expect(result.hint).toMatch(/retries on its own/);
    });

    it('admits when there is no data at all yet', () => {
        expect(describeStatus({code: StatusCode.NETWORK_ERROR}, opts).detail)
            .toBe('No usage data has been fetched yet.');
    });

    it('names the moment it will try again when throttled', () => {
        const result = describeStatus({
            code: StatusCode.RATE_LIMITED,
            params: {retryAt: '2026-09-11T16:40:00Z'},
        }, opts);
        expect(result.detail).toBe('Backing off until 16:40.');
        expect(result.severity).toBe(Severity.WARNING);
    });

    it('handles throttling without a retry time', () => {
        expect(describeStatus({code: StatusCode.RATE_LIMITED}, opts).detail)
            .toBe('Backing off before checking again.');
    });
});

describe('describeStatus / helper failures', () => {
    it('passes the reason through when there is one', () => {
        expect(describeStatus({
            code: StatusCode.HELPER_ERROR,
            params: {reason: 'gjs exited with 127'},
        }, opts).detail).toBe('The usage helper failed: gjs exited with 127');
    });

    it('is honest when the helper failed silently', () => {
        expect(describeStatus({code: StatusCode.HELPER_ERROR}, opts).detail)
            .toBe('The usage helper failed without saying why.');
    });

    it('reports an unrecognised code instead of swallowing it', () => {
        const result = describeStatus({code: 'from_the_future'}, opts);
        expect(result.severity).toBe(Severity.ERROR);
        expect(result.isStale).toBe(true);
        expect(result.detail).toContain('from_the_future');
        expect(result.hint).toMatch(/out of sync/);
    });
});

describe('describeStatus / translation', () => {
    it('routes every string through the injected gettext', () => {
        const gettext = vi.fn(text => `[${text}]`);
        const result = describeStatus({code: StatusCode.TOKEN_REJECTED},
            {...opts, gettext});

        expect(gettext).toHaveBeenCalled();
        expect(result.title).toBe('[Claude rejected the saved token]');
    });

    it('leaves an unknown placeholder intact rather than printing "undefined"', () => {
        // A translation that invented a placeholder must not corrupt the message.
        const gettext = () => 'Gone since {nosuchkey}.';
        const result = describeStatus({
            code: StatusCode.NOT_SIGNED_IN,
            params: {path: '/home/me/.claude'},
        }, {...opts, gettext});

        expect(result.detail).toBe('Gone since {nosuchkey}.');
    });
});
