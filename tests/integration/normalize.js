// SPDX-License-Identifier: GPL-3.0-or-later
// Strips the parts of a snapshot that legitimately differ between runs — the
// wall clock and the temporary fixture path — so the rest can be diffed.

import {readFileSync} from 'node:fs';

const [, , snapshotPath, configDir] = process.argv;
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

snapshot.generatedAt = '<generatedAt>';
for (const provider of snapshot.providers) {
    for (const account of provider.accounts)
        account.id = account.id.replaceAll(configDir, '<configDir>');
}

process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
