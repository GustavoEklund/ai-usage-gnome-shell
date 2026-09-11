// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    describeUpdate,
    interpretUpdateResult,
    UpdateState,
} from '../../../src/lib/updateResult.js';

const ran = overrides =>
    interpretUpdateResult({stdout: '', stderr: '', exitStatus: 0, ...overrides});

describe('interpretUpdateResult', () => {
    it('reports the installed version on success', () => {
        expect(ran({stdout: '{"ok":true,"version":"0.2.0"}'})).toEqual({
            state: UpdateState.DONE, version: '0.2.0', reason: null,
        });
    });

    it('succeeds even when the updater did not name a version', () => {
        expect(ran({stdout: '{"ok":true}'}))
            .toEqual({state: UpdateState.DONE, version: null, reason: null});
    });

    it('passes the updater\'s own reason through', () => {
        expect(ran({stdout: '{"ok":false,"reason":"the download was not a bundle"}'}))
            .toEqual({
                state: UpdateState.FAILED, version: null,
                reason: 'the download was not a bundle',
            });
    });

    it('says something even when the updater failed mutely', () => {
        expect(ran({stdout: '{"ok":false}'}).reason)
            .toBe('the updater did not say what went wrong');
        expect(ran({stdout: '{"ok":false,"reason":""}'}).reason)
            .toBe('the updater did not say what went wrong');
        expect(ran({exitStatus: 1}).reason)
            .toBe('the updater exited with status 1');
    });

    it('reports a crash with the tail of its stderr', () => {
        expect(ran({exitStatus: 2, stderr: 'one\ntwo\nthree\n'}).reason)
            .toBe('two; three');
    });

    it('never lets a token escape through the updater\'s stderr', () => {
        const token = 'sk-ant-oat01-vK9xQ2mZ7pLr4tN8wYbA3cEfGhJkMnPqRsTuVwXyZ012345';
        const result = ran({exitStatus: 1, stderr: `failed with ${token}`});
        expect(result.reason).not.toContain(token);
        expect(result.reason).toContain('[redacted]');
    });

    it('copes with streams that were never written', () => {
        // Gio hands back null, not an empty string, for a stream with no output.
        expect(interpretUpdateResult({exitStatus: 3}).reason)
            .toBe('the updater exited with status 3');
    });

    it('fails cleanly on output it cannot parse', () => {
        expect(ran({stdout: 'not json'}).state).toBe(UpdateState.FAILED);
        expect(ran({stdout: ''}).state).toBe(UpdateState.FAILED);
        expect(interpretUpdateResult({exitStatus: 0}).state).toBe(UpdateState.FAILED);
    });
});

describe('describeUpdate', () => {
    const available = {
        current: '0.1.0', latest: '0.2.0', available: true,
        url: 'https://x', bundleUrl: 'https://y',
        checkedAt: '2026-09-11T16:32:00Z', error: null,
    };
    const describe_ = overrides =>
        describeUpdate({timeZone: 'UTC', ...overrides});

    it('says nothing at all when there is nothing to do', () => {
        // A permanent "you are up to date" row costs space every day to be
        // useful never.
        for (const update of [null, {...available, available: false}, {available: false}])
            expect(describe_({update}).visible).toBe(false);
        expect(describe_().visible).toBe(false);
    });

    it('offers the update, naming both versions and when it looked', () => {
        expect(describe_({update: available})).toEqual({
            visible: true,
            title: 'Version 0.2.0 is available',
            detail: 'You are on 0.1.0, checked at 16:32.',
            action: 'Update',
            busy: false,
        });
    });

    it('still offers it when it does not know when it last checked', () => {
        expect(describe_({update: {...available, checkedAt: null}}).detail)
            .toBe('You are on 0.1.0.');
        expect(describe_({update: {...available, current: null, checkedAt: 'soon'}}).detail)
            .toBe('You are on ?.');
    });

    it('shows progress and takes the button away while it runs', () => {
        const running = describe_({update: available, state: UpdateState.RUNNING});
        expect(running).toMatchObject({visible: true, busy: true, action: null});
        expect(running.title).toBe('Updating…');
    });

    it('says what to do next once it is installed', () => {
        const done = describe_({state: UpdateState.DONE, version: '0.2.0'});
        expect(done.title).toBe('Updated to 0.2.0');
        expect(done.detail).toMatch(/Alt\+F2/);
        expect(done.action).toBeNull();

        expect(describe_({state: UpdateState.DONE}).title).toBe('Updated');
    });

    it('reports a failure and offers another go', () => {
        expect(describe_({state: UpdateState.FAILED, reason: 'the download was not a bundle'}))
            .toMatchObject({
                title: 'Update failed',
                detail: 'the download was not a bundle',
                action: 'Try again',
            });
        expect(describe_({state: UpdateState.FAILED}).detail)
            .toBe('The updater did not say what went wrong.');
    });

    it('copes with a release whose current version it does not know', () => {
        expect(describe_({update: {...available, current: null}}).detail)
            .toBe('You are on ?, checked at 16:32.');
    });

    it('leaves an unknown placeholder intact rather than printing "undefined"', () => {
        // A translation that invented a placeholder must not corrupt the message.
        const result = describe_({
            update: available,
            gettext: text => text.startsWith('Version') ? 'Nova: {nosuchkey}' : text,
        });
        expect(result.title).toBe('Nova: {nosuchkey}');
    });

    it('routes its words through gettext', () => {
        const result = describe_({
            update: available,
            gettext: text => text === 'Update' ? 'Atualizar' : text,
        });
        expect(result.action).toBe('Atualizar');
    });
});
