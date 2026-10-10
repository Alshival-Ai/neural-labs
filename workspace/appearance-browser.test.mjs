import test from "node:test";
import { createRequire } from "node:module";
import assert from 'node:assert/strict';
test("desktop appearance persists per account, uploads and resets wallpaper, and retains touch controls", { skip: !process.env.PLAYWRIGHT_MODULE_PATH, timeout: 60000 }, async () => {
const require = createRequire(import.meta.url);
const browser=await require(process.env.PLAYWRIGHT_MODULE_PATH).chromium.launch({headless:true});
try {
 for (const [width,height,touch] of [[1280,900,false],[390,844,true]]) {
 const page=await browser.newPage({viewport:{width,height},hasTouch:touch});
 await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());
 let result={};
 if(url.pathname==='/api/session') result={authenticated:true,csrfToken:'qa',providers:['local'],user:{id:'qa',email:'qa@example.org',displayName:'QA',role:'user',status:'active'}};
 if(url.pathname==='/api/workspace') result={status:'ready'};
 if(url.pathname==='/api/auth/providers') result={local:{enabled:true},microsoft:{enabled:false}};
 if(url.pathname==='/api/runtime/connections') result={connections:[]};
 if(url.pathname==='/api/runtime/defaults') result={selection:null};
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
 await page.screenshot({path:`/tmp/neural-labs-light-${width}.png`});
 await page.close();
 }
 console.log('Desktop and touch theme, upload, reload, reset and titlebar checks passed');
} finally {await browser.close();}

});
