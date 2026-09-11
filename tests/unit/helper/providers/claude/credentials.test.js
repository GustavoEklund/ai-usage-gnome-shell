// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    readCredentials,
    readIdentity,
} from '../../../../../src/helper/providers/claude/credentials.js';
import {StatusCode} from '../../../../../src/lib/status.js';

const NOW = Date.parse('2026-09-11T16:32:00Z');
const PATH = '/home/me/.claude';

const credentialsJson = (overrides = {}) => JSON.stringify({
    claudeAiOauth: {
        accessToken: 'sk-ant-oat01-secret-value',
        refreshToken: 'sk-ant-ort01-secret-value',
        expiresAt: NOW + 3600000,
        subscriptionType: 'team',
        rateLimitTier: 'default_claude_max_5x',
        ...overrides,
    },
});

const read = (credentialsText, extra = {}) =>
    readCredentials({path: PATH, dirExists: true, credentialsText, now: NOW, ...extra});

describe('readCredentials / signed in', () => {
    it('hands back the token and the plan when the session is live', () => {
        const result = read(credentialsJson());
        expect(result.status.code).toBe(StatusCode.OK);
        expect(result.token).toBe('sk-ant-oat01-secret-value');
        expect(result.plan).toEqual({
            rateLimitTier: 'default_claude_max_5x',
            subscriptionType: 'team',
        });
    });

    it('accepts credentials with no expiry recorded', () => {
        expect(read(credentialsJson({expiresAt: undefined})).status.code).toBe(StatusCode.OK);
    });
});

describe('readCredentials / expired', () => {
    it('reports the freeze and says exactly when it started', () => {
        const expiredAt = NOW - 7200000;
        const result = read(credentialsJson({expiresAt: expiredAt}));

        expect(result.status.code).toBe(StatusCode.TOKEN_EXPIRED);
        expect(result.status.params.expiredAt).toBe(new Date(expiredAt).toISOString());
        expect(result.status.since).toBe(new Date(expiredAt).toISOString());
    });

    it('withholds the token so nothing tries to use it', () => {
        expect(read(credentialsJson({expiresAt: NOW - 1})).token).toBeNull();
    });

    it('still reports the plan, so the account header survives the freeze', () => {
        expect(read(credentialsJson({expiresAt: NOW - 1})).plan.rateLimitTier)
            .toBe('default_claude_max_5x');
    });

    it('treats the exact expiry instant as expired', () => {
        expect(read(credentialsJson({expiresAt: NOW})).status.code)
            .toBe(StatusCode.TOKEN_EXPIRED);
    });
});

describe('readCredentials / nothing to read', () => {
    it('distinguishes "Claude Code is not here" from "not signed in"', () => {
        const missing = readCredentials({
            path: PATH, dirExists: false, credentialsText: null, now: NOW,
        });
        expect(missing.status).toMatchObject({
            code: StatusCode.CONFIG_NOT_FOUND, params: {path: PATH},
        });
        expect(read(null).status.code).toBe(StatusCode.NOT_SIGNED_IN);
    });

    it('treats an unreadable or unexpected credentials file as not signed in', () => {
        expect(read('{ broken').status.code).toBe(StatusCode.NOT_SIGNED_IN);
        expect(read('{}').status.code).toBe(StatusCode.NOT_SIGNED_IN);
        expect(read('{"claudeAiOauth":{}}').status.code).toBe(StatusCode.NOT_SIGNED_IN);
        expect(read('null').status.code).toBe(StatusCode.NOT_SIGNED_IN);
    });

    it('never invents a token or a plan when it cannot read one', () => {
        const result = read(null);
        expect(result.token).toBeNull();
        expect(result.plan).toEqual({rateLimitTier: null, subscriptionType: null});
    });

    it('tolerates credentials that omit the plan fields', () => {
        const result = read(JSON.stringify({claudeAiOauth: {accessToken: 'x'}}));
        expect(result.status.code).toBe(StatusCode.OK);
        expect(result.plan).toEqual({rateLimitTier: null, subscriptionType: null});
    });
});

describe('readIdentity', () => {
    it('names the account and the organisation', () => {
        expect(readIdentity(JSON.stringify({
            oauthAccount: {emailAddress: 'me@example.com', organizationName: 'Acme'},
        }))).toEqual({email: 'me@example.com', organizationName: 'Acme'});
    });

    it('costs a nicer label, never the numbers, when it cannot be read', () => {
        const nothing = {email: null, organizationName: null};
        expect(readIdentity(null)).toEqual(nothing);
        expect(readIdentity('{ broken')).toEqual(nothing);
        expect(readIdentity('{}')).toEqual(nothing);
        expect(readIdentity(JSON.stringify({oauthAccount: {}}))).toEqual(nothing);
    });
});
