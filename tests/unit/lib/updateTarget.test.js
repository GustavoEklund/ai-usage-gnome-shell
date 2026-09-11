// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {
    isTrustedBundleUrl,
    looksLikeBundle,
    trustedPrefix,
} from '../../../src/lib/updateTarget.js';

/** Bytes that start like a zip and are long enough to be one. */
const zipBytes = (signature = [0x50, 0x4b, 0x03, 0x04]) =>
    Uint8Array.from([...signature, ...new Array(200).fill(0)]);

const good = `${trustedPrefix()}v0.2.0/ai-usage-gnome-shell.shell-extension.zip`;

describe('isTrustedBundleUrl', () => {
    it('accepts a release asset of this repository', () => {
        expect(isTrustedBundleUrl(good)).toBe(true);
    });

    it('refuses another host, another repository, or plain http', () => {
        expect(isTrustedBundleUrl(
            'https://evil.example/a.shell-extension.zip')).toBe(false);
        expect(isTrustedBundleUrl(
            'https://github.com/someone/else/releases/download/v1/a.shell-extension.zip'))
            .toBe(false);
        expect(isTrustedBundleUrl(good.replace('https://', 'http://'))).toBe(false);
    });

    it('refuses anything that is not a shell extension bundle', () => {
        expect(isTrustedBundleUrl(`${trustedPrefix()}v0.2.0/payload.sh`)).toBe(false);
        expect(isTrustedBundleUrl(`${trustedPrefix()}v0.2.0/a.zip`)).toBe(false);
    });

    it('refuses traversal, backslashes and whitespace tricks', () => {
        expect(isTrustedBundleUrl(
            `${trustedPrefix()}../../../x.shell-extension.zip`)).toBe(false);
        expect(isTrustedBundleUrl(
            `${trustedPrefix()}v1\\x.shell-extension.zip`)).toBe(false);
        expect(isTrustedBundleUrl(
            `${trustedPrefix()}v1/ a.shell-extension.zip`)).toBe(false);
        expect(isTrustedBundleUrl(`  ${good}`)).toBe(false);
    });

    it('refuses anything that is not a string', () => {
        for (const input of [null, undefined, 42, {}, ['x']])
            expect(isTrustedBundleUrl(input)).toBe(false);
    });
});

describe('looksLikeBundle', () => {
    it('accepts something that starts like a zip', () => {
        expect(looksLikeBundle(zipBytes())).toBe(true);
        // An empty archive has its own signature.
        expect(looksLikeBundle(zipBytes([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    });

    it('refuses a page a proxy or captive portal returned instead', () => {
        const html = new TextEncoder().encode(`<!DOCTYPE html>${'x'.repeat(300)}`);
        expect(looksLikeBundle(html)).toBe(false);
        expect(looksLikeBundle(zipBytes([0x50, 0x4b, 0x07, 0x08]))).toBe(false);
        expect(looksLikeBundle(zipBytes([0x51, 0x4b, 0x03, 0x04]))).toBe(false);
        expect(looksLikeBundle(zipBytes([0x50, 0x4c, 0x03, 0x04]))).toBe(false);
    });

    it('refuses something far too small to be an extension', () => {
        expect(looksLikeBundle(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    });

    it('refuses anything that is not bytes', () => {
        for (const input of [null, undefined, 'PK\u0003\u0004', 42, {}])
            expect(looksLikeBundle(input)).toBe(false);
    });
});
