// SPDX-License-Identifier: GPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {LimitRole, mapLimits} from '../../../../../src/helper/providers/claude/limits.js';

const realResponse = JSON.parse(
    readFileSync(new URL('../../../../fixtures/usage-response.json', import.meta.url), 'utf8'));

describe('mapLimits / against a real captured response', () => {
    const limits = mapLimits(realResponse);

    it('produces exactly the three live limits, in display order', () => {
        expect(limits.map(l => l.id))
            .toEqual(['session', 'weekly_all', 'weekly_scoped:fable']);
    });

    it('carries the percentages and reset times through', () => {
        expect(limits[0]).toMatchObject({
            role: LimitRole.SESSION,
            percent: 21,
            resetsAt: '2026-09-11T18:30:00.030Z',
            severity: 'normal',
            primary: true,
        });
        expect(limits[1]).toMatchObject({role: LimitRole.WEEKLY, percent: 29, primary: false});
    });

    it('keeps the scope name so the UI can say which model is capped', () => {
        expect(limits[2]).toMatchObject({role: LimitRole.SCOPED, scopeLabel: 'Fable', percent: 0});
    });

    it('ignores the codename placeholders for features that are not live', () => {
        // nimbus_quill, tangelo and friends exist at the top level but not in limits[].
        expect(limits.map(l => l.id)).not.toContain('nimbus_quill');
        expect(limits).toHaveLength(3);
    });
});

describe('mapLimits / forward compatibility', () => {
    it('renders a limit kind this build has never seen', () => {
        const [limit] = mapLimits({
            limits: [{kind: 'weekly_opus', percent: 12, severity: 'warning',
                resets_at: '2026-09-13T22:00:00+00:00', scope: null}],
        });
        expect(limit).toMatchObject({
            id: 'weekly_opus',
            role: LimitRole.OTHER,
            scopeLabel: 'Weekly opus',
            percent: 12,
            severity: 'warning',
            primary: false,
        });
    });

    it('reads a surface-scoped limit as well as a model-scoped one', () => {
        const [limit] = mapLimits({
            limits: [{kind: 'weekly_scoped', percent: 3, scope: {surface: {display_name: 'Cowork'}}}],
        });
        expect(limit).toMatchObject({id: 'weekly_scoped:cowork', scopeLabel: 'Cowork'});
    });

    it('keeps a stable order when two limits share a role and have no scope', () => {
        // Defensive: the API has never sent this, but equal sort keys must not throw.
        const limits = mapLimits({
            limits: [{kind: 'session', percent: 1}, {kind: 'session', percent: 2}],
        });
        expect(limits.map(l => l.percent)).toEqual([1, 2]);
    });

    it('sorts unknown roles last and scoped limits alphabetically', () => {
        const limits = mapLimits({
            limits: [
                {kind: 'mystery', percent: 1},
                {kind: 'weekly_scoped', percent: 1, scope: {model: {display_name: 'Opus'}}},
                {kind: 'weekly_all', percent: 1},
                {kind: 'weekly_scoped', percent: 1, scope: {model: {display_name: 'Fable'}}},
                {kind: 'session', percent: 1},
            ],
        });
        expect(limits.map(l => l.id)).toEqual([
            'session', 'weekly_all', 'weekly_scoped:fable', 'weekly_scoped:opus', 'mystery',
        ]);
    });
});

describe('mapLimits / defensive', () => {
    it('returns nothing rather than throwing on a missing or broken body', () => {
        expect(mapLimits(null)).toEqual([]);
        expect(mapLimits({})).toEqual([]);
        expect(mapLimits({limits: 'nope'})).toEqual([]);
    });

    it('skips entries with no kind to key off', () => {
        expect(mapLimits({limits: [{percent: 5}, null, {kind: 'session', percent: 5}]}))
            .toHaveLength(1);
    });

    it('substitutes safe values for missing fields', () => {
        const [limit] = mapLimits({limits: [{kind: 'session'}]});
        expect(limit).toMatchObject({percent: 0, resetsAt: null, severity: 'normal'});
    });

    it('rejects a reset timestamp it cannot parse', () => {
        const [limit] = mapLimits({limits: [{kind: 'session', resets_at: 'soon'}]});
        expect(limit.resetsAt).toBeNull();
    });
});
