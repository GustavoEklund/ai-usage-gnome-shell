// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    interpretHelperResult,
    isNewProblem,
    overallStatus,
} from '../../../src/lib/pollerLogic.js';
import {SCHEMA_VERSION} from '../../../src/lib/snapshot.js';
import {StatusCode} from '../../../src/lib/status.js';

const goodPayload = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2026-09-11T17:05:12Z',
    providers: [{id: 'claude', displayName: 'Claude', accounts: []}],
});

const ran = overrides => interpretHelperResult({stdout: '', stderr: '', exitStatus: 0, ...overrides});

describe('interpretHelperResult / success', () => {
    it('returns a normalized snapshot and no process-level complaint', () => {
        const result = ran({stdout: goodPayload});
        expect(result.status).toBeNull();
        expect(result.snapshot.providers[0].id).toBe('claude');
    });

    it('tolerates the whitespace a pipe adds', () => {
        expect(ran({stdout: `\n${goodPayload}\n`}).snapshot).not.toBeNull();
    });
});

describe('interpretHelperResult / the helper failed', () => {
    it('reports the exit status and the tail of stderr', () => {
        const result = ran({
            exitStatus: 127,
            stderr: 'line one\nline two\nline three\nline four\n',
        });
        expect(result.snapshot).toBeNull();
        expect(result.status.code).toBe(StatusCode.HELPER_ERROR);
        expect(result.status.params.reason)
            .toBe('exited with status 127: line two; line three; line four');
    });

    it('still says something when it failed silently', () => {
        expect(ran({exitStatus: 1}).status.params.reason).toBe('exited with status 1');
        expect(ran({exitStatus: 1, stderr: '  \n \n'}).status.params.reason)
            .toBe('exited with status 1');
    });

    it('copes with a pipe that yielded nothing at all', () => {
        // Gio hands back null, not an empty string, when a stream was never written.
        expect(interpretHelperResult({exitStatus: 1}).status.params.reason)
            .toBe('exited with status 1');
        expect(interpretHelperResult({exitStatus: 0}).status.params.reason)
            .toBe('the helper produced no output');
    });

    it('never lets a token reach the UI through stderr', () => {
        const token = 'sk-ant-oat01-vK9xQ2mZ7pLr4tN8wYbA3cEfGhJkMnPqRsTuVwXyZ012345';
        const result = ran({exitStatus: 1, stderr: `auth failed for ${token}`});
        expect(result.status.params.reason).not.toContain(token);
        expect(result.status.params.reason).toContain('[redacted]');
    });
});

describe('interpretHelperResult / the output is unusable', () => {
    it('complains about an empty pipe instead of showing a blank popup', () => {
        expect(ran({stdout: '   '}).status.params.reason).toBe('the helper produced no output');
    });

    it('complains about output it cannot parse', () => {
        const result = ran({stdout: '{"schemaVersion": '});
        expect(result.snapshot).toBeNull();
        expect(result.status.code).toBe(StatusCode.HELPER_ERROR);
        expect(result.status.params.reason).toMatch(/JSON/i);
    });

    it('refuses a payload from a different build rather than guessing', () => {
        const result = ran({stdout: JSON.stringify({schemaVersion: 99, providers: []})});
        expect(result.snapshot).toBeNull();
        expect(result.status.params.reason)
            .toBe(`helper speaks schema 99, this build expects ${SCHEMA_VERSION}`);
    });

    it('refuses output with no schema version at all', () => {
        expect(ran({stdout: '{"providers":[]}'}).snapshot).toBeNull();
        expect(ran({stdout: 'null'}).status.code).toBe(StatusCode.HELPER_ERROR);
    });
});

describe('overallStatus', () => {
    const withStatuses = (...codes) => ({
        providers: [{accounts: codes.map(code => ({status: {code, since: null, params: {}}}))}],
    });

    it('is healthy when every account is', () => {
        expect(overallStatus(withStatuses('ok', 'ok')).code).toBe(StatusCode.OK);
    });

    it('surfaces the most severe problem across accounts', () => {
        expect(overallStatus(withStatuses('ok', StatusCode.TOKEN_EXPIRED)).code)
            .toBe(StatusCode.TOKEN_EXPIRED);
        // not_signed_in is an error, token_expired only a warning.
        expect(overallStatus(withStatuses(StatusCode.TOKEN_EXPIRED, StatusCode.NOT_SIGNED_IN)).code)
            .toBe(StatusCode.NOT_SIGNED_IN);
        expect(overallStatus(withStatuses(StatusCode.NOT_SIGNED_IN, StatusCode.TOKEN_EXPIRED)).code)
            .toBe(StatusCode.NOT_SIGNED_IN);
    });

    it('lets a process-level failure outrank everything, since nothing else was read', () => {
        const processStatus = {code: StatusCode.HELPER_ERROR, since: null, params: {}};
        expect(overallStatus(withStatuses(StatusCode.TOKEN_EXPIRED), processStatus))
            .toBe(processStatus);
    });

    it('is healthy when there is no snapshot to inspect', () => {
        expect(overallStatus(null).code).toBe(StatusCode.OK);
        expect(overallStatus({providers: [{}]}).code).toBe(StatusCode.OK);
    });
});

describe('isNewProblem', () => {
    it('fires once when a problem appears', () => {
        expect(isNewProblem({code: StatusCode.OK}, {code: StatusCode.TOKEN_EXPIRED})).toBe(true);
        expect(isNewProblem(null, {code: StatusCode.TOKEN_EXPIRED})).toBe(true);
    });

    it('stays quiet while the same problem persists', () => {
        expect(isNewProblem({code: StatusCode.TOKEN_EXPIRED}, {code: StatusCode.TOKEN_EXPIRED}))
            .toBe(false);
    });

    it('fires again when the problem changes into a different one', () => {
        expect(isNewProblem({code: StatusCode.TOKEN_EXPIRED}, {code: StatusCode.NOT_SIGNED_IN}))
            .toBe(true);
    });

    it('never fires on recovery', () => {
        expect(isNewProblem({code: StatusCode.TOKEN_EXPIRED}, {code: StatusCode.OK})).toBe(false);
    });
});
