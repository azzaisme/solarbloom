import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
const server=await preview({preview:{port:4204,strictPort:true},logLevel:'silent'});
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:4204/');
 await page.waitForFunction(()=>!!window.solarbloom,{},{timeout:90000});
 await page.evaluate(()=>{window.solarbloom.app.autoRender=false;window.solarbloom.paused=true;document.querySelector('#intro').hidden=true;});
 const assets=await page.evaluate(()=>window.solarbloom.app.assets.list().filter(a=>a.type==='container'&&a.loaded).map(a=>a.name));
 assert.equal(assets.length,10,'All original glTF assets load');
 const missing=await page.evaluate(()=>{
   const names={solar:['panel-pivot','status-light'],condenser:['water-orb','bubbles','status-light'],pollinator:['flower-0','flower-8'],droneHub:['dock-ring','status-light'],drone:['wing-left','wing-right','eye-left','eye-right'],motherTree:['canopy'],relay:['relay-vanes','status-light'],reservoirGarden:['status-light'],fountain:['fountain'],coreArch:['coreArch']};
   const issues=[];
   for(const [name,pivots] of Object.entries(names)){
     const asset=window.solarbloom.app.assets.find(name,'container');
     const root=asset.resource.instantiateRenderEntity();
     for(const pivot of pivots)if(!root.findByName(pivot))issues.push(`${name}/${pivot}`);
     if(!root.findComponents('render').length)issues.push(`${name}: no render mesh`);
     root.destroy();
   }
   return issues;
 });
 assert.deepEqual(missing,[],'Every model instantiates with its animation pivots');
 const animation=await page.evaluate(()=>{
   const g=window.solarbloom,solar=g.sim.state.machines.find(m=>m.type==='solar');
   const pivot=g.machines.view(solar.id).spin[0];
   const state=JSON.stringify(g.sim.state);
   const a=pivot.getLocalEulerAngles().clone();
   g.machines.update(.5);
   const moved=!a.equals(pivot.getLocalEulerAngles());
   g.machines.reducedMotion=true;
   const b=pivot.getLocalEulerAngles().clone();
   g.machines.update(.5);
   const still=b.equals(pivot.getLocalEulerAngles());
   g.machines.reducedMotion=false;
   return {moved,still,stateUnchanged:state===JSON.stringify(g.sim.state)};
 });
 assert.deepEqual(animation,{moved:true,still:true,stateUnchanged:true});
 console.log('Solar model animates, reduced motion holds the pivot, and visual updates do not mutate simulation state.');
 for(const [width,height] of [[320,640],[360,740],[390,844],[430,932],[844,390],[820,1180],[1280,800]]){
  await page.setViewportSize({width,height});
  await page.waitForTimeout(200);
  const issues=await page.evaluate(()=>{
   const names=['#res','#obj','#hotbar','#hint'],rects=[];
   for(const sel of names){const e=document.querySelector(sel),s=getComputedStyle(e);if(e.hidden||s.display==='none'||s.visibility==='hidden'||+s.opacity===0||e.classList.contains('hide'))continue;const r=e.getBoundingClientRect();rects.push({sel,l:r.left,r:r.right,t:r.top,b:r.bottom});}
   const issues=[];
   for(const a of rects)if(a.l<0||a.r>innerWidth+1||a.t<0||a.b>innerHeight+1)issues.push(`${a.sel} outside viewport`);
   for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.r,b.r)-Math.max(a.l,b.l)>1&&Math.min(a.b,b.b)-Math.max(a.t,b.t)>1)issues.push(`${a.sel} overlaps ${b.sel}`);}
   return issues;
  });
  assert.deepEqual(issues,[],`HUD ${width}x${height}`);
  assert.equal(await page.locator('#upgrades').isVisible(),false,`Closed drawer hidden at ${width}`);
  await page.click('#buildToggle');
  await page.waitForTimeout(300);
  const tray=await page.evaluate(()=>{const e=document.querySelector('#buildTray'),r=e.getBoundingClientRect();return {open:e.classList.contains('open'),l:r.left,t:r.top,r:r.right,b:r.bottom};});
  assert.ok(tray.open&&tray.l>=-1&&tray.t>=-1&&tray.r<=width+1&&tray.b<=height+1,`Build tray ${width}: ${JSON.stringify(tray)}`);
  await page.click('#buildToggle');
  console.log(`HUD and build tray fit ${width}x${height}`);
 }
 await page.click('#setBtn');
 await page.locator('[data-set="reducedMotion"]').check();
 assert.equal(await page.evaluate(()=>window.solarbloom.machines.reducedMotion&&window.solarbloom.drones.reducedMotion),true);
 await page.click('#closeModal');
 await page.click('#upgBtn');
 assert.equal(await page.locator('#upgrades').evaluate(e=>e.classList.contains('open')),true);
 await page.click('#upgrades h2 button');
 await page.click('[data-tool="pulse"]');
 assert.equal(await page.locator('[data-tool="pulse"]').evaluate(e=>e.classList.contains('active')),true);
 console.log('Settings, reduced motion, upgrades, and tool selection work.');
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.httpServer.close();}
