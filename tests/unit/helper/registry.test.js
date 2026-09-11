// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {collect, PROVIDERS, providersFor} from '../../../src/helper/registry.js';
import {emptyCache, updateEntry} from '../../../src/helper/cache.js';
import {SCHEMA_VERSION} from '../../../src/lib/snapshot.js';
import {StatusCode} from '../../../src/lib/status.js';

const NOW = Date.parse('2026-09-11T16:32:00Z');

/** A provider that answers instantly, for testing the loop rather than Claude. */
function stubProvider({id = 'stub', accounts = ['a'], fetchAccount} = {}) {
    return {
        id,
        displayName: id.toUpperCase(),
        iconName: `${id}-symbolic`,
        discoverAccounts: () => accounts.map(name => ({id: `${id}:${name}`, path: `/${name}`})),
        fetchAccount: fetchAccount ?? (async (ctx, account) => ({
            account: {id: account.id, label: account.id, limits: [], week: {days: []}, models: [],
                status: {code: StatusCode.OK, since: null, params: {}}},
            entry: {scanState: null, limits: [], lastSuccessAt: '2026-09-11T16:32:00Z',
                retryAfter: null},
        })),
    };
}

/** collect() reads PROVIDERS directly, so swap it for the duration of a test. */
async function withProviders(providers, run) {
    const original = PROVIDERS.splice(0, PROVIDERS.length, ...providers);
    try {
        return await run();
    } finally {
        PROVIDERS.splice(0, PROVIDERS.length, ...original);
    }
}

describe('PROVIDERS', () => {
    it('ships Claude, and nothing pretends to be a second provider yet', () => {
        expect(PROVIDERS.map(p => p.id)).toEqual(['claude']);
    });
});

describe('providersFor', () => {
    it('selects only the providers the user enabled', () => {
        expect(providersFor(['claude']).map(p => p.id)).toEqual(['claude']);
        expect(providersFor([])).toEqual([]);
        expect(providersFor(['nope'])).toEqual([]);
    });
});

describe('collect', () => {
    const ctx = {now: NOW, configDirs: ['/a']};

    it('builds a snapshot the shell can read', async () => {
        const result = await withProviders([stubProvider()],
            () => collect(ctx, {enabledProviders: ['stub'], cache: emptyCache()}));

        expect(result.snapshot.schemaVersion).toBe(SCHEMA_VERSION);
        expect(result.snapshot.generatedAt).toBe('2026-09-11T16:32:00.000Z');
        expect(result.snapshot.providers).toHaveLength(1);
        expect(result.snapshot.providers[0]).toMatchObject({
            id: 'stub', displayName: 'STUB', iconName: 'stub-symbolic',
        });
        expect(result.cache.accounts['stub:a'].lastSuccessAt).toBe('2026-09-11T16:32:00Z');
    });

    it('asks every enabled provider, and no disabled one', async () => {
        const result = await withProviders([stubProvider({id: 'one'}), stubProvider({id: 'two'})],
            () => collect(ctx, {enabledProviders: ['two'], cache: emptyCache()}));

        expect(result.snapshot.providers.map(p => p.id)).toEqual(['two']);
    });

    it('keeps going when one account cannot be read at all', async () => {
        const provider = stubProvider({
            accounts: ['good', 'bad'],
            fetchAccount: async (_ctx, account) => {
                if (account.id.endsWith('bad'))
                    throw new Error('permission denied');
                return {
                    account: {id: account.id, label: 'fine', limits: [], week: {days: []},
                        models: [], status: {code: StatusCode.OK, since: null, params: {}}},
                    entry: {scanState: null, limits: [], lastSuccessAt: null, retryAfter: null},
                };
            },
        });

        const result = await withProviders([provider],
            () => collect(ctx, {enabledProviders: ['stub'], cache: emptyCache()}));

        const [good, bad] = result.snapshot.providers[0].accounts;
        expect(good.status.code).toBe(StatusCode.OK);
        expect(bad.status).toMatchObject({
            code: StatusCode.HELPER_ERROR, params: {reason: 'permission denied'},
        });
        expect(bad.label).toBe('/bad');
        expect(bad.limits).toEqual([]);
        // The failed account contributes no cache entry, so a transient failure
        // never overwrites what was known about it.
        expect(result.cache.accounts).not.toHaveProperty('stub:bad');
        expect(result.cache.accounts).toHaveProperty('stub:good');
    });

    it('names a failed account by its id when the provider gave it no path', async () => {
        const provider = stubProvider({
            fetchAccount: async () => {
                throw new Error('nope');
            },
        });
        provider.discoverAccounts = () => [{id: 'stub:pathless'}];

        const result = await withProviders([provider],
            () => collect(ctx, {enabledProviders: ['stub'], cache: emptyCache()}));
        expect(result.snapshot.providers[0].accounts[0].label).toBe('stub:pathless');
    });

    it('forgets accounts that are no longer configured', async () => {
        const stale = updateEntry(emptyCache(), 'claude:/gone', {lastSuccessAt: 'then'});
        const result = await withProviders([stubProvider()],
            () => collect(ctx, {enabledProviders: ['stub'], cache: stale}));

        expect(Object.keys(result.cache.accounts)).toEqual(['stub:a']);
    });

    it('produces an empty but valid snapshot when nothing is enabled', async () => {
        const result = await collect(ctx, {enabledProviders: [], cache: emptyCache()});
        expect(result.snapshot.providers).toEqual([]);
        expect(result.cache.accounts).toEqual({});
    });
});
