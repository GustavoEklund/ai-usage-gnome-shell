// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The Claude provider. Everything Claude-specific lives under this directory;
// adding another provider means adding a sibling that exports the same three
// things and one line in ../../registry.js. See docs/adding-a-provider.md.
//
// Note the deliberate asymmetry between the two halves of an account snapshot:
//
//   * the percentages come from the API and therefore need a live token;
//   * the token history comes from local transcripts and needs nothing.
//
// So an expired token freezes the first and leaves the second current, and the
// status the UI shows says exactly that rather than claiming everything is stale.

import {startOfWeekKey} from '../../calendar.js';
import {entryFor, isBackingOff} from '../../cache.js';
import {backoffSeconds, shouldFetchLimits} from './refreshPolicy.js';
import {redactError} from '../../../lib/redact.js';
import {StatusCode} from '../../../lib/status.js';
import {readCredentials, readIdentity} from './credentials.js';
import {buildModels, buildWeek, scan} from './ledger.js';
import {mapLimits} from './limits.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

/** Matches what Claude Code itself sends; the endpoint rejects a bare bearer. */
const OAUTH_BETA = 'oauth-2025-04-20';

const OK_STATUS = {code: StatusCode.OK, since: null, params: {}};

/**
 * @param {number} ms
 * @returns {string}
 */
function iso(ms) {
    return new Date(ms).toISOString();
}

/**
 * @param {string} token
 * @param {string} userAgent
 * @returns {object}
 */
function requestHeaders(token, userAgent) {
    return {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': userAgent,
        'Accept': 'application/json',
    };
}

/**
 * Ask the API for the current limits, and work out what the answer means.
 *
 * @param {object} input
 * @param {object} input.http
 * @param {string} input.token
 * @param {string} input.userAgent
 * @param {number} input.now
 * @param {object} input.entry Cached state for this account.
 * @returns {Promise<{limits: ?Array, status: object, lastSuccessAt: ?string,
 *                   retryAfter: ?string, strikes: number}>}
 */
async function fetchLimits({http, token, userAgent, now, entry}) {
    const strikes = entry.rateLimitStrikes ?? 0;
    const unchanged = {
        limits: entry.limits,
        lastSuccessAt: entry.lastSuccessAt,
        retryAfter: entry.retryAfter,
        strikes,
    };

    let response;
    try {
        response = await http.get(USAGE_URL, requestHeaders(token, userAgent));
    } catch (error) {
        return {
            ...unchanged,
            status: {
                code: StatusCode.NETWORK_ERROR,
                since: entry.lastSuccessAt,
                params: {lastSuccessAt: entry.lastSuccessAt, reason: redactError(error)},
            },
        };
    }

    if (response.status === 200) {
        return {
            limits: mapLimits(response.body),
            status: OK_STATUS,
            lastSuccessAt: iso(now),
            retryAfter: null,
            // A success clears the record, so the next refusal starts over.
            strikes: 0,
        };
    }

    if (response.status === 401) {
        // The token had not expired by its own timestamp, so this is a revocation
        // rather than the ordinary staleness token_expired describes.
        return {
            ...unchanged,
            status: {code: StatusCode.TOKEN_REJECTED, since: iso(now), params: {}},
        };
    }

    if (response.status === 429) {
        const retryAfter = iso(now + backoffSeconds(response.headers, strikes) * 1000);
        return {
            ...unchanged,
            retryAfter,
            strikes: strikes + 1,
            status: {
                code: StatusCode.RATE_LIMITED,
                since: iso(now),
                params: {retryAt: retryAfter},
            },
        };
    }

    return {
        ...unchanged,
        status: {
            code: StatusCode.NETWORK_ERROR,
            since: entry.lastSuccessAt,
            params: {
                lastSuccessAt: entry.lastSuccessAt,
                reason: `HTTP ${response.status}`,
            },
        },
    };
}

/**
 * Rebuild the week and per-model totals from the local transcripts. Needs no
 * credentials, so it runs even when the API half has failed.
 *
 * @param {object} input
 * @param {object} input.fs
 * @param {Array} input.files Already listed by the caller; stat only.
 * @param {object} input.entry
 * @param {number} input.now
 * @param {string} [input.timeZone]
 * @returns {{week: object, models: Array, scanState: object}}
 */
function readLedger({fs, files, entry, now, timeZone}) {
    const weekStart = startOfWeekKey(now, timeZone);
    const {state} = scan({
        state: entry.scanState,
        files,
        readChunk: fs.readChunk,
        weekStart,
        timeZone,
    });
    return {week: buildWeek(state), models: buildModels(state), scanState: state};
}

export default {
    id: 'claude',
    displayName: 'Claude',
    iconName: 'ai-usage-claude-symbolic',

    /**
     * One account per configuration directory. Claude Code keeps a single
     * sign-in per directory, so "which accounts exist" is "which directories
     * were configured".
     *
     * @param {object} ctx
     * @returns {Array<{id: string, path: string}>}
     */
    discoverAccounts(ctx) {
        return ctx.configDirs.map(path => ({id: `claude:${path}`, path}));
    },

    /**
     * @param {object} ctx
     * @param {object} account
     * @param {object} cache
     * @returns {Promise<{account: object, entry: object}>}
     */
    async fetchAccount(ctx, account, cache) {
        const {fs, http, now, timeZone, userAgent} = ctx;
        const entry = entryFor(cache, account.id);

        const dirExists = fs.exists(account.path);
        const credentials = readCredentials({
            path: account.path,
            dirExists,
            credentialsText: fs.readText(`${account.path}/.credentials.json`),
            now,
        });
        // Claude Code keeps the profile next to the config directory, not inside
        // it: ~/.claude -> ~/.claude.json.
        const identity = readIdentity(fs.readText(`${account.path}.json`));

        // Listed before the request, deliberately: this is stat, not parsing, so
        // it allocates nothing, and the newest timestamp answers whether anything
        // could have changed since the last successful call.
        const files = dirExists ? fs.listTranscripts(`${account.path}/projects`) : [];
        const newestActivityMs = files.reduce(
            (newest, file) => Math.max(newest, file.mtimeMs), 0);

        let limits = entry.limits;
        let {status} = credentials;
        let lastSuccessAt = entry.lastSuccessAt;
        let retryAfter = entry.retryAfter;

        // The request goes first, and is fully settled before the scan starts.
        // Reading the transcripts allocates hard enough to have GJS collecting
        // garbage, and GJS refuses to run an async GIO callback during a
        // collection — a pending request would simply never come back.
        let strikes = entry.rateLimitStrikes ?? 0;

        if (credentials.token !== null && isBackingOff(entry, now)) {
            status = {
                code: StatusCode.RATE_LIMITED,
                since: null,
                params: {retryAt: entry.retryAfter},
            };
        } else if (credentials.token !== null) {
            const worthAsking = shouldFetchLimits({
                hasCachedLimits: limits !== null,
                lastSuccessAt,
                newestActivityMs,
                now,
            });

            if (worthAsking) {
                const fetched = await fetchLimits({
                    http, token: credentials.token, userAgent, now, entry,
                });
                ({limits, status, lastSuccessAt, retryAfter, strikes} = fetched);
            } else {
                // Nothing has been written locally since the last answer, so the
                // percentages cannot have moved. The cached ones are current.
                status = OK_STATUS;
            }
        }

        const ledger = readLedger({fs, files, entry, now, timeZone});

        return {
            account: {
                id: account.id,
                label: identity.email ?? account.path,
                organizationName: identity.organizationName,
                plan: credentials.plan,
                status,
                limits: limits ?? [],
                week: ledger.week,
                models: ledger.models,
            },
            entry: {
                scanState: ledger.scanState,
                limits,
                lastSuccessAt,
                retryAfter,
                rateLimitStrikes: strikes,
            },
        };
    },
};
