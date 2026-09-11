// SPDX-License-Identifier: GPL-3.0-or-later
//
// Checks that every `resource:///` import is one the process loading that file can
// actually resolve. There are three processes here and they do not share a
// resource namespace:
//
//   * the shell loads extension.js and lib/**, and provides
//     resource:///org/gnome/shell/…
//   * the preferences dialog loads prefs.js and provides a different tree,
//     resource:///org/gnome/Shell/Extensions/js/… (note the capital S)
//   * the helper runs under plain gjs and has no shell resources at all
//
// Getting this wrong fails at runtime, in a dialog, with "the settings for this
// extension can't be displayed" — never at build time, and never in a unit test,
// because the module cannot be imported by a test runner in the first place.

import {readdirSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';

const SHELL_PREFIX = 'resource:///org/gnome/shell/';
const PREFS_PREFIX = 'resource:///org/gnome/Shell/Extensions/js/';

const rules = [
    {
        match: path => path === 'src/prefs.js',
        allow: PREFS_PREFIX,
        why: 'the preferences dialog provides only the Extensions resource tree',
    },
    {
        match: path => path.startsWith('src/helper/'),
        allow: null,
        why: 'the helper runs under plain gjs, where no shell resource exists',
    },
    {
        match: () => true,
        allow: SHELL_PREFIX,
        why: 'code inside the shell process uses the shell resource tree',
    },
];

/**
 * @param {string} dir
 * @param {string[]} found
 * @returns {string[]}
 */
function walk(dir, found = []) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory())
            walk(path, found);
        else if (entry.name.endsWith('.js'))
            found.push(path);
    }
    return found;
}

const problems = [];

for (const file of walk('src')) {
    const path = relative('.', file);
    const rule = rules.find(candidate => candidate.match(path));
    const source = readFileSync(file, 'utf8');

    for (const [, specifier] of source.matchAll(/from\s+'(resource:\/\/\/[^']+)'/g)) {
        if (rule.allow === null) {
            problems.push(`${path} imports ${specifier}, but ${rule.why}`);
            continue;
        }
        if (!specifier.startsWith(rule.allow))
            problems.push(`${path} imports ${specifier}; expected ${rule.allow}… because ${rule.why}`);
    }
}

if (problems.length > 0) {
    for (const problem of problems)
        console.error(`imports: ${problem}`);
    process.exit(1);
}

console.log('imports: ok (every resource:/// import matches its loading process)');
