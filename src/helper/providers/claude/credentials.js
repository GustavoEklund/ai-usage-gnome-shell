// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Reads Claude Code's own sign-in state. Strictly read-only, by design.
//
// The obvious way to keep the numbers fresh would be for this extension to
// refresh the OAuth token itself. It deliberately does not. Anthropic rotates the
// refresh token on use, so an extension refreshing on a timer races Claude Code
// doing the same, and the loser of that race gets invalid_grant — which signs the
// user out of their editor because a status icon wanted a newer number. Reading
// and reporting is worth far more than that risk.
//
// The cost is that an expired token freezes the display, so the freeze is
// reported explicitly rather than hidden: see StatusCode.TOKEN_EXPIRED. In
// practice it costs little, because the session percentage only moves when Claude
// Code runs, and running Claude Code is what refreshes the token.
//
// Takes file contents, not paths: the caller does the IO.

import {StatusCode} from '../../../lib/status.js';

const OK = Object.freeze({code: StatusCode.OK, since: null, params: {}});

/**
 * @param {string} code
 * @param {object} [params]
 * @param {?string} [since]
 * @returns {object}
 */
function status(code, params = {}, since = null) {
    return {code, since, params};
}

/**
 * @param {?string} text
 * @returns {?object}
 */
function parseJson(text) {
    if (typeof text !== 'string')
        return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Work out whether we can talk to the API on this account's behalf.
 *
 * The access token is returned separately from everything else and must never be
 * copied into a snapshot, a log line or a cache file.
 *
 * @param {object} input
 * @param {string} input.path The configuration directory this came from.
 * @param {boolean} input.dirExists
 * @param {?string} input.credentialsText Contents of .credentials.json, or null.
 * @param {number} input.now
 * @returns {{status: object, token: ?string, plan: object}}
 */
export function readCredentials({path, dirExists, credentialsText, now}) {
    const none = {token: null, plan: {rateLimitTier: null, subscriptionType: null}};

    if (!dirExists)
        return {...none, status: status(StatusCode.CONFIG_NOT_FOUND, {path})};

    const oauth = parseJson(credentialsText)?.claudeAiOauth;
    if (!oauth?.accessToken)
        return {...none, status: status(StatusCode.NOT_SIGNED_IN, {path})};

    const plan = {
        rateLimitTier: oauth.rateLimitTier ?? null,
        subscriptionType: oauth.subscriptionType ?? null,
    };

    const expiresAt = Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null;
    if (expiresAt !== null && expiresAt <= now) {
        const expiredAtIso = new Date(expiresAt).toISOString();
        return {
            token: null,
            plan,
            status: status(StatusCode.TOKEN_EXPIRED, {expiredAt: expiredAtIso}, expiredAtIso),
        };
    }

    return {token: oauth.accessToken, plan, status: OK};
}

/**
 * Who the account belongs to, from ~/.claude.json. Purely cosmetic: a missing or
 * unreadable file costs a nicer label, never the usage numbers.
 *
 * @param {?string} configText
 * @returns {{email: ?string, organizationName: ?string}}
 */
export function readIdentity(configText) {
    const account = parseJson(configText)?.oauthAccount;
    return {
        email: account?.emailAddress ?? null,
        organizationName: account?.organizationName ?? null,
    };
}
