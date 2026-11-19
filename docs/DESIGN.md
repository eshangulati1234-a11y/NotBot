# Notbot design note

Notbot is organised around trust and a folder: each helper is bound to one folder and one job, runs on this machine, can see everything and changes nothing without approval. The UI shows the work and the boundary, not a chat thread.

## Tokens

All tokens live in `src/renderer/styles/tokens.css`. Colours use `light-dark()`, so the system theme works with no JavaScript; `data-theme="light|dark"` on `<html>` pins an override (`theme.ts`). Components use `var(--nb-*)` only: no hex or px literals.

| Group | Tokens |
| --- | --- |
| Surfaces | `--nb-paper` (app), `--nb-surface` (panes), `--nb-raised` (controls, cards), `--nb-sunken` (wells), `--nb-gutter` (diff gutter) |
| Lines | `--nb-line`, `--nb-line-strong`, `--nb-border` (1px hairline shorthand) |
| Ink | `--nb-ink`, `--nb-ink-2`, `--nb-ink-3` |
| Accent (act on this) | `--nb-accent`, `-hover`, `-active`, `-ink`, `-soft`, `-text` |
| Danger | `--nb-danger`, `--nb-danger-soft` |
| Diff | `--nb-add-bg/-ink`, `--nb-del-bg/-ink` |
| Interaction | `--nb-hover`, `--nb-pressed`, `--nb-focus`, `--nb-ring` |
| Helper marks | `--nb-mark-1..6` (clay, ochre, sage, slate, plum, teal) |
| Spacing (4px scale) | `--nb-space-1..6` = 4, 8, 12, 16, 20, 24; `-8` 32, `-10` 40, `-12` 48, `-16` 64 |
| Type | `--nb-font` (Inter), `--nb-mono`; `--nb-text-xs..2xl` with `--nb-leading-*`; weights `--nb-weight-regular/medium/strong` |
| Radii | `--nb-radius-sm/md/lg/xl/pill` = 6, 8, 12, 16, 999 |
| Shadows | `--nb-shadow-1/2/3`, built on `--nb-shadow-color` |
| Motion | `--nb-dur-fast` 120ms, `--nb-dur` 180ms, `--nb-dur-slow` 280ms, `--nb-ease` |
| Z-index | `--nb-z-raised` 10, `-pane` 20, `-titlebar` 30, `-overlay` 100, `-dialog` 110, `-notice` 120 |
| Layout | `--nb-control-h` 32px, `--nb-titlebar-h` 44px, `--nb-tree-w` 248px, `--nb-review-w` 480px, `--nb-trail-max` 760px |

Accent is reserved for primary actions, Apply, "waiting for you" dots and the review count. Working dots use ink-2.

Under `prefers-reduced-motion` all durations become 0ms and the working-dot pulse and spinner are removed.

### Conventions

- BEM with `nb-` prefix: `.nb-block`, `.nb-block__element`, `.nb-block--modifier`. State via attributes (`data-state`, `aria-pressed`).
- Each component has its own `.css` containing only its block. Bare element selectors exist only in `styles/base.css`.
- Spacing between siblings uses `gap`, never margins.
- Utilities in `base.css`: `.nb-drag` and `.nb-no-drag` (title bar dragging; interactive children must be `nb-no-drag`), `.nb-sr-only`.

## Buttons

Exactly three: primary, secondary, icon-only (`ui/Button`, `ui/IconButton`). All are `--nb-control-h` tall (icon buttons are square), same radius. Destructive is a secondary with `tone="danger"` plus a confirmation step.

| State | Primary | Secondary | Icon-only |
| --- | --- | --- | --- |
| Default | accent fill, accent-ink text | raised fill, hairline border | transparent, ink-2 |
| Hover | accent-hover | stronger border, light tint | `--nb-hover` fill, ink |
| Active | accent-active | deeper tint | `--nb-pressed` fill |
| Focus-visible | `--nb-ring` (2px paper gap, 2px accent) | same | same |
| Disabled | 45% opacity, `not-allowed` | same | same |

Danger tone: secondary uses danger text and border with a `--nb-danger-soft` hover; icon-only uses danger ink. Every state is defined in light and dark through the tokens. There are no 2px outlines; focus is the ring only.

## Shortcuts

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+K | Command bar |
| Enter | Send task |
| Shift+Enter | New line in the composer |
| Cmd/Ctrl+Enter | Apply the change under review |
| Cmd/Ctrl+Backspace | Reject the change under review (never while typing in a field) |
| Esc | Close dialog or command bar |
| Arrow keys | Move in the command bar, segmented choices and the folder tree |

## Window

Minimum 1240x760, default 1440x920. Background follows `nativeTheme`. macOS uses the `hiddenInset` title bar; other platforms keep the native frame. The renderer title bar is draggable (`.nb-drag`) with buttons marked `.nb-no-drag`, and leaves `--nb-traffic-lights-w` of room on the left.

## Screen map

Every screen lives in one window: a title bar (Notbot, the helper crumb, status, Review count, Search or ask, Settings) above one main view.

- **Startup.** While Notbot starts it shows a short loading screen. If the harness cannot start, it shows what went wrong with a Try again button. Nothing else is reachable until it is ready.
- **First run.** With no helpers, one form with three steps: choose a folder, confirm the model on this device (the model setup appears only when none is ready), and say what the helper should do. Creating the helper starts its first task and opens its desk.
- **Shelf.** All helpers, grouped under their folder (folder name in monospace, full path on hover). Each card shows the helper's job, the boundary line (reads freely, asks before changing), its state and one outcome line that never repeats the state. Waiting helpers come first. Opening a card opens its desk; New helper opens the same form as a dialog.
- **Desk.** One helper at a time: the folder tree on the left (arrow keys move through it), the trail of what the helper did and said in the middle with the composer under it, and the review pane for the change that needs a decision. The boundary badge shows the folder the helper is limited to. Edit helper opens a dialog for its name, job, folder and on/off.
- **Review.** Shows the exact edit as a diff before anything is written. Apply and Reject are the only decisions, also on Cmd/Ctrl+Enter and Cmd/Ctrl+Backspace. The Review button in the title bar jumps to the next waiting review across helpers.
- **Settings.** A dialog with Appearance (theme), Model (the current model with a Change model button that reveals the setup) and Folders (the folders added so far, and Add folder).
- **Command bar.** Cmd/Ctrl+K opens a search over helpers and actions. Typed text can also start a task with a ready helper (only while a model is ready) or become a new helper's job. Arrow keys move, Enter chooses, Esc closes.
