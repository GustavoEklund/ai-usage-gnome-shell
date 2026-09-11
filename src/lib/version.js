// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// Semver comparison, only as much of it as deciding "is this newer than what I am
// running" requires. Build metadata is ignored; prerelease identifiers are
// compared because the one thing this must never do is offer a prerelease as an
// upgrade over the stable release it precedes.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Accepts "v0.2.0" as readily as "0.2.0", since git tags carry the prefix.
 *
 * @param {*} text
 * @returns {?{major: number, minor: number, patch: number, prerelease: string[]}}
 */
export function parseVersion(text) {
    if (typeof text !== 'string')
        return null;

    const match = SEMVER.exec(text.trim().replace(/^v/, ''));
    if (match === null)
        return null;

    const [, major, minor, patch, prerelease] = match;
    return {
        major: Number(major),
        minor: Number(minor),
        patch: Number(patch),
        prerelease: prerelease === undefined ? [] : prerelease.split('.'),
    };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative if a < b, positive if a > b, zero if equal.
 */
function comparePrerelease(a, b) {
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);

    // Numeric identifiers always compare lower than alphanumeric ones.
    if (aNumeric && bNumeric)
        return Number(a) - Number(b);
    if (aNumeric)
        return -1;
    if (bNumeric)
        return 1;
    return a < b ? -1 : (a > b ? 1 : 0);
}

/**
 * @param {?object} a
 * @param {?object} b
 * @returns {number} -1, 0 or 1. An unparseable version sorts lowest.
 */
export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);

    if (left === null && right === null)
        return 0;
    if (left === null)
        return -1;
    if (right === null)
        return 1;

    for (const field of ['major', 'minor', 'patch']) {
        if (left[field] !== right[field])
            return left[field] < right[field] ? -1 : 1;
    }

    // 1.0.0-beta precedes 1.0.0: having a prerelease makes a version lower.
    if (left.prerelease.length === 0 && right.prerelease.length > 0)
        return 1;
    if (left.prerelease.length > 0 && right.prerelease.length === 0)
        return -1;

    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index++) {
        const l = left.prerelease[index];
        const r = right.prerelease[index];
        if (l === undefined)
            return -1;
        if (r === undefined)
            return 1;
        const order = comparePrerelease(l, r);
        if (order !== 0)
            return order < 0 ? -1 : 1;
    }

    return 0;
}

/**
 * @param {*} candidate
 * @param {*} current
 * @returns {boolean} True only when candidate is strictly newer and both parse.
 */
export function isNewer(candidate, current) {
    if (parseVersion(candidate) === null || parseVersion(current) === null)
        return false;
    return compareVersions(candidate, current) > 0;
}

/**
 * @param {*} tag
 * @returns {?string} "v0.2.0" -> "0.2.0"
 */
export function normalizeTag(tag) {
    const parsed = parseVersion(tag);
    if (parsed === null)
        return null;
    const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    return parsed.prerelease.length === 0 ? base : `${base}-${parsed.prerelease.join('.')}`;
}

/**
 * The version this build is, read from metadata.json rather than written down a
 * second time. A constant here would be a constant `make release` does not bump,
 * and a helper that misreports its own version decides wrongly about every update
 * from then on.
 *
 * @param {?string} metadataText
 * @returns {?string}
 */
export function versionFromMetadata(metadataText) {
    if (typeof metadataText !== 'string')
        return null;

    try {
        return normalizeTag(JSON.parse(metadataText)['version-name']);
    } catch {
        return null;
    }
}
