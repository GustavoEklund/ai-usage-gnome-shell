// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The row that appears when a newer release exists, and follows the install
// through. It draws what describeUpdate() decided and nothing more; when that
// says nothing, this is hidden entirely.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {DIM_OPACITY} from '../widgets.js';

export const UpdateBanner = GObject.registerClass(
class UpdateBanner extends St.BoxLayout {
    constructor(onAction) {
        super({style_class: 'ai-usage-update', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        const heading = new St.BoxLayout({style_class: 'ai-usage-update-heading'});
        this._icon = new St.Icon({
            style_class: 'ai-usage-update-icon',
            icon_name: 'software-update-available-symbolic',
        });
        this._title = new St.Label({
            style_class: 'ai-usage-update-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button = new St.Button({
            style_class: 'ai-usage-update-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.connect('clicked', () => onAction());

        heading.add_child(this._icon);
        heading.add_child(this._title);
        heading.add_child(this._button);

        this._detail = new St.Label({style_class: 'ai-usage-update-detail'});
        this._detail.clutter_text.line_wrap = true;
        this._detail.opacity = DIM_OPACITY;

        this.add_child(heading);
        this.add_child(this._detail);
    }

    /**
     * @param {object} description Result of describeUpdate().
     */
    update(description) {
        this.visible = description.visible;
        if (!this.visible)
            return;

        this._title.text = description.title;
        this._detail.text = description.detail ?? '';
        this._detail.visible = description.detail !== null;

        this._button.visible = description.action !== null;
        this._button.label = description.action ?? '';
        this._button.reactive = !description.busy;

        this.accessible_name = [description.title, description.detail]
            .filter(Boolean).join('. ');
    }
});
