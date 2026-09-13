"""Exercise publication behavior against isolated, synthetic documentation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'export_wiki', Path(__file__).resolve().parents[1] / 'bin/export-wiki.py')
export_wiki = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_wiki)


class WikiExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        (self.root / 'wiki/adr').mkdir(parents=True)
        (self.root / 'wiki/README.md').write_text('# Quick setup\n')
        (self.root / 'wiki/navigation.md').write_text(
            '# Documentation\n[Start](README.md#setup)\n'
            '[History](adr/record.md)\n[Source](../source.py)\n')
        (self.root / 'wiki/adr/record.md').write_text('# Historical record\n')
        (self.root / 'source.py').write_text('# public source\n')
        for name in ('CHANGELOG.md', 'roadmap.md', 'tracker.md'):
            (self.root / name).write_text('# Project reference\n')
        root_patch = patch.object(export_wiki, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_check_writes_nothing_and_sidebar_uses_rewritten_directory(self):
        before = sorted(self.root.rglob('*'))
        output = export_wiki.export()
        self.assertEqual(before, sorted(self.root.rglob('*')))
        self.assertEqual(output['_Sidebar.md'], output['navigation.md'])
        self.assertIn('/wiki/Home#setup', output['_Sidebar.md'])
        self.assertIn('/wiki/adr-record', output['_Sidebar.md'])
        self.assertIn('/blob/main/source.py', output['_Sidebar.md'])

    def test_broken_link_does_not_partially_update_a_wiki(self):
        destination = Path(self.temp.name) / 'published'
        destination.mkdir()
        (destination / 'Home.md').write_text('Previously published home\n')
        (self.root / 'wiki/broken.md').write_text('[Missing](missing.md)\n')
        with self.assertRaisesRegex(ValueError, 'Broken link'):
            export_wiki.export(destination)
        self.assertEqual((destination / 'Home.md').read_text(),
                         'Previously published home\n')
        self.assertEqual([p.name for p in destination.iterdir()], ['Home.md'])

    def test_export_preserves_unrelated_pages(self):
        destination = Path(self.temp.name) / 'published'
        destination.mkdir()
        (destination / 'operator-notes.md').write_text('Unrelated page\n')
        export_wiki.export(destination)
        self.assertEqual((destination / 'Home.md').read_text(), '# Quick setup\n')
        self.assertEqual((destination / 'operator-notes.md').read_text(),
                         'Unrelated page\n')

    def test_colliding_flattened_page_names_are_rejected(self):
        (self.root / 'wiki/adr-record.md').write_text('# Collision\n')
        with self.assertRaisesRegex(ValueError, 'Duplicate wiki page names'):
            export_wiki.export()


if __name__ == '__main__':
    unittest.main()
