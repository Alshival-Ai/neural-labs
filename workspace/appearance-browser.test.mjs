import test from "node:test";
import { createRequire } from "node:module";
import assert from 'node:assert/strict';
test("desktop appearance persists per account, uploads and resets wallpaper, and retains touch controls", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60000 }, async () => {
const require = createRequire(import.meta.url);
const browser=await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({headless:true});
try {
 for (const [width,height,touch] of [[1280,900,false],[390,844,true]]) {
 const page=await browser.newPage({viewport:{width,height},hasTouch:touch});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.addInitScript(() => localStorage.setItem('neural-labs.native-selection.qa', JSON.stringify({connection:'fixture',model:'fixture'})));
 await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());
 let result={channels:[],users:[],models:[],connections:[]};
 if(url.pathname==='/api/session') result={authenticated:true,csrfToken:'qa',providers:['local'],user:{id:'qa',email:'qa@example.org',displayName:'QA',role:'user',status:'active'}};
 if(url.pathname==='/api/workspace') result={status:'ready'};
 if(url.pathname==='/api/auth/providers') result={local:{enabled:true},microsoft:{enabled:false}};
 if(url.pathname==='/api/runtime/connections') result={connections:[]};
 if(url.pathname==='/api/runtime/defaults') result={selection:null};
 if(url.pathname==='/api/runtime/request') {
   const session={key:'fixture-chat',sessionId:'fixture-chat',title:'New conversation',updatedAt:Date.now(),archived:false,active:false,visibility:'draft'};
   const operation=route.request().postDataJSON().operation;
   result=operation==='conversations.list'?{sessions:[session]}:operation==='conversations.create'?{session}:operation==='models.list'?{models:[]}:{events:[],cursor:0};
   if(operation==='events.read') await new Promise(resolve=>setTimeout(resolve,50));
 }
 await route.fulfill({json:result});
 });
 await page.goto((process.env.DESKTOP_TEST_ORIGIN || "http://127.0.0.1:4199") + "/workspace/");
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Dark',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.equal(await page.locator('.window-titlebar').evaluate(e=>getComputedStyle(e).height),touch?'40px':'32px');
 const colors=await page.locator('.settings-card').first().evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));
 assert.equal(colors.color, "rgb(236, 238, 245)");
 assert.equal(colors.background, "rgb(35, 38, 47)");
 await page.getByRole('button',{name:'Alshival',exact:true}).click();

 await page.locator('.alshival-widget .neura-main').waitFor();
 for (const selector of ['.neura-main', '.composer-row textarea']) {
   const chat = await page.locator(`.alshival-widget ${selector}`).evaluate(e => ({
     color: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor,
   }));
   assert.equal(chat.color, 'rgb(236, 238, 245)');
   assert.equal(chat.background, selector === '.neura-main' ? 'rgb(25, 28, 36)' : 'rgb(44, 48, 59)');
 }
 assert.equal(await page.locator('.alshival-widget').evaluate(e => getComputedStyle(e).colorScheme), 'dark');
 assert.ok(!(await page.locator('.neura-composer-area').evaluate(e => getComputedStyle(e).backgroundImage)).includes('246, 244, 239'));
 await page.screenshot({path:`/tmp/neural-labs-chat-dark-${width}.png`});
 await page.locator('.alshival-widget .window-close').click();
 await page.screenshot({path:`/tmp/neural-labs-dark-${width}.png`});
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.ok((await page.locator('.desktop-wallpaper img').getAttribute('src')).includes('dark'));
 await page.getByLabel('Custom wallpaper').setInputFiles(new URL("./desktop/public/assets/wallpaper-dark.webp", import.meta.url).pathname);
 await page.waitForFunction(()=>document.querySelector('.desktop-wallpaper img')?.getAttribute('src')?.startsWith('data:'));
 await page.reload(); await page.waitForFunction(()=>document.querySelector('.desktop-wallpaper img')?.getAttribute('src')?.startsWith('data:'));
 await page.getByRole('button',{name:'Use Neural Labs wallpaper'}).click();
 await page.getByRole('button',{name:'Light',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.getByRole('button',{name:'Alshival',exact:true}).click();
 await page.locator('.alshival-widget .neura-main').waitFor();
 assert.equal(await page.locator('.alshival-widget .neura-main').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 254, 249)');
 assert.equal(await page.locator('.alshival-widget textarea').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 254, 250)');
 assert.equal(await page.locator('.alshival-widget .window-controls button').first().evaluate(e => getComputedStyle(e).color), 'rgb(98, 99, 107)');
 await page.screenshot({path:`/tmp/neural-labs-light-${width}.png`});
 await page.close();
 }
 console.log('Desktop and touch theme, upload, reload, reset and titlebar checks passed');
} finally {await browser.close();}

});
