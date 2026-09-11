// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    CHECK_INTERVAL_MS,
    checkForUpdate,
    describeRelease,
    shouldCheck,
} from '../../../src/helper/updates.js';
import {fakeHttp} from '../../support/fakes.js';

const NOW = Date.parse('2026-09-11T16:32:00Z');
const BUNDLE = 'https://github.com/GustavoEklund/ai-usage-gnome-shell/releases/download/'
    + 'v0.2.0/ai-usage-gnome-shell.shell-extension.zip';

const release = (overrides = {}) => ({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/x/releases/tag/v0.2.0',
    assets: [{name: 'ai-usage.shell-extension.zip', browser_download_url: BUNDLE}],
    ...overrides,
});

const check = (overrides = {}) => checkForUpdate({
    http: fakeHttp({status: 200, body: release()}),
    now: NOW,
    currentVersion: '0.1.0',
    userAgent: 'ai-usage/0.1.0',
    enabled: true,
    force: false,
    ...overrides,
});

describe('shouldCheck', () => {
    const base = {enabled: true, force: false, now: NOW};

    it('checks when the extension starts, whatever the interval says', () => {
        expect(shouldCheck({...base, force: true,
            lastCheckedAt: new Date(NOW - 1000).toISOString()})).toBe(true);
    });

    it('checks when it never has', () => {
        expect(shouldCheck({...base, lastCheckedAt: null})).toBe(true);
        expect(shouldCheck({...base, lastCheckedAt: 'nonsense'})).toBe(true);
    });

    it('waits out the interval otherwise, to stay well inside GitHub\'s rate limit', () => {
        const recent = new Date(NOW - CHECK_INTERVAL_MS + 1000).toISOString();
        const old = new Date(NOW - CHECK_INTERVAL_MS - 1000).toISOString();
        expect(shouldCheck({...base, lastCheckedAt: recent})).toBe(false);
        expect(shouldCheck({...base, lastCheckedAt: old})).toBe(true);
    });

    it('never checks when the user turned it off, not even on start', () => {
        expect(shouldCheck({...base, enabled: false, force: true, lastCheckedAt: null}))
            .toBe(false);
    });
});

describe('describeRelease', () => {
    it('offers a newer release that ships a bundle', () => {
        expect(describeRelease(release(), '0.1.0')).toEqual({
            latest: '0.2.0',
            available: true,
            url: 'https://github.com/x/releases/tag/v0.2.0',
            bundleUrl: BUNDLE,
        });
    });

    it('does not offer the version already running, or an older one', () => {
        expect(describeRelease(release(), '0.2.0').available).toBe(false);
        expect(describeRelease(release(), '0.3.0').available).toBe(false);
    });

    it('reports but does not offer a release with nothing to install', () => {
        const noBundle = describeRelease(release({assets: [
            {name: 'notes.txt', browser_download_url: 'https://x/notes.txt'},
        ]}), '0.1.0');
        expect(noBundle.latest).toBe('0.2.0');
        expect(noBundle.available).toBe(false);
        expect(noBundle.bundleUrl).toBeNull();

        expect(describeRelease(release({assets: 'nope'}), '0.1.0').available).toBe(false);
        expect(describeRelease(release({assets: [null, {name: 'x.shell-extension.zip'}]}), '0.1.0')
            .available).toBe(false);
    });

    it('refuses a bundle hosted anywhere but this repository\'s releases', () => {
        const spoofed = describeRelease(release({assets: [{
            name: 'ai-usage.shell-extension.zip',
            browser_download_url: 'https://evil.example/ai-usage.shell-extension.zip',
        }]}), '0.1.0');
        expect(spoofed.available).toBe(false);
        expect(spoofed.bundleUrl).toBeNull();
    });

    it('copes with a body it cannot read', () => {
        for (const body of [null, {}, {tag_name: 'nightly'}]) {
            expect(describeRelease(body, '0.1.0'))
                .toEqual({latest: null, available: false, url: null, bundleUrl: null});
        }
    });

    it('tolerates a release with no html_url', () => {
        expect(describeRelease(release({html_url: 42}), '0.1.0').url).toBeNull();
    });
});

describe('checkForUpdate', () => {
    it('reports an available update and remembers it', async () => {
        const {update, cached} = await check();
        expect(update).toEqual({
            current: '0.1.0',
            latest: '0.2.0',
            available: true,
            url: 'https://github.com/x/releases/tag/v0.2.0',
            bundleUrl: BUNDLE,
            checkedAt: '2026-09-11T16:32:00.000Z',
            error: null,
        });
        expect(cached.checkedAt).toBe('2026-09-11T16:32:00.000Z');
    });

    it('identifies itself, because GitHub rejects requests that do not', async () => {
        const http = fakeHttp({status: 200, body: release()});
        await check({http});
        expect(http.calls[0].headers['User-Agent']).toBe('ai-usage/0.1.0');
        expect(http.calls[0].url).toContain('/releases/latest');
    });

    it('serves the cached answer without a request while the interval runs', async () => {
        const http = fakeHttp({status: 200, body: release()});
        const cached = {latest: '0.2.0', url: 'https://x', bundleUrl: BUNDLE,
            checkedAt: new Date(NOW - 1000).toISOString()};

        const {update} = await check({http, cached});
        expect(http.calls).toHaveLength(0);
        expect(update.available).toBe(true);
        expect(update.latest).toBe('0.2.0');
    });

    it('makes no request at all when the user turned checking off', async () => {
        const http = fakeHttp({status: 200, body: release()});
        const {update, cached} = await check({http, enabled: false, force: true});

        expect(http.calls).toHaveLength(0);
        expect(update.available).toBe(false);
        expect(update.checkedAt).toBeNull();
        expect(cached).toBeNull();
    });

    it('keeps showing what it knew when the network fails', async () => {
        const cached = {latest: '0.2.0', url: 'https://x', bundleUrl: BUNDLE,
            checkedAt: '2026-09-10T10:00:00Z'};
        const {update} = await check({http: fakeHttp(new Error('offline')), cached, force: true});

        expect(update.available).toBe(true);
        expect(update.error).toBe('offline');
        expect(update.checkedAt).toBe('2026-09-10T10:00:00Z');
    });

    it('treats a repository with no releases as no update, not as an error', async () => {
        const {update} = await check({http: fakeHttp({status: 404}), force: true});
        expect(update.available).toBe(false);
        expect(update.error).toBeNull();
        // The check still counts, so a repo without releases is not polled every minute.
        expect(update.checkedAt).toBe('2026-09-11T16:32:00.000Z');
    });

    it('records a rate limit as an error and backs off like any other check', async () => {
        const {update, cached} = await check({http: fakeHttp({status: 403}), force: true});
        expect(update.error).toBe('HTTP 403');
        expect(cached.checkedAt).toBe('2026-09-11T16:32:00.000Z');
    });

    it('never lets a failed check say an update is available when none is known', async () => {
        const {update} = await check({http: fakeHttp(new Error('offline')), force: true});
        expect(update.available).toBe(false);
        expect(update.latest).toBeNull();
    });
});
