# Reactio Draw figures for Overleaf

A Chrome (and Edge) extension: a figure copied in Reactio Draw with **Copy for
LaTeX** pastes into the Overleaf editor with its files, as it does in VS Code
with reactio-latex and in Lattice.

When you paste (Cmd+V / Ctrl+V) in an Overleaf project:

- the drawing (`.reactio`), its PDF and its TikZ `.tex` are uploaded to the
  project's `figures/` folder, renamed (`scheme-2.*`, …) when a name is taken;
- on an empty line of the body you get a whole float (`scheme` in an achemso
  document, `figure` otherwise) with the caret in the caption; inside text,
  only `\input{figures/…}`;
- the main document's preamble gets the packages it lacks (`graphicx`, `tikz`,
  `chemnum`), `\graphicspath{{figures/}}` and the `\rcmpd` definition for
  compound marks. Pasted into a file that is not the main document, a notice
  lists those lines with a button to copy them.

Any other paste is left to Overleaf.

**Cmd-double-click** (Ctrl on Windows) a figure in the PDF preview, or
double-click the line that includes it (`\input{figures/scheme}`) in the
editor, and its drawing opens in Reactio Draw. Each time you save it there, Reactio Draw
writes the figure's `.pdf` and `.tex` again; they are uploaded over the
project's copies (recompile to see them). This needs the small helper below,
since a browser cannot open programs. The drawing is kept on your computer in
`~/Reactio Overleaf/<project id>/figures/`.

**Compound marks** (chemnum), as in reactio-latex for VS Code:

- typing `\rcmpd{` or `\cmpd{` lists the project's compounds with the number
  the last compile gave each and the scheme it is drawn in; a drawing's mark
  picked after `\cmpd{` turns the command into `\rcmpd{`;
- resting the pointer on `\rcmpd{…}` or `\cmpd{…}` shows its number and scheme;
- the **Compounds** button (bottom right, or Ctrl/Cmd+Shift+K) finds a
  compound by the number seen in the PDF (`2a`) or by its key, and puts the
  exact LaTeX that cites it at the caret (and on the clipboard).

- in the PDF preview, compound numbers set over a drawing are outlined; a click
  on one copies the LaTeX that cites it. Each is checked with SyncTeX, so a
  page number or a table entry that reads "2" is not taken for compound 2.

In the **Visual** editor, a pasted figure's `\input{figures/…}` shows as its
drawing, with its compound numbers. In a float laid out as a paste makes it,
the `\begin`, `\centering` and `\end` lines are hidden and the caption and
label stay under the picture. A click does not put the caret in the code, and
a double click opens the drawing in Reactio Draw (the Code editor shows the
code). A pasted float's label is
named after the figure (`\label{sch:scheme}`).

Numbers come from the `.aux` of the last compile in the PDF preview; compile
once after opening the project to see them.

## Install

From the [Releases](https://github.com/Paivel/reactio-overleaf/releases) page:

1. **Extension:** download `reactio-overleaf-extension-<version>.zip` and unzip it.
   Open `chrome://extensions` (or `edge://extensions`), turn on **Developer
   mode**, click **Load unpacked** and pick the unzipped folder.
2. **Helper** (needed to open figures in Reactio Draw; pasting works without it):
   - macOS: download `reactio-overleaf-helper-mac.zip`, unzip, right-click
     `install-mac.command` and choose **Open** (the helper is not signed, so
     macOS asks once);
   - Windows: download `reactio-overleaf-helper-windows.zip`, unzip and
     double-click `install-windows.cmd` (SmartScreen may ask once: **More
     info** then **Run anyway**).

   It registers itself with Chrome, Edge, Brave and Chromium for this
   extension only (its id is fixed by `key` in `manifest.json`), and needs no
   administrator rights.
3. Reload the Overleaf page.

After an update of the extension (the ⟳ button in `chrome://extensions`),
reload open Overleaf tabs.

## Build from source

- `npm install && npm run build`, then **Load unpacked** this folder.
- `npm run host` builds the helper (Go) into `dist/host/`; then run
  `helper/install-mac.command` or `helper\install-windows.cmd` from this folder.

## How it works, and what may break

Overleaf has no supported extension API, so this uses what its editor exposes:

- the CodeMirror view from `window.overleaf.unstable.store` (Overleaf exposes
  it for browser extensions; "unstable" is their word);
- the project's file tree from the editor's React state, to pick free names
  and the root folder's id;
- the endpoint the editor's own Upload dialog posts to
  (`POST /project/<id>/upload?folder_id=<root>` with `relativePath`).

If Overleaf changes these, the extension says it could not read the project
or upload, instead of doing something else. Undo (Cmd+Z) takes the inserted
text back; files already uploaded stay in the project.

## Checks

- `npm run check`: types and unit tests (name planning, float and preamble).
- `npm run e2e`: pastes into a stand-in for Overleaf's editor (a real
  CodeMirror 6 view and a fake upload endpoint) in Chromium; then, with the
  extension loaded and the real helper over native messaging, double-clicks a
  figure and checks that a save comes back as uploads; then completion,
  hover and the Compounds panel against a stand-in `.aux`.

The helper (`host/`, Go, no dependencies) only writes drawings into its own
folder, opens only drawing formats, and sends back only figure files from
folders opened from Overleaf; the page uploads only into those folders.
Watching lasts while Chrome keeps the helper running: after a browser restart,
open the figure again.

## Not yet

- Firefox and Safari; self-hosted Overleaf (add its address to `matches` in
  `manifest.json`).
