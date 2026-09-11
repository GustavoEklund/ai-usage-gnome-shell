// SPDX-License-Identifier: GPL-3.0-or-later
//
// The version of this project is written down in three places that have no way
// of noticing when they disagree: package.json, metadata.json's `version-name`,
// and the newest released heading in CHANGELOG.md. A release built from
// disagreeing files is shipped mislabelled, and nothing else would catch it.
//
// Also enforces that metadata.json does not set `version`. That field is an
// integer owned by extensions.gnome.org, which assigns it on upload; setting it
// by hand is how an extension ends up unable to be updated there.

import {readFileSync} from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const problems = [];
const check = (condition, message) => {
    if (!condition)
        problems.push(message);
};

/** Print everything found so far and stop, if anything was found. */
function report() {
    if (problems.length === 0)
        return;
    for (const problem of problems)
        console.error(`version: ${problem}`);
    process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const metadata = JSON.parse(readFileSync('src/metadata.json', 'utf8'));
const changelog = readFileSync('CHANGELOG.md', 'utf8');

check(SEMVER.test(pkg.version), `package.json version "${pkg.version}" is not semver`);
check(SEMVER.test(metadata['version-name']),
    `metadata.json version-name "${metadata['version-name']}" is not semver`);
check(pkg.version === metadata['version-name'],
    `package.json says ${pkg.version} but metadata.json says ${metadata['version-name']}`);

check(metadata.version === undefined,
    'metadata.json must not set "version": extensions.gnome.org owns that integer');

check(/^## \[Unreleased\]\s*$/m.test(changelog),
    'CHANGELOG.md has no "## [Unreleased]" section to add the next change to');

// Before the first release there is no dated heading at all, and that is a valid
// state: everything so far belongs to a version nobody has yet. Once one exists,
// the newest has to be the version the tree claims to be.
const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+[^\]]*)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)];

if (released.length === 0) {
    report();
    console.log(`version: ok (${pkg.version}, nothing released yet)`);
    process.exit(0);
}

const [, newest] = released[0];
check(newest === pkg.version,
    `the newest CHANGELOG entry is ${newest} but the version is ${pkg.version}`);

for (const [, version] of released) {
    check(changelog.includes(`[${version}]: https://`),
        `CHANGELOG.md has no link definition for [${version}]`);
}

report();

console.log(`version: ok (${pkg.version}, changelog and metadata agree)`);
