# Design System

## Theme

A restrained light desktop utility. The interface prioritizes readable data controls, visible local-processing status, and a direct left-to-right workflow. It avoids decorative dashboard patterns and keeps motion tied to loading and progress.

## Color Palette

- Background: `oklch(0.972 0.006 260)`
- Surface: `oklch(0.995 0.002 260)`
- Muted surface: `oklch(0.955 0.008 260)`
- Primary ink: `oklch(0.225 0.028 260)`
- Secondary ink: `oklch(0.45 0.025 260)`
- Border: `oklch(0.88 0.012 260)`
- Primary blue: `oklch(0.48 0.205 263)`
- Success green: `oklch(0.51 0.135 151)`
- Error red: `oklch(0.55 0.19 28)`

## Typography

Use HarmonyOS Sans SC when available, followed by Microsoft YaHei UI, Segoe UI, and system sans-serif. The interface uses a compact 12–17px scale appropriate for a desktop tool. Labels and actions use semibold weight; supporting text remains high enough in contrast to read comfortably.

## Components

- Inputs and selects use 8px corners, visible borders, and a blue focus ring.
- Primary actions use solid blue with clear hover, active, disabled, and loading states.
- Secondary actions use a neutral surface and border.
- Conversation rows use a checkbox, compact identity tile, name, and one-line detail.
- Switches use standard label-first rows with the control aligned to the trailing edge.
- Status messages use semantic blue, green, or red dots and an `aria-live` region.
- Toasts are reserved for short success and error feedback.

## Layout

At desktop widths, use three columns: connection setup, conversation selection, and export options. At medium widths, export options move below the first two columns. At narrow widths, all sections stack. The action and progress bar remains visible at the bottom on desktop.

## Accessibility

All fields have labels, interactive controls have visible focus states, status changes use live regions, session selection supports native checkbox behavior, and motion is reduced when the operating system requests it.
