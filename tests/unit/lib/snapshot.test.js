// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    decorateSnapshot,
    emptySnapshot,
    normalizeSnapshot,
    SCHEMA_VERSION,
} from '../../../src/lib/snapshot.js';

const wellFormed = {
    schemaVersion: 1,
    generatedAt: '2026-09-11T17:05:12Z',
    update: {
        current: '0.1.0', latest: '0.2.0', available: true,
        url: 'https://github.com/x/releases/tag/v0.2.0',
        bundleUrl: 'https://github.com/x/a.shell-extension.zip',
        checkedAt: '2026-09-11T16:32:00Z', error: null,
    },
    providers: [{
        id: 'claude',
        displayName: 'Claude',
        iconName: 'ai-usage-claude-symbolic',
        accounts: [{
            id: 'claude:/home/me/.claude',
            label: 'me@example.com',
            organizationName: 'OKTO Payments',
            plan: {rateLimitTier: 'default_claude_max_5x', subscriptionType: 'team'},
            status: {code: 'ok', since: null, params: {}},
            limits: [
                {id: 'session', role: 'session', scopeLabel: null, percent: 21,
                    resetsAt: '2026-09-11T18:30:00Z', severity: 'normal', primary: true},
                {id: 'weekly_all', role: 'weekly', scopeLabel: null, percent: 29,
                    resetsAt: '2026-09-13T22:00:00Z', severity: 'normal', primary: false},
                {id: 'weekly_scoped:fable', role: 'scoped', scopeLabel: 'Fable', percent: 0,
                    resetsAt: '2026-09-13T22:00:00Z', severity: 'normal', primary: false},
            ],
            week: {
                startsOn: 'sunday', start: '2026-09-06',
                days: [{date: '2026-09-06', tokens: 0,
                    breakdown: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}},
                {date: '2026-09-10', tokens: 113619555,
                    breakdown: {input: 800, output: 312000, cacheWrite: 3100000, cacheRead: 110206755}}],
            },
            models: [{id: 'claude-opus-5', tokens: 314539701,
                breakdown: {input: 2100, output: 945910, cacheWrite: 8962606, cacheRead: 304629085}}],
        }],
    }],
};

describe('emptySnapshot', () => {
    it('is a valid snapshot with nothing in it', () => {
        expect(emptySnapshot()).toEqual({
            schemaVersion: SCHEMA_VERSION, generatedAt: null, providers: [], update: null,
        });
    });
});

describe('normalizeSnapshot / well formed input', () => {
    it('passes a complete payload through unchanged', () => {
        expect(normalizeSnapshot(wellFormed)).toEqual(wellFormed);
    });
});

describe('normalizeSnapshot / hostile input', () => {
    it('turns anything unusable into an empty snapshot rather than throwing', () => {
        for (const input of [null, undefined, 42, 'nope', [], {}]) {
            const result = normalizeSnapshot(input);
            expect(result.providers).toEqual([]);
            expect(result.schemaVersion).toBe(SCHEMA_VERSION);
        }
    });

    it('replaces the wrong type in every collection slot with an empty list', () => {
        const result = normalizeSnapshot({
            providers: [{accounts: 'no'}, {accounts: [{limits: 3, models: null, week: 7}]}],
        });
        expect(result.providers[0].accounts).toEqual([]);
        expect(result.providers[1].accounts[0].limits).toEqual([]);
        expect(result.providers[1].accounts[0].models).toEqual([]);
        expect(result.providers[1].accounts[0].week.days).toEqual([]);
    });

    it('substitutes a named placeholder rather than leaving a blank row', () => {
        const [provider] = normalizeSnapshot({providers: [{accounts: [{limits: [{}]}]}]}).providers;
        expect(provider.id).toBe('unknown');
        expect(provider.displayName).toBe('Unknown provider');
        expect(provider.iconName).toBe('application-x-executable-symbolic');

        const [account] = provider.accounts;
        expect(account.label).toBe('Unknown account');
        expect(account.status.code).toBe('ok');
        expect(account.week.startsOn).toBe('sunday');
        expect(account.limits[0]).toMatchObject({
            id: 'unknown', role: 'other', percent: 0, severity: 'normal', primary: false,
        });
    });

    it('rejects non-finite numbers and empty strings', () => {
        const result = normalizeSnapshot({
            generatedAt: '',
            providers: [{accounts: [{
                limits: [{percent: Number.NaN, resetsAt: ''}],
                models: [{tokens: 'lots', breakdown: {input: null}}],
                week: {days: [{tokens: Number.POSITIVE_INFINITY}]},
            }]}],
        });
        const account = result.providers[0].accounts[0];
        expect(result.generatedAt).toBeNull();
        expect(account.limits[0]).toMatchObject({percent: 0, resetsAt: null});
        expect(account.models[0].tokens).toBe(0);
        expect(account.models[0].breakdown.input).toBe(0);
        expect(account.week.days[0].tokens).toBe(0);
        expect(account.week.days[0].date).toBe('');
    });

    it('only accepts a literal true for the primary flag', () => {
        const [limit] = normalizeSnapshot({providers: [{accounts: [{limits: [{primary: 'yes'}]}]}]})
            .providers[0].accounts[0].limits;
        expect(limit.primary).toBe(false);
    });

    it('keeps a schema version it does not recognise, so the caller can refuse it', () => {
        expect(normalizeSnapshot({schemaVersion: 99}).schemaVersion).toBe(99);
    });

    it('treats a missing or unusable update block as "never checked"', () => {
        expect(normalizeSnapshot({}).update).toBeNull();
        expect(normalizeSnapshot({update: 'soon'}).update).toBeNull();
        expect(normalizeSnapshot({update: null}).update).toBeNull();
    });

    it('only believes an explicit true for update availability', () => {
        // Anything less would let a malformed payload nag about an update that
        // does not exist, or worse, offer a download that is not there.
        expect(normalizeSnapshot({update: {available: 'yes'}}).update.available).toBe(false);
        expect(normalizeSnapshot({update: {available: 1}}).update.available).toBe(false);
        expect(normalizeSnapshot({update: {latest: '', url: ''}}).update)
            .toMatchObject({latest: null, url: null});
    });
});

describe('decorateSnapshot', () => {
    const decorated = decorateSnapshot(normalizeSnapshot(wellFormed));
    const account = decorated.providers[0].accounts[0];

    it('names each limit from its role, not from a string the helper sent', () => {
        expect(account.limits.map(l => l.label))
            .toEqual(['Session', 'Weekly', 'Fable · weekly']);
    });

    it('builds the account subtitle from the organisation and the plan', () => {
        expect(account.sublabel).toBe('OKTO Payments · Max 5×');
    });

    it('labels the weekdays in the viewer\'s locale', () => {
        expect(account.week.days.map(d => d.label)).toEqual(['Sun', 'Thu']);
        const ptBr = decorateSnapshot(normalizeSnapshot(wellFormed), {locale: 'pt-BR'});
        expect(ptBr.providers[0].accounts[0].week.days[0].label).toMatch(/dom/i);
    });

    it('names the models', () => {
        expect(account.models[0].label).toBe('Opus 5');
    });

    it('routes the labels through gettext', () => {
        const shouted = decorateSnapshot(normalizeSnapshot(wellFormed),
            {gettext: value => value.toUpperCase()});
        expect(shouted.providers[0].accounts[0].limits[0].label).toBe('SESSION');
    });

    it('falls back sensibly for limits with no role and no scope', () => {
        const odd = decorateSnapshot(normalizeSnapshot({providers: [{accounts: [{limits: [
            {id: 'weekly_opus', role: 'other', scopeLabel: 'Weekly opus'},
            {id: 'mystery', role: 'other'},
            {id: 'scoped_nameless', role: 'scoped'},
        ]}]}]}));
        expect(odd.providers[0].accounts[0].limits.map(l => l.label))
            .toEqual(['Weekly opus', 'mystery', 'Weekly']);
    });

    it('leaves a dateless day unlabelled instead of printing "Invalid Date"', () => {
        const broken = decorateSnapshot(normalizeSnapshot(
            {providers: [{accounts: [{week: {days: [{}]}}]}]}));
        expect(broken.providers[0].accounts[0].week.days[0].label).toBe('');
    });
});
