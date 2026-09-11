// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    compareVersions,
    isNewer,
    normalizeTag,
    parseVersion,
    versionFromMetadata,
} from '../../../src/lib/version.js';

describe('parseVersion', () => {
    it('reads a plain version and a git tag alike', () => {
        expect(parseVersion('0.2.0')).toEqual({major: 0, minor: 2, patch: 0, prerelease: []});
        expect(parseVersion('v1.20.3')).toEqual({major: 1, minor: 20, patch: 3, prerelease: []});
        expect(parseVersion('  v1.0.0  ')).toMatchObject({major: 1});
    });

    it('keeps prerelease identifiers and discards build metadata', () => {
        expect(parseVersion('1.0.0-beta.2').prerelease).toEqual(['beta', '2']);
        expect(parseVersion('1.0.0+build.5').prerelease).toEqual([]);
        expect(parseVersion('1.0.0-rc.1+build.5').prerelease).toEqual(['rc', '1']);
    });

    it('rejects anything that is not a version', () => {
        for (const input of ['', 'latest', '1.0', '1.0.0.0', 'v', null, undefined, 42, {}])
            expect(parseVersion(input)).toBeNull();
    });
});

describe('compareVersions', () => {
    it('orders by major, then minor, then patch', () => {
        expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
        expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
        expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
        expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
        expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    });

    it('puts a prerelease before the release it precedes', () => {
        expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
    });

    it('orders prerelease identifiers the way semver says', () => {
        expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
        expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
        expect(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10')).toBe(-1);
        expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
        expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
        // Numeric identifiers sort below alphanumeric ones.
        expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
        expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
        expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
        expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.2')).toBe(0);
    });

    it('sorts anything unparseable lowest, rather than throwing', () => {
        expect(compareVersions('nonsense', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', 'nonsense')).toBe(1);
        expect(compareVersions('nonsense', 'also nonsense')).toBe(0);
    });
});

describe('isNewer', () => {
    it('is true only for a strictly newer version', () => {
        expect(isNewer('0.2.0', '0.1.0')).toBe(true);
        expect(isNewer('0.1.0', '0.1.0')).toBe(false);
        expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    });

    it('never offers a prerelease over the stable release it precedes', () => {
        expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false);
        expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true);
    });

    it('refuses to decide when either side is unreadable', () => {
        // Better to offer no update than to offer a bogus one.
        expect(isNewer('latest', '0.1.0')).toBe(false);
        expect(isNewer('0.2.0', 'unknown')).toBe(false);
        expect(isNewer(null, undefined)).toBe(false);
    });
});

describe('normalizeTag', () => {
    it('strips the v and normalises the shape', () => {
        expect(normalizeTag('v0.2.0')).toBe('0.2.0');
        expect(normalizeTag('0.2.0')).toBe('0.2.0');
        expect(normalizeTag('v1.0.0-rc.1')).toBe('1.0.0-rc.1');
        expect(normalizeTag('v1.0.0+build')).toBe('1.0.0');
    });

    it('is null for a tag that is not a version', () => {
        expect(normalizeTag('nightly')).toBeNull();
        expect(normalizeTag(null)).toBeNull();
    });
});

describe('versionFromMetadata', () => {
    it('reads the version the extension declares', () => {
        expect(versionFromMetadata('{"version-name":"0.2.0"}')).toBe('0.2.0');
        expect(versionFromMetadata('{"version-name":"v0.2.0"}')).toBe('0.2.0');
    });

    it('is null for anything it cannot read, rather than guessing', () => {
        // A wrong answer here would make the updater decide wrongly forever.
        expect(versionFromMetadata('{ broken')).toBeNull();
        expect(versionFromMetadata('{}')).toBeNull();
        expect(versionFromMetadata('{"version-name":"latest"}')).toBeNull();
        expect(versionFromMetadata(null)).toBeNull();
    });
});
