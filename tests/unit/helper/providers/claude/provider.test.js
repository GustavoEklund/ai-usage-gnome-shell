// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import provider, {backoffSeconds}
    from '../../../../../src/helper/providers/claude/index.js';
import {emptyCache, updateEntry} from '../../../../../src/helper/cache.js';
import {StatusCode} from '../../../../../src/lib/status.js';
import {fakeFs, fakeHttp} from '../../../../support/fakes.js';

const usageBody = JSON.parse(
    readFileSync(new URL('../../../../fixtures/usage-response.json', import.meta.url), 'utf8'));

const NOW = Date.parse('2026-09-11T16:32:00Z');
const DIR = '/home/me/.claude';
const ACCOUNT = {id: `claude:${DIR}`, path: DIR};

const credentials = (overrides = {}) => JSON.stringify({
    claudeAiOauth: {
        accessToken: 'sk-ant-oat01-live-token',
        expiresAt: NOW + 3600000,
        subscriptionType: 'team',
        rateLimitTier: 'default_claude_max_5x',
        ...overrides,
    },
});

const transcript = JSON.stringify({
    type: 'assistant', timestamp: '2026-09-10T12:00:00Z', requestId: 'req_1',
    message: {id: 'msg_1', model: 'claude-opus-5',
        usage: {input_tokens: 2, output_tokens: 100, cache_creation_input_tokens: 50,
            cache_read_input_tokens: 1000}},
}) + '\n';

function setup({creds = credentials(), files = {}, http = fakeHttp({status: 200, body: usageBody}),
    cache = emptyCache(), dirExists = true} = {}) {
    const fs = fakeFs({
        [`${DIR}/.credentials.json`]: creds,
        [`${DIR}.json`]: JSON.stringify({
            oauthAccount: {emailAddress: 'me@example.com', organizationName: 'OKTO Payments'},
        }),
        [`${DIR}/projects/proj/session.jsonl`]: transcript,
        ...files,
    }, {dirs: dirExists ? [DIR] : []});

    const ctx = {fs, http, now: NOW, timeZone: 'UTC', configDirs: [DIR],
        userAgent: 'ai-usage-gnome-shell/0.1.0'};
    return {ctx, http, run: () => provider.fetchAccount(ctx, ACCOUNT, cache)};
}

describe('discoverAccounts', () => {
    it('reports one account per configured directory', () => {
        expect(provider.discoverAccounts({configDirs: ['/a', '/b']}))
            .toEqual([{id: 'claude:/a', path: '/a'}, {id: 'claude:/b', path: '/b'}]);
    });
});

describe('fetchAccount / healthy', () => {
    it('returns limits from the API and history from the transcripts', async () => {
        const {run} = setup();
        const {account, entry} = await run();

        expect(account.status.code).toBe(StatusCode.OK);
        expect(account.label).toBe('me@example.com');
        expect(account.organizationName).toBe('OKTO Payments');
        expect(account.plan.rateLimitTier).toBe('default_claude_max_5x');
        expect(account.limits.map(l => l.id))
            .toEqual(['session', 'weekly_all', 'weekly_scoped:fable']);
        expect(account.week.days).toHaveLength(7);
        expect(account.week.days[4]).toMatchObject({date: '2026-09-10', tokens: 1152});
        expect(account.models).toEqual([{id: 'claude-opus-5', tokens: 1152,
            breakdown: {input: 2, output: 100, cacheWrite: 50, cacheRead: 1000}}]);
        expect(entry.lastSuccessAt).toBe('2026-09-11T16:32:00.000Z');
    });

    it('sends the headers the endpoint actually requires', async () => {
        const {http, run} = setup();
        await run();

        expect(http.calls[0].url).toBe('https://api.anthropic.com/api/oauth/usage');
        expect(http.calls[0].headers).toMatchObject({
            'Authorization': 'Bearer sk-ant-oat01-live-token',
            'anthropic-beta': 'oauth-2025-04-20',
            'Accept': 'application/json',
        });
    });

    it('falls back to the directory when the profile has no email', async () => {
        const {run} = setup({files: {[`${DIR}.json`]: '{}'}});
        expect((await run()).account.label).toBe(DIR);
    });
});

describe('fetchAccount / expired token', () => {
    it('keeps the last known limits and explains the freeze', async () => {
        const expiredAt = NOW - 7200000;
        const cache = updateEntry(emptyCache(), ACCOUNT.id, {
            limits: [{id: 'session', role: 'session', percent: 17}],
            lastSuccessAt: '2026-09-11T14:00:00Z',
        });
        const {http, run} = setup({creds: credentials({expiresAt: expiredAt}), cache});
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.TOKEN_EXPIRED);
        expect(account.status.params.expiredAt).toBe(new Date(expiredAt).toISOString());
        expect(account.limits).toEqual([{id: 'session', role: 'session', percent: 17}]);
        expect(http.calls).toHaveLength(0);
    });

    it('still refreshes the token history, which needs no token at all', async () => {
        const {run} = setup({creds: credentials({expiresAt: NOW - 1})});
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.TOKEN_EXPIRED);
        expect(account.week.days[4].tokens).toBe(1152);
        expect(account.models).toHaveLength(1);
    });

    it('shows no percentages rather than stale ones it never had', async () => {
        const {run} = setup({creds: credentials({expiresAt: NOW - 1})});
        expect((await run()).account.limits).toEqual([]);
    });
});

describe('fetchAccount / not usable', () => {
    it('reports a missing configuration directory and reads nothing', async () => {
        const {http, run} = setup({dirExists: false});
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.CONFIG_NOT_FOUND);
        expect(account.week.days.every(day => day.tokens === 0)).toBe(true);
        expect(http.calls).toHaveLength(0);
    });

    it('reports a directory with no credentials in it', async () => {
        const {run} = setup({creds: undefined, files: {[`${DIR}/.credentials.json`]: '{}'}});
        expect((await run()).account.status.code).toBe(StatusCode.NOT_SIGNED_IN);
    });
});

describe('fetchAccount / the API said no', () => {
    it('treats 401 on an unexpired token as a revocation', async () => {
        const cache = updateEntry(emptyCache(), ACCOUNT.id, {limits: [{id: 'session'}]});
        const {run} = setup({http: fakeHttp({status: 401}), cache});
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.TOKEN_REJECTED);
        expect(account.limits).toEqual([{id: 'session'}]);
    });

    it('backs off after a 429 and says until when', async () => {
        const {run} = setup({http: fakeHttp({status: 429, headers: {'retry-after': '120'}})});
        const {account, entry} = await run();

        expect(account.status.code).toBe(StatusCode.RATE_LIMITED);
        expect(account.status.params.retryAt).toBe('2026-09-11T16:34:00.000Z');
        expect(entry.retryAfter).toBe('2026-09-11T16:34:00.000Z');
    });

    it('does not call the API again while the backoff is running', async () => {
        const cache = updateEntry(emptyCache(), ACCOUNT.id,
            {retryAfter: '2026-09-11T16:40:00Z', limits: [{id: 'session'}]});
        const {http, run} = setup({cache});
        const {account} = await run();

        expect(http.calls).toHaveLength(0);
        expect(account.status).toMatchObject({
            code: StatusCode.RATE_LIMITED, params: {retryAt: '2026-09-11T16:40:00Z'},
        });
    });

    it('resumes once the backoff has elapsed', async () => {
        const cache = updateEntry(emptyCache(), ACCOUNT.id,
            {retryAfter: '2026-09-11T16:00:00Z'});
        const {http, run} = setup({cache});

        expect((await run()).account.status.code).toBe(StatusCode.OK);
        expect(http.calls).toHaveLength(1);
    });

    it('reports any other status as a transient failure, naming it', async () => {
        const cache = updateEntry(emptyCache(), ACCOUNT.id,
            {lastSuccessAt: '2026-09-11T14:00:00Z'});
        const {run} = setup({http: fakeHttp({status: 503}), cache});
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.NETWORK_ERROR);
        expect(account.status.params).toEqual({
            lastSuccessAt: '2026-09-11T14:00:00Z', reason: 'HTTP 503',
        });
    });

    it('survives the request throwing, and never leaks the token into the reason', async () => {
        const {run} = setup({
            http: fakeHttp(new Error('connect failed for sk-ant-oat01-vK9xQ2mZ7pLr4tN8wYbA3cEfGhJkMnPqRsTuVwXyZ0')),
        });
        const {account} = await run();

        expect(account.status.code).toBe(StatusCode.NETWORK_ERROR);
        expect(account.status.params.reason).not.toContain('sk-ant-oat01-vK9x');
        expect(account.status.params.reason).toContain('[redacted]');
    });
});

describe('backoffSeconds', () => {
    it('honours a sane Retry-After', () => {
        expect(backoffSeconds({'retry-after': '90'})).toBe(90);
    });

    it('falls back to five minutes when there is no usable header', () => {
        expect(backoffSeconds(undefined)).toBe(300);
        expect(backoffSeconds({})).toBe(300);
        expect(backoffSeconds({'retry-after': 'later'})).toBe(300);
        expect(backoffSeconds({'retry-after': '0'})).toBe(300);
        expect(backoffSeconds({'retry-after': '-5'})).toBe(300);
    });

    it('caps an absurd Retry-After so the indicator cannot be parked for a day', () => {
        expect(backoffSeconds({'retry-after': '999999'})).toBe(3600);
    });
});
