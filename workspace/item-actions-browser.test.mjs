import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('skill and automation menus fit desktop/mobile and confirm deletion',{skip:!process.env.PLAYWRIGHT_MODULE_PATH,timeout:60000},async()=>{
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);const browser=await chromium.launch({headless:true});
 try {for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});await page.goto((process.env.ITEM_ACTIONS_TEST_ORIGIN||'http://127.0.0.1:4197')+'/workspace/tests/item-actions.html');
  await page.getByRole('button',{name:'Actions for Customer handoff',exact:true}).click();
  const menu=page.getByRole('menu');await menu.waitFor();const box=await menu.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
  await page.screenshot({path:path.join(tmpdir(),`item-actions-menu-${viewport.width}.png`)});
  await page.getByRole('menuitem',{name:'Delete',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:path.join(tmpdir(),`item-actions-dialog-${viewport.width}.png`)});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-action'),null);
  await page.getByRole('button',{name:'Actions for Customer handoff',exact:true}).click();await page.getByRole('menuitem',{name:'Duplicate',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.action==='duplicate');
  await page.getByRole('button',{name:/^Automations/}).click();await page.getByRole('button',{name:'Actions for Morning team brief',exact:true}).first().click();assert.equal(await page.getByRole('menuitem',{name:'Duplicate',exact:true}).isEnabled(),true);await page.getByRole('menuitem',{name:'Delete',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.action==='delete-automation');
  await page.close();
 }}finally{await browser.close();}
});

test('subscription dialog stays above navigation and saves at narrow and short viewports',{skip:!process.env.PLAYWRIGHT_MODULE_PATH,timeout:60000},async()=>{
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);const browser=await chromium.launch({headless:true});
 try {for(const viewport of [{width:320,height:568},{width:390,height:844},{width:568,height:320},{width:1440,height:900}]){
  const page=await browser.newPage({viewport});let subscription=null;const writes=[];
  await page.route('**/api/session',route=>route.fulfill({json:{csrfToken:'synthetic-csrf'}}));
  await page.route('**/api/automations/*/subscription',async route=>{
   if(route.request().method()==='PUT'){const value=route.request().postDataJSON();writes.push(value);subscription=value.events.length?value:null;}
   await route.fulfill({json:{preferences:{neura:true,email:true,sms:false,emailAvailable:true,defaults:['neura']},subscription}});
  });
  await page.goto((process.env.ITEM_ACTIONS_TEST_ORIGIN||'http://127.0.0.1:4197')+'/workspace/tests/item-actions.html');
  await page.getByRole('button',{name:/^Automations/}).click();
  await page.getByRole('button',{name:'Actions for Morning team brief',exact:true}).first().click();await page.getByRole('menuitem',{name:'Manage subscription',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'My notifications'});await dialog.getByLabel('Email',{exact:true}).waitFor();
  const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
  assert.equal(await dialog.evaluate(el=>el.matches(':modal')),true,'native top-layer dialog');
  await dialog.getByLabel('Email',{exact:true}).check();const save=dialog.getByRole('button',{name:'Save subscription'});await save.scrollIntoViewIfNeeded();
  assert.equal(await save.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'navigation does not cover Save');
  await page.screenshot({path:path.join(tmpdir(),`subscription-mobile-${viewport.width}.png`)});
  await save.click();await dialog.waitFor({state:'detached'});assert.deepEqual(writes,[{events:['success','failure'],channels:['neura','email']}]);await page.screenshot({path:path.join(tmpdir(),`subscription-saved-${viewport.width}.png`)});
  await page.getByRole('button',{name:'Subscribed',exact:true}).click();await dialog.getByRole('button',{name:'Unsubscribe',exact:true}).click();await dialog.waitFor({state:'detached'});assert.deepEqual(writes[1],{events:[],channels:[]});
  await page.getByRole('button',{name:'Subscribe',exact:true}).click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Subscribe',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.close();
 }}finally{await browser.close();}
});
