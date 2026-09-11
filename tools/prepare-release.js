// SPDX-License-Identifier: GPL-3.0-or-later
//
// Promotes [Unreleased] to a dated version heading and bumps the version
// everywhere it is written down. Run by `make release VERSION=x.y.z`.
//
// It refuses on an empty [Unreleased], because a release with no changelog entry
// is a release nobody can tell apart from the last one.

import {readFileSync, writeFileSync} from 'node:fs';

const REPO = 'https://github.com/GustavoEklund/ai-usage-gnome-shell';
const [, , version] = process.argv;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
    console.error('prepare-release: usage: node tools/prepare-release.js <x.y.z>');
    process.exit(1);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');

if (changelog.includes(`## [${version}]`)) {
    console.error(`prepare-release: CHANGELOG.md already has a [${version}] section`);
    process.exit(1);
}

const unreleased = changelog.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|\n\[Unreleased\]:)/m);
if (unreleased === null) {
    console.error('prepare-release: CHANGELOG.md has no [Unreleased] section');
    process.exit(1);
}

const body = unreleased[1].trim();
if (body === '') {
    console.error('prepare-release: [Unreleased] is empty — nothing to release.');
    console.error('  Every user-visible change should have added a line to it.');
    process.exit(1);
}

const previous = changelog.match(/^## \[(\d+\.\d+\.\d+[^\]]*)\] - /m)?.[1] ?? null;
const today = new Date().toISOString().slice(0, 10);

let next = changelog.replace(unreleased[0],
    `## [Unreleased]\n\n## [${version}] - ${today}\n\n${body}\n\n`);

// Keep a Changelog's link convention: Unreleased compares against the newest tag,
// each release compares against the one before it, and the first points at its tag.
next = next.replace(/^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD`);
next = next.replace(/^\[Unreleased\]: (.*)$/m,
    `[Unreleased]: $1\n[${version}]: ${previous === null
        ? `${REPO}/releases/tag/v${version}`
        : `${REPO}/compare/v${previous}...v${version}`}`);

writeFileSync('CHANGELOG.md', next);

for (const file of ['package.json', 'package-lock.json']) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.version = version;
    if (json.packages?.['']) json.packages[''].version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

const metadata = JSON.parse(readFileSync('src/metadata.json', 'utf8'));
metadata['version-name'] = version;
writeFileSync('src/metadata.json', `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`prepare-release: ${version} (${today})`);
console.log(body.split('\n').map(line => `  ${line}`).join('\n'));
