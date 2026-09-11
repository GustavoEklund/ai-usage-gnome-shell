// SPDX-License-Identifier: GPL-3.0-or-later
//
// Prints one version's changelog body, for release notes.

import {readFileSync} from 'node:fs';

const [, , version] = process.argv;
const changelog = readFileSync('CHANGELOG.md', 'utf8');

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const section = changelog.match(
    new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|\\n\\[Unreleased\\]:)`, 'm'));

if (section === null) {
    console.error(`changelog-section: no section for ${version}`);
    process.exit(1);
}

process.stdout.write(`${section[1].trim()}\n`);
