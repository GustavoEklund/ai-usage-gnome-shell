// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// What the helper remembers between runs, per account:
//
//   * the incremental scan offsets, which are what make a refresh nearly free;
//   * the last limits it successfully fetched, so an expired token or a dropped
//     connection degrades into old numbers with an explanation rather than a
//     blank popup;
//   * a backoff deadline, so a 429 is not answered by hammering.
//
// Never a token. The cache file is written to ~/.cache and is not a place for a
// credential to live; the provider passes the token straight from the credentials
// file to the request and nowhere else.
//
// Pure: the caller reads and writes the file.

const CACHE_VERSION = 1;

/**
 * @returns {object}
 */
export function emptyCache() {
    return {version: CACHE_VERSION, accounts: {}};
}

/**
 * @param {?string} text
 * @returns {object}
 */
export function parseCache(text) {
    if (typeof text !== 'string')
        return emptyCache();

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // A truncated or hand-edited cache is not worth recovering: it is a cache.
        return emptyCache();
    }

    if (parsed?.version !== CACHE_VERSION || typeof parsed.accounts !== 'object' ||
        parsed.accounts === null)
        return emptyCache();

    return {version: CACHE_VERSION, accounts: parsed.accounts};
}

/**
 * @param {object} cache
 * @returns {string}
 */
export function serializeCache(cache) {
    return JSON.stringify({version: CACHE_VERSION, accounts: cache.accounts});
}

/**
 * @param {object} cache
 * @param {string} accountId
 * @returns {object}
 */
export function entryFor(cache, accountId) {
    return cache.accounts[accountId] ?? {
        scanState: null,
        limits: null,
        lastSuccessAt: null,
        retryAfter: null,
    };
}

/**
 * @param {object} cache
 * @param {string} accountId
 * @param {object} changes
 * @returns {object} A new cache; the input is not modified.
 */
export function updateEntry(cache, accountId, changes) {
    return {
        version: CACHE_VERSION,
        accounts: {
            ...cache.accounts,
            [accountId]: {...entryFor(cache, accountId), ...changes},
        },
    };
}

/**
 * Drop accounts that are no longer configured, so the file does not grow
 * forever as config directories come and go.
 *
 * @param {object} cache
 * @param {string[]} accountIds
 * @returns {object}
 */
export function pruneCache(cache, accountIds) {
    const keep = new Set(accountIds);
    const accounts = {};
    for (const [id, entry] of Object.entries(cache.accounts)) {
        if (keep.has(id))
            accounts[id] = entry;
    }
    return {version: CACHE_VERSION, accounts};
}

/**
 * Whether a backoff deadline is still in the future.
 *
 * @param {object} entry
 * @param {number} now
 * @returns {boolean}
 */
export function isBackingOff(entry, now) {
    if (typeof entry.retryAfter !== 'string')
        return false;
    const deadline = Date.parse(entry.retryAfter);
    return Number.isFinite(deadline) && deadline > now;
}
