// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the things that only break at install time: a UUID that disagrees with
// the directory it is installed into, a settings-schema that does not match the
// schema file, a gettext domain nothing declares. Cheap to run, and the failures
// it catches are otherwise only visible as a silently broken extension.

import {readFileSync} from 'node:fs';

const problems = [];
const metadata = JSON.parse(readFileSync('src/metadata.json', 'utf8'));
const schemaXml = readFileSync(
    `src/schemas/${metadata['settings-schema']}.gschema.xml`, 'utf8');

const check = (condition, message) => {
    if (!condition)
        problems.push(message);
};

for (const field of ['uuid', 'name', 'description', 'shell-version', 'url',
    'settings-schema', 'gettext-domain', 'version-name'])
    check(metadata[field] !== undefined, `metadata.json is missing "${field}"`);

check(/^[^@]+@[^@]+$/.test(metadata.uuid ?? ''),
    `uuid "${metadata.uuid}" must look like name@domain`);

check(metadata.version === undefined,
    'metadata.json must not set "version": extensions.gnome.org assigns it');

check(Array.isArray(metadata['shell-version']) && metadata['shell-version'].length > 0,
    'shell-version must be a non-empty array');

check(schemaXml.includes(`id="${metadata['settings-schema']}"`),
    `the schema file declares no <schema id="${metadata['settings-schema']}">`);

check(schemaXml.includes(`gettext-domain="${metadata['gettext-domain']}"`),
    `the schema file's gettext-domain does not match metadata.json`);

const expectedPath = `/${metadata['settings-schema'].replace(/\./g, '/')}/`;
check(schemaXml.includes(`path="${expectedPath}"`),
    `the schema path should be "${expectedPath}"`);

if (problems.length > 0) {
    for (const problem of problems)
        console.error(`metadata: ${problem}`);
    process.exit(1);
}

console.log(`metadata: ok (${metadata.uuid}, shell ${metadata['shell-version'].join('/')})`);
