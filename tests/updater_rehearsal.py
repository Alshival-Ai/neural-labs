#!/usr/bin/env python3
"""Operator/CI-only Docker rehearsal. All state is synthetic and uniquely named.

Exercises the real Compose adapter, protected archives, three cloned volumes,
previous-volume restoration, and the no-rollback boundary using fault injection.
The independent openclaw-upgrade-smoke suite verifies native runtime migrations.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy/updater'))
from updater import Host, Worker, Api, atomic, read, run, UpdateFailure, MOUNTS

POSTGRES='postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af'
SCRIPT='''
const fs=require('fs'), http=require('http');
if(process.env.NEURAL_LABS_UPDATE_PROBATION==='true') {
 for(const root of ['/home/node','/home/node/.openclaw','/home/node/.config/openclaw']) fs.writeFileSync(root+'/candidate-marker','candidate-only');
}
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({protocol:1,idle:true,probation:process.env.NEURAL_LABS_UPDATE_PROBATION==='true'}));}).listen(18790,'0.0.0.0');
'''

class TestApi:
 def __init__(self): self.phases=[]
 def call(self,path,body=None):
  if body and body.get('job'): self.phases.append(body['job']['phase'])
  return {'policy':{'openclawAutomatic':False},'teamRuns':0,'activeRequests':0,'notificationSends':0}

class RehearsalHost(Host):
 def __init__(self, config, failure=False):
  super().__init__(config); self.api=TestApi(); self.failure=failure; self.closed=False; self.launched=[]
 def overlay(self, deployment, probation):
  super().overlay(deployment,probation)
  file=self.root/'active-compose.yaml'
  file.write_text(file.read_text().replace('127.0.0.1:4182:18789','127.0.0.1::18789').replace('127.0.0.1:4183:18790','127.0.0.1::18790'))
 def gate(self,closed): self.closed=closed
 def pause(self): return None
 def resume(self): return None
 def activity(self): return True
 def prepare(self,manifest): return None
 def launch(self,deployment,probation):
  self.launched.append((deployment['volumes'],probation))
  super().launch(deployment,probation)
 def verify(self,deployment,probation):
  if self.failure and probation and any('_update_' in name for name in deployment['volumes'].values()):
   self.failure=False
   raise UpdateFailure('Injected candidate verification failure')
  for _ in range(60):
   try:
    actual=self.installed()
    c=json.loads(run(['docker','inspect',actual['container']]))[0]
    port=c['NetworkSettings']['Ports']['18790/tcp'][0]['HostPort']
    result=Api('http://127.0.0.1:'+port,'synthetic-test-token-32-characters').call('/internal/updates/activity')
    assert result['probation']==probation and actual['volumes']==deployment['volumes']
    for target in MOUNTS:
     assert run(['docker','exec',actual['container'],'cat',target+'/sentinel']).strip()=='synthetic-preserved'
    return
   except Exception: time.sleep(1)
  raise UpdateFailure('Synthetic candidate did not become healthy')


def rehearse(image, failure):
 project='neural-updater-rehearsal-'+uuid.uuid4().hex[:12]
 parent=Path(os.environ.get('UPDATER_REHEARSAL_ROOT',tempfile.gettempdir()))
 parent.mkdir(parents=True,exist_ok=True)
 directory=Path(tempfile.mkdtemp(prefix=project+'-',dir=parent))
 volumes={target:project+'-original-'+str(i) for i,target in enumerate(MOUNTS)}
 created=list(volumes.values())
 config={'stateDirectory':str(directory),'project':project,'controlPlane':'http://127.0.0.1:1','workspace':'http://127.0.0.1:1',
  'workerToken':'synthetic-test-token-32-characters','workspaceToken':'synthetic-test-token-32-characters','readinessSeconds':60,'budgetSeconds':3600}
 host=RehearsalHost(config,failure)
 deployment={'image':image,'openclawVersion':'2026.9.5','codexVersion':'0.155.1','volumes':volumes}
 base={'services':{'workspace':{'image':image,'user':'0','command':['node','-e',SCRIPT], 'healthcheck':{'disable':True}},
  'postgres':{'image':POSTGRES,'environment':{'POSTGRES_PASSWORD':'synthetic-test-only','POSTGRES_DB':'neural_labs','POSTGRES_USER':'neural_labs'}}}}
 atomic(directory/'base-compose.json',base)
 try:
  for volume in volumes.values():
   run(['docker','volume','create','--label','neural-labs.purpose=synthetic-updater-rehearsal',volume])
   run(['docker','run','--rm','--network=none','--user=0','--entrypoint=node','--mount',f'type=volume,src={volume},dst=/state',image,
        '-e',"require('fs').writeFileSync('/state/sentinel','synthetic-preserved')"])
  host.overlay(deployment,False)
  host.compose('up','-d','postgres')
  for _ in range(60):
   try:
    host.compose('exec','-T','postgres','pg_isready','-U','neural_labs');break
   except UpdateFailure: time.sleep(1)
  else: raise UpdateFailure('Synthetic database did not become ready')
  host.launch(deployment,False);host.verify(deployment,False)
  worker=Worker(host)
  job={'id':str(uuid.uuid4()),'phase':'queued','kind':'install','release_id':'workspace-v0.0.1'}
  manifest={'id':job['release_id'],'manualRequired':False,'image':image,'openclawVersion':'2026.9.5','codexVersion':'0.155.1'}
  try: worker.execute(job,manifest,{'openclawAutomatic':False})
  except UpdateFailure: worker.failure()
  state=read(worker.journal);created.extend(state.get('candidate',{}).get('volumes',{}).values())
  assert state['done'] and state['phase']==('restored' if failure else 'succeeded') and not host.closed
  assert host.installed()['volumes']==(volumes if failure else state['candidate']['volumes'])
  for volume in volumes.values():
   # Old originals must have no candidate writes (rollback's own probation marker
   # is generated by this synthetic test service, so inspect before normal startup
   # only in the success case; file sentinel is checked in both cases).
   run(['docker','run','--rm','--network=none','--entrypoint=node','--mount',f'type=volume,src={volume},dst=/state,readonly',image,
    '-e',"const fs=require('fs');if(fs.readFileSync('/state/sentinel','utf8')!=='synthetic-preserved')process.exit(1);"+
    ("if(fs.existsSync('/state/candidate-marker'))process.exit(2);" if not failure else '')])
  assert len(list((directory/'backups'/job['id']).glob('volume-*.tar')))==3
  print('Real Docker clone, deployment and '+('rollback' if failure else 'commit')+' rehearsal passed')
 finally:
  try: host.compose('down','--volumes','--remove-orphans')
  finally:
   state=read(directory/'journal.json',{})
   created.extend(state.get('candidate',{}).get('volumes',{}).values())
   for volume in set(created):
    if volume.startswith(project):
     try: run(['docker','volume','rm',volume])
     except UpdateFailure: pass
   shutil.rmtree(directory)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);args=parser.parse_args()
 if not re.fullmatch(r'(sha256:[a-f0-9]{64}|[^ ]+@sha256:[a-f0-9]{64})',args.image):parser.error('Use an immutable image')
 os.umask(0o077)
 rehearse(args.image,False);rehearse(args.image,True)
