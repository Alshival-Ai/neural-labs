// Explicit operator installation, run inside the workspace container with node.
// No credentials or instance-generated job IDs are written to the repository.
import { readdir, readFile, mkdir, cp, writeFile, rename } from 'node:fs/promises';
import { createGatewayAdminRequest } from '/usr/local/lib/neural-labs/personal-openai.mjs';
const workspace='/home/node/workspace';
const backups=`${workspace}/.neural-labs/skill-backups/${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(backups,{recursive:true,mode:0o700});
for(const name of ['site-generator','prospect-video-site','prospect-hunter','business-research-and-media','website-template-1','local-business-website-builder','cinematic-interactions','web-video-asset-preparation']) {
 const target=`${workspace}/skills/${name}`;
 try{await cp(target,`${backups}/${name}`,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
 await cp(`/usr/local/share/neural-labs/prospect-skills/${name}`,target,{recursive:true});
}
// Replacements are installed before retiring obsolete presentation directors.
for(const name of ['cinematic-media-first','prospect-business-discovery']) {
 try{await rename(`${workspace}/skills/${name}`,`${backups}/deprecated-${name}`);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
// Install current named-business routing without changing unrelated agent guidance.
const routingStart='<!-- neural-labs-website-routing:start -->';
const routingEnd='<!-- neural-labs-website-routing:end -->';
const routing=await readFile(`${workspace}/skills/site-generator/references/default-agent-routing.md`,'utf8');
const agentsPath=`${workspace}/AGENTS.md`;
const agents=await readFile(agentsPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
const routingIndex=agents.indexOf(routingStart);
const routingEndIndex=agents.indexOf(routingEnd,routingIndex);
if(routingIndex>=0 && routingEndIndex<0)throw Error('Incomplete website routing block');
await writeFile(`${backups}/AGENTS.md`,agents,{mode:0o600});
const routingBlock=`${routingStart}\n${routing.trim()}\n${routingEnd}`;
await writeFile(agentsPath,routingIndex>=0?agents.slice(0,routingIndex)+routingBlock+agents.slice(routingEndIndex+routingEnd.length):`${routingBlock}\n\n${agents}`,{mode:0o600});
const qaPath=`${workspace}/skills/prospect-video-site/scripts/qa-site.mjs`;
const qaSource=await readFile(qaPath,'utf8');
if(!qaSource.includes('"--no-sandbox"')) await writeFile(qaPath,qaSource.replace('"--headless=new",','"--headless=new",\n      "--no-sandbox",'));
let password;
for(const pid of await readdir('/proc')) {
 if(!/^\d+$/.test(pid))continue;
 try{const env=await readFile(`/proc/${pid}/environ`,'utf8');const entry=env.split('\0').find(v=>v.startsWith('OPENCLAW_GATEWAY_PASSWORD='));if(entry){password=entry.slice('OPENCLAW_GATEWAY_PASSWORD='.length);break;}}catch{}
}
if(!password)throw Error('Running Gateway operator authentication is unavailable');
const request=createGatewayAdminRequest({url:'ws://127.0.0.1:18789',password,timeoutMs:30000});
const name='Prospect Video Site - Alamo, TX';
const existing=(await request('cron.list',{includeDisabled:true,limit:200})).jobs.filter(job=>job.name===name);
if(existing.length>1)throw Error('More than one matching automation exists; inspect duplicates before proceeding');
const message="Use $site-generator: read /home/node/workspace/skills/site-generator/SKILL.md and its workflow-contract and act-production references. Complete exactly one eligible prospect in Alamo, Texas per run.\n\nUse $prospect-hunter for selection and $business-research-and-media before design or asset sourcing. Inspect real business photos, verify facts and record media rights. Prefer suitable authentic identity imagery. Plan each asset's subject, framing, lighting, crop and role before sourcing; use coordinated image_generate assets for representative roles, with stock only for an explicit request or documented fallback under the active builder asset-policy. Discover current provider availability first. Retain prompts/provenance and optimized local derivatives. Never present generated examples as the business's actual work, premises, staff or customers.\n\nTemplate: $local-business-website-builder. Load its current SKILL.md and Neural Labs workflow, business-photo-direction, asset-policy and quality-contract references. Its compatibility supplements remain at website-template-1; load those only when useful. Use qualityVersion 2. Read the template and design-system, asset-direction, visual-review and richboys-method references. Set experience.templateSkill to local-business-website-builder, presentationProfile to evidence-led and motionPolicy to auto for new builds. Choose an original hero composition and section narrative for the business; a typographic masthead, bounded photograph, split composition or full-bleed media are options. Useful location/category labels are permitted. Establish actual font choices, color roles, image treatment, primary action and storyboard before substantial code. Preserve the staged proof and continuation workflow. Study RichBoys as a process benchmark, not a palette, haircut image set or mandatory layout to copy. The prospect-video-site package supplies pipeline helpers and evidence schemas, not a second presentation director.\n\nUse zero to two purposeful advanced interactions; a static design is valid when motion adds no value. Choose effects from $cinematic-interactions according to the content: GSAP header text, Tedy sticky image choreography, horizontal gallery, parallax, meaningful image reveal or scroll-video progression are possibilities. Normally use one signature scene; add a second only for a separate communication job, maximum two. There is no mandatory video-plus-hover pair. Read the exact selected recipes, document the primitives and entry/progression/hold/release beats, and retain complete keyboard, touch, reduced-motion, Save-Data, no-JavaScript and failed-media behavior. Use $web-video-asset-preparation only when selecting video. Use cinematic-media-first and its geometry hooks only for an explicitly selected legacy full-bleed overlay design. Preserve an existing unfinished project's recorded profile unless revising it is explicitly requested.\n\nOutput: hosted-preview. Inspect the actual opening and signature scene at desktop/tablet/mobile before expanding the site. Then inspect full-page and critical-state screenshots, correct specific hierarchy, crop, spacing and contrast defects, and test real controls. For scroll effects verify forward/reverse/rapid input, mid-scene refresh, breakpoint resize and sticky release. A static mobile gallery is valid when recorded and complete. Save observed results, screenshots and fixes in VALIDATION.md; never claim a screenshot was inspected merely because it exists. Run common QA and require helper-generated BUILD-RESULT.json to pass. For selected scroll video use --require-scroll-video in local and public QA. Use the tested $deploy and $demo-pi skills to publish one passing concept under demo.alshival.dev, then independently verify HTTPS, identity, assets and selected interactions under the actual CSP. Preserve concept disclosure, noindex and non-submitting forms.\n\nKeep all work under projects/<business-slug>. Before choosing or resuming a prospect, inspect workspace-wide candidate inventory, project build/release records and demo-pi deployment inventory. Exclude already built/published identities, Place IDs and hostnames across all automations and cities. Release evidence takes precedence over stale scratch/checkpoints. Resume genuinely unfinished work with its identity and hostname preserved; never count an already successful release as a new result or rewrite it without an explicit revision request. Clear the active-project scratch pointer after successful completion. Retain editable source and reproducible build instructions outside the published site folder.\n\nHold one exclusive process lock for the entire workflow and skip overlapping runs. Preserve state on blocked truth/media/build/release gates and report failure honestly. Do not contact prospects, send fixed-recipient messages, import another tenant's credentials/state, or change schedules, models or subscriptions.\n\nUse get_automation_notification_context with AUTOMATION_ID, retain job.currentRunId, and stage the truthful result with notify_workspace_user targeting this automation and run. Subscriber settings determine recipients/channels. Never claim queued notifications are delivered.\n\nReturn the selected business, art direction, template, implemented effects and observed QA, verified public URL and release identity, project-relative source/validation paths, media origin/replacement needs, factual limitations and notification staging result. Editing this automation does not itself request a new website run.";
const definition={name,description:'One evidence-led Alamo prospect concept, cinematic AUTO design, verified demo-pi release and subscriber notifications.',enabled:false,deleteAfterRun:false,agentId:'main',schedule:{kind:'cron',expr:'0 8-16/2 * * 6,0',tz:'America/Chicago'},sessionTarget:'isolated',wakeMode:'now',payload:{kind:'agentTurn',message,model:'openai/gpt-5.6-sol',thinking:'xhigh',timeoutSeconds:10800,lightContext:false},delivery:{mode:'none'}};
const created=existing[0]??await request('cron.add',definition);
const id=created.id??created.job?.id;
if(!id)throw Error('Scheduler did not return a job ID');
await request('cron.update',{id,patch:{...definition,payload:{...definition.payload,message:message.replace('AUTOMATION_ID',id)}}});
await mkdir(`${workspace}/.neural-labs`,{recursive:true,mode:0o700});
await writeFile(`${workspace}/.neural-labs/prospect-automation.json`,JSON.stringify({id,name,schedule:definition.schedule,enabled:false,installedAt:new Date().toISOString(),skillBackup:backups},null,2),{mode:0o600});
console.log(JSON.stringify({id,name,enabled:false,schedule:definition.schedule,skillBackup:backups}));
