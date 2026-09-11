// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Gustavo Eklund
//
// The banner that appears at the top of the menu whenever the numbers below are
// not what they should be. It exists because the alternative — a panel that
// silently stops moving — is indistinguishable from a broken extension.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Severity} from '../status.js';
import {DIM_OPACITY} from '../widgets.js';

const ICON_FOR_SEVERITY = {
    [Severity.WARNING]: 'dialog-warning-symbolic',
    [Severity.ERROR]: 'dialog-error-symbolic',
};

export const StatusBanner = GObject.registerClass(
class StatusBanner extends St.BoxLayout {
    constructor(onCopyCommand) {
        super({style_class: 'ai-usage-banner', x_expand: true});
        if ('orientation' in this)
            this.orientation = Clutter.Orientation.VERTICAL;
        else
            this.vertical = true;

        const heading = new St.BoxLayout({style_class: 'ai-usage-banner-heading'});
        this._icon = new St.Icon({
            style_class: 'ai-usage-banner-icon',
            icon_name: 'dialog-warning-symbolic',
        });
        this._title = new St.Label({style_class: 'ai-usage-banner-title', x_expand: true});
        heading.add_child(this._icon);
        heading.add_child(this._title);

        this._detail = new St.Label({style_class: 'ai-usage-banner-detail'});
        this._detail.clutter_text.line_wrap = true;
        this._hint = new St.Label({style_class: 'ai-usage-banner-hint'});
        this._hint.opacity = DIM_OPACITY;
        this._hint.clutter_text.line_wrap = true;

        // A command the user can act on without having to transcribe it.
        this._commandBox = new St.BoxLayout({style_class: 'ai-usage-banner-command'});
        this._command = new St.Label({style_class: 'ai-usage-command-text', x_expand: true});
        this._copy = new St.Button({
            style_class: 'ai-usage-copy-button',
            label: _('Copy'),
            can_focus: true,
        });
        this._copy.connect('clicked', () => onCopyCommand(this._command.text));
        this._commandBox.add_child(this._command);
        this._commandBox.add_child(this._copy);

        this.add_child(heading);
        this.add_child(this._detail);
        this.add_child(this._hint);
        this.add_child(this._commandBox);
    }

    /**
     * @param {object} description Result of describeStatus().
     */
    update(description) {
        this.visible = description.title !== null;
        if (!this.visible)
            return;

        this._icon.icon_name = ICON_FOR_SEVERITY[description.severity] ?? 'dialog-information-symbolic';
        this._title.text = description.title;

        this._detail.text = description.detail ?? '';
        this._detail.visible = description.detail !== null;

        this._hint.text = description.hint ?? '';
        this._hint.visible = description.hint !== null;

        this._command.text = description.command ?? '';
        this._commandBox.visible = description.command !== null;

        this.accessible_name = [description.title, description.detail, description.hint]
            .filter(Boolean).join('. ');
    }
});
