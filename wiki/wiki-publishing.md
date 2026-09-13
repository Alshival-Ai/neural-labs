# Publishing the GitHub wiki

The project repository is [Alshival-Ai/neural-labs](https://github.com/Alshival-Ai/neural-labs).
Published documentation and user guides live in the [GitHub wiki](https://github.com/Alshival-Ai/neural-labs/wiki).

Edit documentation in the repository's `wiki/` directory so changes can be reviewed alongside the code. `bin/export-wiki.py` exports every Markdown page, the changelog, roadmap, and tracker into the separate GitHub wiki repository. It builds Home from `wiki/README.md` and copies the rewritten `wiki/navigation.md` guide directory into the sidebar, flattens nested page names, converts documentation links into wiki URLs, and sends source-code links to the main repository. Missing local link targets fail the export before any pages are written.

For a read-only documentation check, run `python3 bin/export-wiki.py --check`.
This builds and validates the export in memory without creating output files.
`make validate` includes that check and isolated exporter regression tests.

Home should walk a new owner through setup. Keep task guides in the guide
directory, release records under [Release history](release-history.md), and
architecture/history links under [Maintainer reference](maintainer-reference.md).
An ADR records rationale; the corresponding guide must contain the instructions
users need without requiring them to read the decision record.

To publish an update from the repository root:

```bash
make validate
git clone https://github.com/Alshival-Ai/neural-labs.wiki.git /tmp/neural-labs-wiki
python3 bin/export-wiki.py /tmp/neural-labs-wiki
git -C /tmp/neural-labs-wiki diff --check
git -C /tmp/neural-labs-wiki diff --stat
# Review the changes before publishing.
git -C /tmp/neural-labs-wiki add -- '*.md'
git -C /tmp/neural-labs-wiki commit -m "Update documentation and user guides"
git -C /tmp/neural-labs-wiki push origin master
```

Publish corresponding source changes to `main` first. The export overwrites matching generated pages but preserves unrelated wiki pages. If a source page is removed or renamed, review and remove its old wiki page explicitly. Never include deployment secrets or generated tenant state in either repository.
