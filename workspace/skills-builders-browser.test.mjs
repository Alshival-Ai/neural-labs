import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const origin = process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4199";
test("skills and automation builders, resizable lists, tooltips, compact layouts and larger text", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 90000 }, async () => {
 const require = createRequire(import.meta.url);
 const browser = await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({ headless: true });
 try {
 const errors=[];
 for(const width of [1200,850,640,390]) {
  for(const mode of ['library','skill','automation']) {
   const page=await browser.newPage({viewport:{width,height:900}});
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${origin}/workspace/tests/skills-builders.html${mode==='library'?'':`?kind=${mode}&edit`}`);
   await page.getByRole('button',{name:mode==='library'?'New skill':'Publish changes',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${mode} ${width} page overflow`);
   if(mode==='library') {
    const title='Customer handoff and follow-up instructions for the entire support team';
    await page.getByRole('button',{name:title,exact:true}).hover();
    assert.equal(await page.getByRole('tooltip').innerText(),title);
    await page.keyboard.press('Escape');
    if(width>650) {
     const divider=page.getByRole('separator',{name:'Resize list'});
     const rect=await divider.boundingBox();
     const before=Number(await divider.getAttribute('aria-valuenow'));
     await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
     await page.mouse.down(); await page.mouse.move(rect.x+rect.width/2+60,rect.y+rect.height/2,{steps:8});await page.mouse.up();
     assert.equal(Number(await divider.getAttribute('aria-valuenow')), Math.min(before + 60, Number(await divider.getAttribute('aria-valuemax'))));
     await divider.focus();await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'200');
     await page.reload();await divider.waitFor();assert.equal(await divider.getAttribute('aria-valuenow'),'200');
    } else {
     assert.equal(await page.getByRole('separator').isVisible(),false);
     await page.getByRole('button',{name:title,exact:true}).click();
     await page.getByRole('button',{name:'Back to skill library'}).click();
    }
    await page.getByRole('button',{name:'Automations',exact:true}).click();
    await page.getByRole('button',{name:'New automation',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width<=720) {
     await page.getByRole('button',{name:'Morning team brief',exact:true}).click();
     await page.getByRole('button',{name:'Back to automations'}).click();
    }
   } else if(mode==='skill') {
    const instructions=page.getByRole('textbox',{name:'Instructions for Neura'});
    await instructions.fill('# UI verification\n\nKeep links.');
    await page.getByRole('button',{name:'source',exact:true}).click();
    await page.getByRole('button',{name:'SKILL.md',exact:true}).waitFor({state:'visible'});
    assert.match(await page.locator('.builder-source textarea').inputValue(),/# UI verification/);
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator('summary').filter({hasText:'Appearance'}).click();
    await page.getByRole('textbox',{name:'Display name',exact:true}).fill('Edited display name');
   } else {
    await page.getByRole('combobox',{name:'Schedule type'}).selectOption('every');
    await page.getByRole('textbox',{name:'Repeat interval'}).fill('30m');
    await page.getByRole('combobox',{name:'Send results'}).selectOption('webhook');
    await page.getByRole('textbox',{name:'Webhook URL'}).fill('https://example.org/results');
    await page.locator('summary').filter({hasText:'Advanced'}).click();
    await page.getByRole('textbox',{name:'Timeout (seconds)'}).fill('300');
   }
   await page.close();
  }
 }
 for(const kind of ['skill','automation']) {
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.goto(`${origin}/workspace/tests/skills-builders.html?kind=${kind}&large`);
  await page.getByRole('button',{name:'Publish',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();
 }
 assert.deepEqual(errors, []);
 } finally { await browser.close(); }
});
