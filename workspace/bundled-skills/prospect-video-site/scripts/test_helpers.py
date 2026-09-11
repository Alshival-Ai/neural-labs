import importlib.util
import tempfile
import json
import copy
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

pipeline = module('pipeline')
candidates = module('candidates')

class ProjectGates(unittest.TestCase):
    def test_rejects_escape_and_inline_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<html><script>alert(1)</script></html>')
            with self.assertRaises(pipeline.PipelineError):
                pipeline.validate_publisher_csp(site)
            (site / 'index.html').write_text('<html><script src="../outside.js"></script></html>')
            (root / 'outside.js').write_text('')
            with self.assertRaises(pipeline.PipelineError):
                pipeline.validate_publisher_csp(site)
            (site / 'index.html').write_text('<html><script src="app.js"></script></html>')
            (site / 'app.js').write_text('console.log("test");')
            pipeline.validate_publisher_csp(site)

    def test_reservations_are_idempotent_only_for_the_same_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a, b = root / 'example-a', root / 'example-b'
            a.mkdir(); b.mkdir()
            fields = dict(city='Example City', place_id='place-one', business_name='Example Shop', address='1 Main St', hostname='example.demo.alshival.dev', category='retail')
            self.assertTrue(candidates.reserve(root, a, **fields)['reserved'])
            self.assertTrue(candidates.reserve(root, a, **fields)['idempotent'])
            with self.assertRaises(RuntimeError):
                candidates.reserve(root, a, **{**fields, 'place_id': 'different-place'})
            self.assertFalse(candidates.reserve(root, b, **fields)['reserved'])

    def test_duplicate_identity_is_excluded_across_city_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a, b = root / 'first', root / 'second'
            a.mkdir(); b.mkdir()
            fields = dict(city='Aurora', place_id='same-place', business_name='Example Shop', address='1 Main St', hostname='example.demo.alshival.dev', category='retail')
            candidates.reserve(root, a, **fields)
            result = candidates.reserve(root, b, **{**fields, 'city': 'Aurora, CO'})
            self.assertFalse(result['reserved'])

    def test_published_project_cannot_be_reserved_or_rebuilt_with_stale_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); project = root / 'example'; project.mkdir()
            fields = dict(city='Example City', place_id='place-one', business_name='Example Shop', address='1 Main St', hostname='example.demo.alshival.dev', category='retail')
            candidates.reserve(root, project, **fields)
            (project/'PIPELINE-STATE.json').write_text(json.dumps({'schemaVersion':1,'stage':'build-ready'}))
            for filename, status in [('RELEASE-RESULT.json','active'), ('RELEASE-VERIFICATION.json','passed')]:
                with self.subTest(filename=filename):
                    (project/filename).write_text(json.dumps({'status':status}))
                    self.assertEqual(candidates.reserve(root, project, **fields)['conflict'], 'already-published')
                    self.assertEqual(candidates.published_evidence(project), filename)
                    with patch.object(pipeline, 'RUNS_ROOT', root), self.assertRaisesRegex(pipeline.PipelineError, 'already published'):
                        pipeline.cmd_begin_build(SimpleNamespace(run_dir=str(project)))
                    (project/filename).unlink()
            self.assertTrue(candidates.reserve(root, project, **fields)['idempotent'])

    def test_build_cannot_pass_without_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises((pipeline.PipelineError, FileNotFoundError)):
                pipeline.validate_build(Path(directory))

class ResearchGates(unittest.TestCase):
    def fixture(self, root):
        (root/'evidence.md').write_text('Tool calls and observed business evidence')
        (root/'SOURCES.md').write_text('Source ledger')
        (root/'selection.json').write_text(json.dumps({'placeId':'example-place'}))
        return {'researchPass': {'version':1,'placeId':'example-place','businessSummary':'Verified shop with directions CTA',
            'authenticMediaDecision':'Official shop image selected for identity',
            'sources':[{'sourceType':kind,'url':'https://example.org','checkedAt':'2026-09-07T12:00:00Z','outcome':'Checked','evidencePath':'evidence.md'} for kind in ['official-website','official-social','google-places']],
            'googlePhotos':{'status':'inspected','photoToolCalls':1,'inspectedPhotoCount':1,'reason':'Exact storefront inspected','evidencePath':'evidence.md'}}}

    def test_requires_real_research_records_and_photo_inspection_counts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);good=self.fixture(root)
            for change in ['missing','no-photo-call','no-view','wrong-place','escape','missing-source']:
                data=copy.deepcopy(good);r=data['researchPass']
                if change=='missing': data={}
                elif change=='no-photo-call': r['googlePhotos']['photoToolCalls']=0
                elif change=='no-view': r['googlePhotos']['inspectedPhotoCount']=0
                elif change=='wrong-place': r['placeId']='other'
                elif change=='escape': r['sources'][0]['evidencePath']='../outside.md'
                else: r['sources'].pop()
                (root/'research.json').write_text(json.dumps(data))
                with self.subTest(change=change), self.assertRaises(pipeline.PipelineError): pipeline.validate_research(root)
            (root/'research.json').write_text(json.dumps(good));pipeline.validate_research(root)
            good['researchPass']['googlePhotos'].update(status='no-photos',photoToolCalls=0,inspectedPhotoCount=0,reason='Details returned no photos')
            (root/'research.json').write_text(json.dumps(good));pipeline.validate_research(root)

    def test_preview_only_authentic_assets_require_production_followup(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            data={'schemaVersion':1,'authenticMediaSearch':{'completed':True,'result':'usable-found','sourcesChecked':[{'sourceType':'official-website','url':'https://example.org','outcome':'Selected'}]},'scrollVideoEffects':[],
                'assets':[{'identityClass':'business-authentic','sourceUrl':'https://example.org/photo.jpg','localPath':'site/assets/business/shop.jpg','identityEvidence':'Official site of exact shop','usageBasis':'Business source supports concept preview','credit':'Example Shop','rightsStatus':'public-preview-only'}]}
            (root/'MEDIA.json').write_text(json.dumps(data))
            with self.assertRaises(pipeline.PipelineError):pipeline.validate_media_manifest(root)
            data['assets'][0]['productionFollowUp']='Confirm client permission before official launch'
            (root/'MEDIA.json').write_text(json.dumps(data));pipeline.validate_media_manifest(root)

class SiteGeneratorRouting(unittest.TestCase):
    def test_named_business_uses_selected_identity_without_scouting(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); project = root / 'chosen-business'; project.mkdir()
            with patch.object(pipeline, 'RUNS_ROOT', root):
                pipeline.cmd_init(SimpleNamespace(run_dir=str(project), mode='named', city='Example City'))
                candidates.reserve(root, project, city='Example City', place_id='chosen-place',
                    business_name='Chosen Business', address='', hostname='chosen.demo.alshival.dev',
                    category='retail', business_kind='general')
                result = pipeline.cmd_record_selection(SimpleNamespace(run_dir=str(project)))
                self.assertEqual(result['state']['mode'], 'named')
                self.assertEqual(result['state']['selection']['placeId'], 'chosen-place')
                self.assertEqual(result['state']['stage'], 'selected')

    def test_explicit_alternative_template_can_use_its_own_presentation(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            brief = {'schemaVersion': 1, 'experience': {
                'templateSkill': 'website-template-2', 'presentationProfile': 'evidence-led'}}
            (root / 'WEBSITE-BRIEF.json').write_text(json.dumps(brief))
            for mode in ['prospect', 'named']:
                self.assertEqual(pipeline.validate_website_brief(root, {'mode': mode}, {}), 'evidence-led')

    def test_default_template_cannot_bypass_its_geometry_checks(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for template in ['', 'website-template-1']:
                brief = {'schemaVersion': 1, 'experience': {
                    'templateSkill': template, 'presentationProfile': 'evidence-led'}}
                (root / 'WEBSITE-BRIEF.json').write_text(json.dumps(brief))
                with self.assertRaises(pipeline.PipelineError):
                    pipeline.validate_website_brief(root, {'mode': 'prospect'}, {})
            brief['experience']['presentationProfile'] = 'cinematic-media-first'
            (root / 'WEBSITE-BRIEF.json').write_text(json.dumps(brief))
            with self.assertRaises(pipeline.PipelineError):
                pipeline.validate_website_brief(root, {'mode': 'named'}, {})

if __name__ == '__main__':
    unittest.main()
