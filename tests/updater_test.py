import asyncio
import contextlib
import json
import socket
import datetime as dt
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy/updater'))
from updater import Host, proxy, WORKFLOW, Worker, UpdateFailure, atomic, read, window_seconds, validate_manifest, MOUNTS

from install import compose_environment_value, state_directory

POLICY = {'runtimeAutomatic': True, 'days': [0], 'start': '03:00', 'end': '05:00', 'timezone': 'America/Chicago'}
BASELINE = 'ghcr.io/alshival-ai/neural-labs-workspace@sha256:'+'0'*64
MANIFEST = {'schema': 2, 'id': 'workspace-v1.0.1', 'image': 'ghcr.io/alshival-ai/neural-labs-workspace@sha256:'+'a'*64,
 'sourceRevision': 'b'*40, 'runtimeVersion': '1.0.1', 'codexVersion': '0.155.1', 'claudeVersion': '2.1.226',
 'baseImage': 'node:22-bookworm-slim@sha256:'+'c'*64,
 'supportedOrigins': [BASELINE], 'protocol': 1, 'platforms':['linux/amd64','linux/arm64'], 'manualRequired':False,'reason':'',
 'notesUrl':'https://github.com/Alshival-Ai/neural-labs/releases/tag/workspace-v1.0.1', 'controlPlaneRevision':'e'*64,'hostRevision':'f'*64}

JOB = {'id':'11111111-1111-4111-8111-111111111111','phase':'queued','kind':'install','release_id':MANIFEST['id']}

class FakeHost:
 def __init__(self, root):
  self.root=Path(root); self.config={'project':'test','budgetSeconds':3600}; self.api=self
  self.calls=[]; self.fail=None; self.idle=True; self.gated=False; self.current=self.installed(); self.phase='queued'
 def installed(self): return {'image':'sha256:'+'0'*64, 'reference':BASELINE, 'volumes':dict(zip(MOUNTS,['original-home'])), 'runtimeVersion':'1.0.0','codexVersion':'0.155.1','claudeVersion':'2.1.226'}
 def step(self, name):
  self.calls.append(name)
  if self.fail==name: self.fail=None; raise UpdateFailure('Injected failure')
 def call(self,path,body=None):
  if body and body.get('job'): self.phase=body['job']['phase']; self.step('phase:'+self.phase)
  return {'policy':POLICY,'job':None,'maintenance':False,'jobs':[]}
 def gate(self,value): self.step('gate:'+str(value)); self.gated=value
 def prepare(self,m): self.step('prepare')
 def activity(self): self.step('activity'); return self.idle
 def pause(self): self.step('pause')
 def resume(self): self.step('resume')
 def stop(self): self.step('stop')
 def clone(self,job,old,candidate):
  assert set(old['volumes'].values()).isdisjoint(candidate['volumes'].values())
  self.step('clone')
 def launch(self,deployment,probation): self.current=deployment; self.step('launch:'+('old' if deployment['image'].startswith('sha256:') else 'candidate')+':'+str(probation))
 def verify(self,deployment,probation): self.step('verify:'+('old' if deployment['image'].startswith('sha256:') else 'candidate')+':'+str(probation))

class WorkerTests(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
  self.host=FakeHost(self.directory.name); self.worker=Worker(self.host)
 def execute(self): self.worker.execute(JOB,MANIFEST,POLICY)
 def test_success_orders_gate_backup_probation_commit_reopen(self):
  self.execute(); c=self.host.calls
  for left,right in [('gate:True','clone'),('clone','launch:candidate:True'),('verify:candidate:True','phase:committing'),('phase:committing','launch:candidate:False'),('verify:candidate:False','gate:False')]:
   self.assertLess(c.index(left),c.index(right))
  self.assertTrue(read(self.worker.journal)['committed']); self.assertEqual(self.host.phase,'succeeded')
 def test_failure_before_commit_restores_exact_original_volumes(self):
  for fault in ['clone','launch:candidate:True','verify:candidate:True']:
   with self.subTest(fault=fault):
    self.host.calls=[]; self.host.fail=fault
    with self.assertRaises(UpdateFailure): self.execute()
    self.worker.failure()
    self.assertEqual(self.host.current['volumes'],self.host.installed()['volumes'])
    self.assertEqual(self.host.phase,'restored'); self.assertFalse(self.host.gated)
 def test_failure_after_commit_never_launches_originals(self):
  self.host.fail='verify:candidate:False'
  with self.assertRaises(UpdateFailure): self.execute()
  self.worker.failure()
  self.assertFalse(any(c.startswith('launch:old') for c in self.host.calls))
  self.assertEqual(self.host.phase,'succeeded')
 def test_activation_failure_preserves_selected_volumes_without_restarting(self):
  self.host.fail='resume'
  with self.assertRaises(UpdateFailure): self.execute()
  before=len([c for c in self.host.calls if c.startswith('launch:')])
  self.worker.failure()
  self.assertEqual(self.host.phase,'recovery_required'); self.assertTrue(self.host.gated)
  self.assertEqual(len([c for c in self.host.calls if c.startswith('launch:')]),before)
 def test_failed_recovery_remains_gated(self):
  self.host.fail='verify:candidate:True'
  with self.assertRaises(UpdateFailure): self.execute()
  self.host.fail='verify:old:True'; self.worker.failure()
  self.assertEqual(self.host.phase,'recovery_required'); self.assertTrue(self.host.gated)
 def test_restart_replays_durable_commit_without_rollback(self):
  self.host.fail='phase:committing'
  with self.assertRaises(UpdateFailure): self.execute()
  Worker(self.host).tick()
  self.assertEqual(self.host.phase,'succeeded'); self.assertFalse(any(c.startswith('launch:old') for c in self.host.calls))
 def test_busy_race_does_not_stop_or_clone(self):
  original=self.host.pause
  def pause(): original(); self.host.idle=False
  self.host.pause=pause; self.execute()
  self.assertNotIn('stop',self.host.calls); self.assertNotIn('clone',self.host.calls)
  self.assertEqual(self.host.phase,'deferred'); self.assertFalse(self.host.gated)
 def test_manual_required_never_pulls_or_stops(self):
  self.worker.execute(JOB,{**MANIFEST,'manualRequired':True},POLICY)
  self.assertEqual(self.host.phase,'failed'); self.assertNotIn('prepare',self.host.calls)
 def test_prepare_failure_does_not_close_access(self):
  self.host.fail='prepare'
  with self.assertRaises(UpdateFailure): self.execute()
  self.worker.failure(); self.assertEqual(self.host.phase,'failed'); self.assertNotIn('gate:True',self.host.calls)
 def test_ack_failure_after_success_reopens_on_restart(self):
  self.host.fail='gate:False'
  with self.assertRaises(UpdateFailure): self.execute()
  Worker(self.host).tick(); self.assertFalse(self.host.gated)
  self.assertTrue(read(self.worker.journal)['done'])

class PolicyTests(unittest.TestCase):
 def test_first_native_release_requires_operator_preservation(self):
  self.assertTrue(validate_manifest({**MANIFEST, 'supportedOrigins': [], 'manualRequired': True})['manualRequired'])
  for change in [{'schema': 1}, {'schema': True}, {'protocol': True}, {'supportedOrigins': ['2026.9.5']}, {'supportedOrigins': [BASELINE, BASELINE]}]:
   with self.subTest(change=change), self.assertRaises(UpdateFailure): validate_manifest({**MANIFEST, **change})
 def test_window_chicago_normal_and_dst(self):
  for iso,seconds in [('2026-09-20T08:00:00+00:00',7140),('2026-09-20T09:59:30+00:00',0),('2026-03-08T08:00:00+00:00',7140),('2026-11-01T09:00:00+00:00',7140),('2026-09-21T08:00:00+00:00',0)]:
   self.assertEqual(window_seconds(POLICY,dt.datetime.fromisoformat(iso)),seconds)
 def test_repeated_hour_is_real_elapsed_time(self):
  p={**POLICY,'start':'01:00','end':'02:00'}
  self.assertEqual(window_seconds(p,dt.datetime.fromisoformat('2026-11-01T06:00:00+00:00')),7140)
 def test_manifest_rejects_untrusted_origins_tags_and_commands(self):
  self.assertEqual(validate_manifest(MANIFEST),MANIFEST)
  for change in [{'image':'ubuntu:latest'},{'sourceRevision':'main'},{'protocol':2},{'command':'echo bypass'},{'platforms':['linux/amd64']},{'notesUrl':'https://example.org'},{'manualRequired':'false'},{'supportedOrigins':[]}]:
   with self.subTest(change=change),self.assertRaises(UpdateFailure): validate_manifest({**MANIFEST,**change})

class ProvenanceTests(unittest.TestCase):
 def test_both_artifacts_require_exact_signer_tag_and_commit(self):
  with tempfile.TemporaryDirectory() as directory:
   host=Host({'stateDirectory':directory,'controlPlane':'http://127.0.0.1:1','workspace':'http://127.0.0.1:2',
    'workerToken':'w'*32,'workspaceToken':'s'*32,'controlPlaneRevision':MANIFEST['controlPlaneRevision'],'hostRevision':MANIFEST['hostRevision']})
   host.installed=lambda:{'reference':BASELINE}
   calls=[]
   def command(args,**_kwargs):
    calls.append(args)
    if args[:2]==['gh','api']: return json.dumps([{'draft':False,'prerelease':False,'tag_name':MANIFEST['id']}])
    if args[:3]==['gh','release','download']:
     atomic(Path(directory)/'releases'/MANIFEST['id']/'workspace-release.json',MANIFEST)
    return ''
   with patch('updater.run',side_effect=command): self.assertFalse(host.discover()['manualRequired'])
   checks=[c for c in calls if c[:3]==['gh','attestation','verify']]
   self.assertEqual(len(checks),2)
   for args in checks:
    self.assertEqual(args[args.index('--signer-workflow')+1],WORKFLOW)
    self.assertEqual(args[args.index('--source-digest')+1],MANIFEST['sourceRevision'])
    self.assertEqual(args[args.index('--source-ref')+1],'refs/tags/'+MANIFEST['id'])
    self.assertIn('--deny-self-hosted-runners',args)
   def rejected(args,**kwargs):
    if args[:3]==['gh','attestation','verify']: raise UpdateFailure('Untrusted signature')
    return command(args,**kwargs)
   with patch('updater.run',side_effect=rejected),self.assertRaises(UpdateFailure): host.discover()
   self.assertFalse(any(c[:2]==['docker','pull'] for c in calls))

class NativeHostTests(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
  self.host=Host({'stateDirectory':self.directory.name,'project':'fixture','controlPlane':'http://127.0.0.1:1',
   'workspace':'http://127.0.0.1:2','workerToken':'w'*32,'workspaceToken':'s'*32})
  self.host.compose=lambda *args:'container'
  self.container={'Image':'sha256:'+'0'*64, 'Config':{'Image':BASELINE,'Env':[
   'NEURAL_LABS_RUNTIME_VERSION=1.0.0','NEURAL_LABS_CODEX_VERSION=0.155.1','NEURAL_LABS_CLAUDE_VERSION=2.1.226']},
   'Mounts':[{'Type':'volume','Name':'home','Destination':'/home/node'}]}
 def test_only_completed_native_home_layout_is_admitted(self):
  with patch('updater.run',return_value=json.dumps([self.container])):
   self.assertEqual(self.host.installed()['volumes'], {'/home/node':'home'})
  for mount in [ {'Type':'volume','Name':'legacy','Destination':'/home/node/.openclaw'},
                 {'Type':'bind','Source':'/private','Destination':'/other'}]:
   c={**self.container,'Mounts':[*self.container['Mounts'],mount]}
   with patch('updater.run',return_value=json.dumps([c])), self.assertRaises(UpdateFailure): self.host.installed()
  c={**self.container,'Config':{**self.container['Config'],'Env':['NEURAL_LABS_OPENCLAW_VERSION=2026.9.5']}}
  with patch('updater.run',return_value=json.dumps([c])), self.assertRaises(UpdateFailure): self.host.installed()
 def test_overlay_preserves_single_home_and_only_native_listener(self):
  with patch('updater.run',return_value=json.dumps([self.container])): deployment=self.host.installed()
  self.host.overlay(deployment,True)
  result=(self.host.root/'active-compose.yaml').read_text()
  self.assertIn('127.0.0.1:4183:18790',result); self.assertNotIn('18789',result)
  self.assertNotIn('openclaw',result.lower()); self.assertEqual(result.count('target: /home/node'),1)
  self.assertIn('"NEURAL_LABS_UPDATE_PROBATION": "true"',result)
 def test_unsupported_architecture_does_not_pull_or_mutate(self):
  with patch('updater.run',return_value='riscv64') as command, self.assertRaises(UpdateFailure): self.host.prepare(MANIFEST)
  self.assertEqual(command.call_count,1)

class ProxyTests(unittest.IsolatedAsyncioTestCase):
 async def test_gate_closes_existing_connections_and_invalid_state_fails_closed(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   async def echo(reader,writer):
    try:
     while data:=await reader.read(100): writer.write(data);await writer.drain()
    finally: writer.close()
   backend=await asyncio.start_server(echo,'127.0.0.1',0)
   target=backend.sockets[0].getsockname()[1]
   with socket.socket() as probe: probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
   task=asyncio.create_task(proxy(root,[(port,target)]))
   async def gate(state):
    atomic(root/'gate.json',state)
    for _ in range(100):
     if read(root/'gate-ack.json',{}).get('nonce')==state['nonce']:return
     await asyncio.sleep(.01)
    self.fail('Gate acknowledgement missing')
   try:
    await gate({'closed':False,'nonce':'open'})
    reader,writer=await asyncio.open_connection('127.0.0.1',port)
    writer.write(b'hello');await writer.drain();self.assertEqual(await reader.read(5),b'hello')
    await gate({'closed':True,'nonce':'closed'})
    self.assertEqual(await asyncio.wait_for(reader.read(5),1),b'')
    writer.close();await writer.wait_closed()
    await gate({'closed':False,'nonce':'reopen'})
    (root/'gate.json').write_text('invalid')
    await asyncio.sleep(.1)
    reader,writer=await asyncio.open_connection('127.0.0.1',port)
    result=await asyncio.wait_for(reader.read(1000),1)
    self.assertIn(b'503',result)
    writer.close();await writer.wait_closed()
   finally:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):await task
    backend.close();await backend.wait_closed()

class InstallerTests(unittest.TestCase):
 def test_docker_distribution_selects_protected_readable_state(self):
  self.assertEqual(str(state_directory('/var/lib/docker')), '/var/lib/neural-labs/updater')
  self.assertEqual(str(state_directory('/var/snap/docker/common/var-lib-docker')), '/var/snap/docker/common/neural-labs-updater')
 def test_api_token_decodes_compose_serialization(self):
  self.assertEqual(compose_environment_value('literal$$VALUE$${OTHER}$$$$'),'literal$VALUE${OTHER}$$')
  self.assertEqual(compose_environment_value('plain-token'),'plain-token')

if __name__=='__main__': unittest.main()
