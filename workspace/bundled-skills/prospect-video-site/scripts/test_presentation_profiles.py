"""Regression coverage for profile selection, independent of template identity."""
import json
import tempfile
import unittest
from pathlib import Path

from test_helpers import pipeline


class PresentationProfiles(unittest.TestCase):
    def brief(self, root, profile, template='website-template-1'):
        (root / 'WEBSITE-BRIEF.json').write_text(json.dumps({
            'schemaVersion': 1,
            'experience': {'templateSkill': template, 'presentationProfile': profile},
        }))

    def cinematic_qa(self):
        return {'viewports': [
            {'name': name, 'checks': {'cinematicMediaFirst': True},
             'diagnostics': {'cinematicProfile': {
                 'requested': True, 'profile': 'cinematic-media-first'}}}
            for name in ['desktop', 'tablet', 'mobile']
        ]}

    def test_original_composition_is_allowed_for_default_template(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.brief(root, 'evidence-led')
            self.assertEqual(pipeline.validate_website_brief(
                root, {'mode': 'prospect'}, {}), 'evidence-led')

    def test_selected_legacy_profile_still_requires_geometry(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.brief(root, 'cinematic-media-first')
            qa = self.cinematic_qa()
            self.assertEqual(pipeline.validate_website_brief(
                root, {'mode': 'prospect'}, qa), 'cinematic-media-first')
            qa['viewports'][2]['checks']['cinematicMediaFirst'] = False
            with self.assertRaisesRegex(pipeline.PipelineError, 'geometry failed'):
                pipeline.validate_website_brief(root, {'mode': 'prospect'}, qa)

    def test_selected_legacy_profile_cannot_skip_mobile(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.brief(root, 'cinematic-media-first', 'another-template')
            qa = self.cinematic_qa()
            qa['viewports'].pop()
            with self.assertRaisesRegex(pipeline.PipelineError, 'missing viewports'):
                pipeline.validate_website_brief(root, {'mode': 'prospect'}, qa)

    def test_unknown_profile_cannot_disable_validation(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.brief(root, 'skip-checks')
            with self.assertRaises(pipeline.PipelineError):
                pipeline.validate_website_brief(root, {'mode': 'prospect'}, {})

    def test_independent_csp_and_video_checks_remain_required(self):
        with self.assertRaises(pipeline.PipelineError):
            pipeline.validate_publisher_csp_qa({})
        with self.assertRaises(pipeline.PipelineError):
            pipeline.validate_scroll_video_qa({'viewports': []}, 1)


if __name__ == '__main__':
    unittest.main()
