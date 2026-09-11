// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Asks GitHub whether a newer release exists.
//
// Two things this must not do. It must not fail the snapshot: an update check is
// ancillary, and a GitHub outage has nothing to do with whether the usage numbers
// are good, so every failure here is recorded on the update object and nowhere
// else. And it must not check often: the unauthenticated API allows 60 requests
// an hour per address, shared with everything else on the machine, so the result
// is cached and rechecked a few times a day — plus once whenever the extension
// starts, which is the moment a user is most likely to act on it.

import {isNewer, normalizeTag} from '../lib/version.js';
import {isTrustedBundleUrl} from '../lib/updateTarget.js';
import {redactError} from '../lib/redact.js';

const REPO = 'GustavoEklund/ai-usage-gnome-shell';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Six hours: frequent enough to be useful, rare enough to be invisible. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** The bundle gnome-extensions pack produces, and what a release attaches. */
const BUNDLE_SUFFIX = '.shell-extension.zip';

/**
 * @param {object} input
 * @param {boolean} input.enabled
 * @param {boolean} input.force Set on the first run after the extension starts.
 * @param {?string} input.lastCheckedAt
 * @param {number} input.now
 * @param {number} [input.intervalMs]
 * @returns {boolean}
 */
export function shouldCheck({enabled, force, lastCheckedAt, now, intervalMs = CHECK_INTERVAL_MS}) {
    if (!enabled)
        return false;
    if (force)
        return true;

    const last = Date.parse(lastCheckedAt ?? '');
    if (!Number.isFinite(last))
        return true;

    return now - last >= intervalMs;
}

/**
 * Read a GitHub release into the shape the UI renders.
 *
 * @param {*} release Parsed body of the releases/latest endpoint.
 * @param {string} currentVersion
 * @returns {{latest: ?string, available: boolean, url: ?string, bundleUrl: ?string}}
 */
export function describeRelease(release, currentVersion) {
    const latest = normalizeTag(release?.tag_name);
    if (latest === null)
        return {latest: null, available: false, url: null, bundleUrl: null};

    const assets = Array.isArray(release.assets) ? release.assets : [];
    // Checked here so an untrusted URL never even enters the snapshot.
    const bundle = assets.find(asset => typeof asset?.name === 'string' &&
        asset.name.endsWith(BUNDLE_SUFFIX) &&
        isTrustedBundleUrl(asset.browser_download_url));

    return {
        latest,
        // Without a bundle there is nothing the update button could install, so
        // the release is reported but not offered.
        available: isNewer(latest, currentVersion) && bundle !== undefined,
        url: typeof release.html_url === 'string' ? release.html_url : null,
        bundleUrl: bundle?.browser_download_url ?? null,
    };
}

/**
 * @param {object} cached
 * @param {string} currentVersion
 * @param {?string} error
 * @returns {object}
 */
function fromCache(cached, currentVersion, error = null) {
    return {
        current: currentVersion,
        latest: cached?.latest ?? null,
        available: isNewer(cached?.latest, currentVersion) && Boolean(cached?.bundleUrl),
        url: cached?.url ?? null,
        bundleUrl: cached?.bundleUrl ?? null,
        checkedAt: cached?.checkedAt ?? null,
        error,
    };
}

/**
 * @param {object} input
 * @param {object} input.http
 * @param {number} input.now
 * @param {string} input.currentVersion
 * @param {string} input.userAgent
 * @param {boolean} input.enabled
 * @param {boolean} input.force
 * @param {object} [input.cached] The previous result, from the cache.
 * @param {number} [input.intervalMs]
 * @returns {Promise<{update: object, cached: object}>}
 */
export async function checkForUpdate({
    http, now, currentVersion, userAgent, enabled, force, cached = null,
    intervalMs = CHECK_INTERVAL_MS,
}) {
    if (!enabled)
        return {update: {...fromCache(null, currentVersion), checkedAt: null}, cached: null};

    if (!shouldCheck({enabled, force, lastCheckedAt: cached?.checkedAt, now, intervalMs}))
        return {update: fromCache(cached, currentVersion), cached};

    let response;
    try {
        response = await http.get(RELEASES_URL, {
            // GitHub rejects requests without a User-Agent outright.
            'User-Agent': userAgent,
            'Accept': 'application/vnd.github+json',
        });
    } catch (error) {
        return {update: fromCache(cached, currentVersion, redactError(error)), cached};
    }

    if (response.status !== 200) {
        // 404 is the ordinary answer for a repository with no releases yet.
        const reason = response.status === 404 ? null : `HTTP ${response.status}`;
        const checkedAt = new Date(now).toISOString();
        return {
            update: {...fromCache(cached, currentVersion, reason), checkedAt},
            cached: {...cached, checkedAt},
        };
    }

    const described = describeRelease(response.body, currentVersion);
    const entry = {...described, checkedAt: new Date(now).toISOString()};

    return {
        update: {current: currentVersion, ...entry, error: null},
        cached: entry,
    };
}
