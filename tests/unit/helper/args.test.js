// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {parseArgs, resolveConfigDirs, usage} from '../../../src/helper/args.js';

const HOME = '/home/me';
const parse = (argv, env = {}) => parseArgs(argv, env, HOME);

describe('parseArgs / defaults', () => {
    it('reads ~/.claude when nothing says otherwise', () => {
        expect(parse([])).toEqual({
            configDirs: ['/home/me/.claude'],
            providers: ['claude'],
            cacheDir: '/home/me/.cache/ai-usage-gnome-shell',
            pretty: false,
            help: false,
            now: null,
        });
    });

    it('respects the environment Claude Code itself respects', () => {
        expect(parse([], {CLAUDE_CONFIG_DIR: '/work/.claude'}).configDirs)
            .toEqual(['/work/.claude']);
        expect(parse([], {XDG_CACHE_HOME: '/tmp/cache'}).cacheDir)
            .toBe('/tmp/cache/ai-usage-gnome-shell');
    });

    it('ignores empty environment values rather than building a broken path', () => {
        expect(parse([], {CLAUDE_CONFIG_DIR: '', XDG_CACHE_HOME: ''}))
            .toMatchObject({
                configDirs: ['/home/me/.claude'],
                cacheDir: '/home/me/.cache/ai-usage-gnome-shell',
            });
    });
});

describe('parseArgs / options', () => {
    it('accepts several configuration directories, which is how a second account arrives', () => {
        expect(parse(['--config-dir=/a', '--config-dir=/b']).configDirs).toEqual(['/a', '/b']);
    });

    it('takes a provider list', () => {
        expect(parse(['--providers=claude, other ,']).providers).toEqual(['claude', 'other']);
        expect(parse(['--providers=']).providers).toEqual([]);
    });

    it('takes a cache directory and a pretty flag', () => {
        expect(parse(['--cache-dir=/tmp/x', '--pretty']))
            .toMatchObject({cacheDir: '/tmp/x', pretty: true});
    });

    it('takes a pinned clock, so a run can be reproduced', () => {
        expect(parse(['--now=2026-09-11T16:32:00Z']).now)
            .toBe(Date.parse('2026-09-11T16:32:00Z'));
    });

    it('ignores a clock it cannot parse rather than pretending it is 1970', () => {
        expect(parse(['--now=yesterday']).now).toBeNull();
    });

    it('recognises both spellings of help', () => {
        expect(parse(['-h']).help).toBe(true);
        expect(parse(['--help']).help).toBe(true);
    });

    it('ignores arguments it does not understand instead of failing', () => {
        expect(parse(['--nonsense', 'stray']).configDirs).toEqual(['/home/me/.claude']);
    });
});

describe('resolveConfigDirs', () => {
    it('prefers what the caller named', () => {
        expect(resolveConfigDirs(['/a', '/b'], {CLAUDE_CONFIG_DIR: '/c'}, HOME))
            .toEqual(['/a', '/b']);
    });

    it('otherwise agrees with Claude Code about where its config lives', () => {
        expect(resolveConfigDirs([], {CLAUDE_CONFIG_DIR: '/work/.claude'}, HOME))
            .toEqual(['/work/.claude']);
        expect(resolveConfigDirs([], {}, HOME)).toEqual(['/home/me/.claude']);
    });
});

describe('usage', () => {
    it('documents every option and the read-only promise', () => {
        const text = usage();
        for (const flag of ['--config-dir', '--cache-dir', '--providers', '--pretty', '--help'])
            expect(text).toContain(flag);
        expect(text).toContain('never writes to it');
    });
});
