// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The list of providers, and the loop that asks each of them for a snapshot.
//
// To add a provider: write a module exporting {id, displayName, iconName,
// discoverAccounts, fetchAccount}, import it here, add it to PROVIDERS. Nothing
// in the shell process changes — the UI renders whatever limits come back.

import {pruneCache, updateEntry} from './cache.js';
import {redactError} from '../lib/redact.js';
import {SCHEMA_VERSION} from '../lib/snapshot.js';
import {StatusCode} from '../lib/status.js';
import claude from './providers/claude/index.js';

/** Every provider this build knows how to talk to. */
export const PROVIDERS = [claude];

/**
 * @param {string[]} enabledIds
 * @returns {Array<object>}
 */
export function providersFor(enabledIds) {
    return PROVIDERS.filter(provider => enabledIds.includes(provider.id));
}

/**
 * An account entry standing in for one that could not be read at all, so a
 * provider throwing does not cost the whole popup.
 *
 * @param {object} account
 * @param {*} error
 * @returns {object}
 */
function failedAccount(account, error) {
    return {
        id: account.id,
        label: account.path ?? account.id,
        organizationName: null,
        plan: {rateLimitTier: null, subscriptionType: null},
        status: {
            code: StatusCode.HELPER_ERROR,
            since: null,
            params: {reason: redactError(error)},
        },
        limits: [],
        week: {startsOn: 'sunday', start: null, days: []},
        models: [],
    };
}

/**
 * Ask one provider for every account it can see.
 *
 * @param {object} provider
 * @param {object} ctx
 * @param {object} cache
 * @returns {Promise<{block: object, entries: Array, ids: string[]}>}
 */
async function collectProvider(provider, ctx, cache) {
    const accounts = provider.discoverAccounts(ctx);

    const results = await Promise.all(accounts.map(async account => {
        try {
            const {account: snapshot, entry} = await provider.fetchAccount(ctx, account, cache);
            return {id: account.id, snapshot, entry};
        } catch (error) {
            // One unreadable account must not take the others down with it.
            return {id: account.id, snapshot: failedAccount(account, error), entry: null};
        }
    }));

    return {
        block: {
            id: provider.id,
            displayName: provider.displayName,
            iconName: provider.iconName,
            accounts: results.map(result => result.snapshot),
        },
        entries: results.filter(result => result.entry !== null),
        ids: accounts.map(account => account.id),
    };
}

/**
 * Build the whole snapshot, and the cache to write alongside it.
 *
 * @param {object} ctx
 * @param {object} options
 * @param {string[]} options.enabledProviders
 * @param {object} options.cache
 * @returns {Promise<{snapshot: object, cache: object}>}
 */
export async function collect(ctx, {enabledProviders, cache}) {
    const providers = providersFor(enabledProviders);
    const collected = await Promise.all(
        providers.map(provider => collectProvider(provider, ctx, cache)));

    let nextCache = cache;
    const seenIds = [];
    for (const {entries, ids} of collected) {
        seenIds.push(...ids);
        for (const {id, entry} of entries)
            nextCache = updateEntry(nextCache, id, entry);
    }

    return {
        snapshot: {
            schemaVersion: SCHEMA_VERSION,
            generatedAt: new Date(ctx.now).toISOString(),
            providers: collected.map(result => result.block),
        },
        cache: pruneCache(nextCache, seenIds),
    };
}
