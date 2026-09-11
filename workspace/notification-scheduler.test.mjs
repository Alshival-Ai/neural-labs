import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNotificationRun,notificationScheduler} from './notification-scheduler.mjs';
test('notification summaries exclude raw scheduler contents and preserve failed completion',()=>{
 const row={action:'finished',status:'ok',completionStatus:'failed',jobId:'job',runAtMs:10,ts:20,error:'private',summary:'private',runId:'native'};
 assert.deepEqual(normalizeNotificationRun(row,[{id:'job',name:'Example'}]),{id:'10',jobId:'job',name:'Example',outcome:'failure',finishedAt:20});
 assert.equal(normalizeNotificationRun({...row,status:'skipped'},[]),undefined);
});
test('validates active run identity and limits session association to personal draft sessions',async()=>{
 const request=async(method)=>method==='cron.list'?{jobs:[{id:'job',name:'Example',state:{runningAtMs:10},payload:{message:'private'}}]}:method==='sessions.list'?{sessions:[{key:'own',visibility:'draft'},{key:'team',visibility:'shared'}]}:{entries:[]};
 assert.equal((await notificationScheduler(request,'run',{jobId:'job',runId:'10'})).run.running,true);
 assert.equal((await notificationScheduler(request,'run',{jobId:'job',runId:'fake'})).run,null);
 const userId='11111111-1111-1111-1111-111111111111';
 assert.equal((await notificationScheduler(request,'session',{userId,sessionKey:'team'})).owned,false);
 assert.equal((await notificationScheduler(request,'session',{userId,sessionKey:'own'})).owned,true);
});
