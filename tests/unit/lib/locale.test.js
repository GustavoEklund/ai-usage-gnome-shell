// SPDX-License-Identifier: GPL-3.0-or-later
import {describe, expect, it} from 'vitest';

import {toBcp47} from '../../../src/lib/locale.js';

describe('toBcp47', () => {
    it('converts the POSIX names GLib reports', () => {
        expect(toBcp47(['pt_BR.UTF-8', 'pt_BR', 'pt', 'C'])).toBe('pt-BR');
        expect(toBcp47(['en_GB.UTF-8'])).toBe('en-GB');
        expect(toBcp47(['de'])).toBe('de');
    });

    it('drops an @modifier as well as the encoding', () => {
        expect(toBcp47(['sr_RS.UTF-8@latin'])).toBe('sr-RS');
    });

    it('skips the placeholder locales and takes the first real one', () => {
        expect(toBcp47(['C', 'POSIX', 'fr_FR.UTF-8'])).toBe('fr-FR');
        expect(toBcp47(['', 'es_ES'])).toBe('es-ES');
    });

    it('falls back to English when there is nothing usable', () => {
        expect(toBcp47(['C', 'POSIX'])).toBe('en');
        expect(toBcp47([])).toBe('en');
        expect(toBcp47(null)).toBe('en');
        expect(toBcp47([null, 42])).toBe('en');
    });
});
