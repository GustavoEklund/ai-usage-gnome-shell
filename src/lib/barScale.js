// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// How a fraction becomes a BarLevel value.
//
// BarLevel models "overdrive" as the stretch beyond the normal range, so its
// overdrive-start property only accepts 1..2. Scaling onto 0..2 therefore uses the
// widget exactly as designed, and puts the shell theme's own danger colour on the
// last tenth of the bar — with the separator tick the theme draws at the boundary,
// which lands precisely on 90%. No colour is chosen by this project anywhere.

export const BAR_MAXIMUM = 2;

/** Where a usage bar turns into the theme's danger colour. */
export const DANGER_FRACTION = 0.9;

/**
 * @param {number} fraction 0..1 of the bar's full length.
 * @returns {number} A value in 0..BAR_MAXIMUM.
 */
export function barValue(fraction) {
    const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    return safe * BAR_MAXIMUM;
}

/**
 * @param {boolean} withDangerZone
 * @returns {number} The overdrive-start a bar should be created with.
 */
export function overdriveStart(withDangerZone) {
    return withDangerZone ? BAR_MAXIMUM * DANGER_FRACTION : BAR_MAXIMUM;
}
