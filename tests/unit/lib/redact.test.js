// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {redact, redactError} from '../../../src/lib/redact.js';

// A token shaped like the real thing: long, opaque, token alphabet.
const TOKEN = 'sk-ant-oat01-vK9xQ2mZ7pLr4tN8wYbA3cEfGhJkMnPqRsTuVwXyZ012345';

describe('redact', () => {
    it('removes a bare token from an arbitrary message', () => {
        const out = redact(`request failed with ${TOKEN} attached`);
        expect(out).not.toContain(TOKEN);
        expect(out).toBe('request failed with [redacted] attached');
    });

    it('removes secrets from a JSON blob even when the value is short', () => {
        const out = redact('{"accessToken":"abc","refreshToken":"def","keep":"me"}');
        expect(out).toBe('{"accessToken":"[redacted]","refreshToken":"[redacted]","keep":"me"}');
    });

    it('covers the snake_case spellings too', () => {
        expect(redact('{"access_token":"x","client_secret":"y","api_key":"z"}'))
            .toBe('{"access_token":"[redacted]","client_secret":"[redacted]","api_key":"[redacted]"}');
    });

    it('leaves ordinary text alone', () => {
        expect(redact('could not reach api.anthropic.com')).toBe('could not reach api.anthropic.com');
        expect(redact('HTTP 401')).toBe('HTTP 401');
    });

    it('never returns null or undefined', () => {
        expect(redact(null)).toBe('');
        expect(redact(undefined)).toBe('');
        expect(redact(0)).toBe('0');
    });
});

describe('redactError', () => {
    it('flattens a thrown Error into one safe line', () => {
        const error = new Error(`bad token\n  ${TOKEN}\n  at foo()`);
        const out = redactError(error);
        expect(out).not.toContain(TOKEN);
        expect(out).toBe('bad token [redacted] at foo()');
    });

    it('accepts a thrown string as readily as an Error', () => {
        expect(redactError('boom')).toBe('boom');
    });

    it('always says something', () => {
        expect(redactError(undefined)).toBe('unknown error');
        expect(redactError(new Error(''))).toBe('unknown error');
        expect(redactError('   ')).toBe('unknown error');
    });

    it('truncates so a status line cannot become a wall of text', () => {
        // Words, not one long run: a 500-character token-alphabet blob would be
        // redacted down to a placeholder before truncation ever mattered.
        const out = redactError('failed '.repeat(80));
        expect(out).toHaveLength(200);
        expect(out.endsWith('…')).toBe(true);
    });
});
