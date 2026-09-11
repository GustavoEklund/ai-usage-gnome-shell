// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Nothing this process logs may contain a credential. The helper reads an OAuth
// access token and a refresh token out of ~/.claude/.credentials.json, and the
// natural failure paths — "the API said this", "parsing that file threw" — are
// exactly the paths that would carry one into a log file or into the snapshot the
// shell reads. Every error string goes through here first.

// Anthropic OAuth tokens are long opaque strings with a recognisable prefix, but
// the prefix is not guaranteed, so length is the real signal: anything 40+ chars
// of token alphabet is treated as a secret regardless of what it is.
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{40,}\b/g;

// JSON fields that hold secrets, redacted even when the value is short.
const SECRET_FIELDS = /("(?:access_?[Tt]oken|refresh_?[Tt]oken|client_?[Ss]ecret|api_?[Kk]ey)"\s*:\s*)"[^"]*"/g;

const PLACEHOLDER = '[redacted]';

/**
 * Strip anything that could be a credential from a string.
 *
 * @param {*} value
 * @returns {string}
 */
export function redact(value) {
    if (value === null || value === undefined)
        return '';

    return String(value)
        .replace(SECRET_FIELDS, `$1"${PLACEHOLDER}"`)
        .replace(TOKEN_LIKE, PLACEHOLDER);
}

/**
 * A short, safe one-line description of a thrown value, for a status `reason`.
 *
 * @param {*} error
 * @param {number} [maxLength]
 * @returns {string}
 */
export function redactError(error, maxLength = 200) {
    const message = error?.message ?? error;
    const safe = redact(message).replace(/\s+/g, ' ').trim();
    if (safe === '')
        return 'unknown error';
    return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}…` : safe;
}
