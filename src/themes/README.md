# Porting the look

By default this extension has no theme of its own. The `theme-variant` setting is
`auto`, `src/stylesheet.css` declares structure only, and every colour is
inherited from whatever shell theme is installed:

| What | Where the colour comes from |
|---|---|
| Panel text and icon | `.panel-button` / `.system-status-icon` in the shell theme |
| Progress bars | the `slider` style class, which is where Yaru (and Adwaita) declare `-barlevel-active-background-color` and `-barlevel-overdrive-color` |
| Menu background, text | `.popup-menu-content`, `.popup-menu-item` |
| Secondary text | not a colour at all: the actor's opacity is lowered in JS, because St's CSS has no `opacity` property |

That is why the bars turn orange on stock Ubuntu, blue on `Yaru-blue-dark`, and
follow light and dark without a single value being written down here.

## Adding a variant

Only needed if you want a look the shell theme does not give you.

1. Copy `yaru.css` to `mydistro.css` and change what you want.
2. Add `mydistro` to the `theme-variant` enum in
   `src/schemas/org.gnome.shell.extensions.ai-usage-gnome-shell.gschema.xml`.
3. Add it to the list in `_appearanceGroup()` in `src/prefs.js`.

The file is loaded with `St.ThemeContext…load_stylesheet()` on top of the shell
theme, so it only needs the declarations that differ.

## Classes you can target

`.ai-usage-panel`, `.ai-usage-panel-label`, `.ai-usage-panel-warning`,
`.ai-usage-menu`, `.ai-usage-account`, `.ai-usage-account-label`,
`.ai-usage-account-sublabel`, `.ai-usage-section-title`, `.ai-usage-row`,
`.ai-usage-row-label`, `.ai-usage-row-value`, `.ai-usage-row-detail`,
`.ai-usage-bar`, `.ai-usage-empty`, `.ai-usage-banner` (plus `-heading`, `-icon`,
`-title`, `-detail`, `-hint`, `-command`), `.ai-usage-command-text`,
`.ai-usage-copy-button`.
