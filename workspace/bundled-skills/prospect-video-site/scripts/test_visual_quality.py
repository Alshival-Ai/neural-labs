"""Real-media regressions for sparse motion and evidence-driven design gates."""
import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from visual_quality import (QualityError, required, validate_assets, validate_direction,
                            validate_frames)


class DirectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'selection.json').write_text(json.dumps({'placeId': 'fixture-place'}))
        (self.root / 'evidence.md').write_text('Fixture research/QA evidence; not a real inspection.')
        self.doc = {
            'schemaVersion': 1, 'placeId': 'fixture-place',
            'photoCoverage': {'status': 'inspected', 'inspectedCount': 2,
                              'scope': 'Test exterior and interior', 'limitations': 'Fixture only',
                              'evidencePath': 'evidence.md'},
            'observations': [{'id': 'books', 'sourceUrl': 'https://example.com/photo',
                              'observation': 'A bookcase', 'confidence': 'observed'}],
            'designDecisions': [{'observationIds': ['books'], 'kind': 'layout',
                                 'feature': 'Book-like menu', 'customerBenefit': 'Find drinks by category',
                                 'implementationTarget': '#menu'}],
            'assetPolicy': {'generation': {'status': 'unavailable', 'evidencePath': 'evidence.md'},
                            'stockExceptions': []}}

    def save(self):
        (self.root / 'BUSINESS-VISUAL-BRIEF.json').write_text(json.dumps(self.doc))

    def test_observation_drives_layout(self):
        self.save()
        self.assertEqual(validate_direction(self.root)['placeId'], 'fixture-place')

    def test_palette_only_is_insufficient(self):
        self.doc['designDecisions'][0]['kind'] = 'color'
        self.save()
        with self.assertRaisesRegex(QualityError, 'not only color'):
            validate_direction(self.root)

    def test_unavailable_gallery_has_honest_fallback(self):
        self.doc['photoCoverage']['status'] = 'unavailable'
        self.doc['observations'] = []
        self.doc['designDecisions'][0]['observationIds'] = []
        self.doc['fallbackDirectionReason'] = 'Fixture source unavailable; official menu supports direction'
        self.save()
        validate_direction(self.root)

    def test_stock_without_exception_fails(self):
        manifest = {'assets': [{'id': 'hero', 'origin': 'stock', 'sourceUrl': 'https://pexels.com/photo/1/'}]}
        with self.assertRaisesRegex(QualityError, 'justified exception'):
            validate_assets(self.root, self.doc, manifest)
        self.doc['assetPolicy']['stockExceptions'] = [{'assetId': 'hero',
            'basis': 'generation-unavailable', 'reason': 'Fixture provider unavailable',
            'evidencePath': 'evidence.md'}]
        validate_assets(self.root, self.doc, manifest)

    def test_disguising_pexels_as_generated_fails(self):
        with self.assertRaisesRegex(QualityError, 'retain stock origin'):
            validate_assets(self.root, self.doc, {'assets': [{'id': 'hero', 'origin': 'generated',
                'sourceUrl': 'https://www.pexels.com/photo/1/'}]})

    def test_history_compatible_new_state_enforced(self):
        self.assertFalse(required(self.root, {'schemaVersion': 1}))
        self.assertTrue(required(self.root, {'qualityVersion': 2}))


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required for media regression')
class FrameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.tmp.name)
        (cls.base / 'site/frames').mkdir(parents=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=size=160x90:rate=24:duration=4', '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p', str(cls.base / 'original.mp4')], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(cls.base / 'original.mp4'),
                        '-c:v', 'libwebp', str(cls.base / 'site/frames/f-%03d.webp')], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        shutil.copytree(self.base, self.root, dirs_exist_ok=True)
        self.sequence = {'id': 'sequence', 'localPath': 'site/frames/f-%03d.webp',
                         'frameCount': 96, 'frameRate': 24, 'firstFrame': 1,
                         'sourceStartSeconds': 0, 'sourceDurationSeconds': 4,
                         'derivedFrom': 'original'}
        self.manifest = {'assets': [self.sequence, {'id': 'original', 'localPath': 'original.mp4'}],
                         'scrollFrameEffects': [{'id': 'scene', 'sequenceAssetId': 'sequence'}]}

    def test_native_dense_sequence_decodes(self):
        self.assertEqual(validate_frames(self.root, self.manifest)['frameEffectCount'], 1)

    def test_dream_creations_sparse_pattern_rejected(self):
        self.sequence.update(frameCount=40, frameRate=3, sourceDurationSeconds=13.1667)
        with self.assertRaisesRegex(QualityError, 'too sparse'):
            validate_frames(self.root, self.manifest)

    def test_duplicate_upsampling_rejected(self):
        first = self.root / 'site/frames/f-001.webp'
        for i in range(2, 97):
            shutil.copyfile(first, self.root / f'site/frames/f-{i:03d}.webp')
        with self.assertRaisesRegex(QualityError, 'duplicate'):
            validate_frames(self.root, self.manifest)

    def test_missing_middle_frame_rejected(self):
        (self.root / 'site/frames/f-047.webp').unlink()
        with self.assertRaisesRegex(QualityError, 'Missing or empty'):
            validate_frames(self.root, self.manifest)

    def test_faster_than_source_rejected(self):
        self.sequence.update(frameRate=30, frameCount=120)
        with self.assertRaisesRegex(QualityError, 'Upsampling'):
            validate_frames(self.root, self.manifest)

    def test_three_endpoint_checks_do_not_prove_smoothness(self):
        with self.assertRaisesRegex(QualityError, 'actual browser'):
            validate_frames(self.root, self.manifest, {'scenes': [{'id': 'scene', 'endpoints': [1, 48, 96]}]})

    def test_long_travel_with_few_frames_rejected(self):
        with self.assertRaisesRegex(QualityError, 'spacing is too coarse'):
            validate_frames(self.root, self.manifest, {'scenes': [{'id': 'scene', 'observed': True,
                'browser': 'Fixture', 'viewport': '1440x900', 'activeScrollPx': 4000}]})

    def test_corrupt_file_rejected(self):
        (self.root / 'site/frames/f-048.webp').write_bytes(b'not a valid WebP image')
        with self.assertRaisesRegex(QualityError, 'undecodable'):
            validate_frames(self.root, self.manifest)


if __name__ == '__main__':
    unittest.main()
