# Editor desktop app (retired)

The standalone Editor is no longer exposed in the Neural Labs dock or Files
workflow. VS Code is the default source editor. Creating a file or opening a
text/code file from Files reveals the existing VS Code window and opens the
selected path there. A file or folder can also be sent explicitly with **Open
in VS Code** from its context menu.

Previously persisted Editor windows are restored as VS Code windows. The legacy
text API remains available internally during the transition, but the desktop
does not route ordinary workspace files to it.

The graphical Skill Builder keeps its own collaborative source surface because
its unpublished Yjs drafts are not ordinary workspace files. Published skill
files can be opened through Files and VS Code normally.
