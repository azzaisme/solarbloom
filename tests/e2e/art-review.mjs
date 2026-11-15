// Matched art-review frames. ART_BUILD can point at an untouched production build.
// Game-state setup is confined to this harness; it does not ship with the game.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';
const out = process.env.SHOTS_DIR ?? 'docs/review/lush-after';
mkdirSync(out, { recursive: true });
const port=Number(process.env.ART_PORT ?? 4203);
const server = await preview({ build: { outDir: process.env.ART_BUILD ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const errors=[];
try {
  for (const [name,width,height] of [['desktop',1280,800],['phone',390,844]].filter(([name])=>!process.env.ART_VIEWPORT||name===process.env.ART_VIEWPORT)) {
    console.log('Opening',name);
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
    // Keep presentation random sources identical for before/after shots.
    await page.addInitScript(()=>{let s=321;Math.random=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);});
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(()=>!!window.solarbloom,{},{timeout:90000});
    console.log('Loaded',name);
    await page.evaluate(()=>{
      const g=window.solarbloom;
      g.paused=true;
      g.app.autoRender=false;
      g.app.graphicsDevice.maxPixelRatio=1;
      document.querySelector('#intro').hidden=true;
      g.settings.hints=false;
    });
    await page.addStyleTag({content:'#toasts,#hint {display:none!important}'});
    const shot=async(label,x,z,zoom)=>{
      await page.evaluate(({x,z,zoom})=>{
        const g=window.solarbloom;g.camera.glide(x,0,z,zoom);
        for(let i=0;i<240;i++) g.camera.update(.05);
      },{x,z,zoom});
      await page.waitForTimeout(1500);
      await page.evaluate(()=>{window.solarbloom.app.renderNextFrame=true;});
      await page.waitForTimeout(700);
      await page.screenshot({path:`${out}/${name}-${label}.png`,timeout:90000});
      console.log('Captured',name,label);
    };
    await shot('fresh',8,8,name==='phone'?.75:.95);
    await page.evaluate(()=>{
      const g=window.solarbloom,s=g.sim;
      for(const t of s.areas.tiles('park')) {
        if(!s.restoration.isEligible(t)&&t.ground!=='restored')continue;
        if(t.ground!=='restored')s.restoration.complete(t,'pulse');
        t.bloom=t.variant%4===0?4:3;s.grid.touch(t);
      }
      s.production.markDirty();
    });
    await shot('garden',8,8,name==='phone'?.75:.95);
    if(name==='desktop'){
      const spot=await page.evaluate(()=>{
        const g=window.solarbloom,s=g.sim,B=s.state.resources.energy.constructor;
        s.state.resources.energy=new B(1e6);s.state.resources.water=new B(1e6);s.state.resources.biomass=new B(1e6);
        s.state.caps.energy=new B(1e6);s.state.caps.water=new B(1e6);
        s.state.progression.coreActivated=true;s.areas.clear('park',true);
        const tiles=s.areas.tiles('park').sort((a,b)=>Math.abs(a.z-8)-Math.abs(b.z-8)||a.x-b.x),at=[];
        for(const type of ['solar','condenser','pollinator','droneHub','motherTree','relay']){
          const t=tiles.find(t=>s.build.check(type,'g',t.x,t.z).ok);
          if(t&&s.build.place(type,'g',t.x,t.z))at.push(t);
        }
        const close=at.slice(0,3);
        return {x:at.reduce((a,t)=>a+t.x,0)/at.length+.5,z:at.reduce((a,t)=>a+t.z,0)/at.length+.5,closeX:close.reduce((a,t)=>a+t.x,0)/close.length+.5,closeZ:close.reduce((a,t)=>a+t.z,0)/close.length+.5};
      });
      await shot('models',spot.x,spot.z,1.7);
      await page.evaluate(()=>{
        document.querySelector('#hud').style.display='none';
        window.solarbloom.camera.maxZoom=3.2;
      });
      await shot('closeup',spot.closeX,spot.closeZ,2.8);
      if(process.env.ART_ANIMATE){
        mkdirSync(`${out}/frames`,{recursive:true});
        await page.setViewportSize({width:800,height:500});
        await page.evaluate(()=>{window.solarbloom.app.off('update');window.solarbloom.camera.update(0);});
        for(let i=0;i<24;i++){
          await page.evaluate(()=>{const g=window.solarbloom;g.machines.update(.15);g.drones.update(.15);g.grid.update(.15);g.app.renderNextFrame=true;});
          await page.waitForTimeout(120);
          await page.screenshot({path:`${out}/frames/${String(i).padStart(3,'0')}.png`,timeout:90000});
        }
        console.log('Captured 24 machinery animation frames');
      }
    }
    await page.close();
  }
}finally{await browser.close();server.httpServer.close();}
if(errors.length)throw new Error(errors.join('\n'));
console.log('Matched art frames captured with no browser errors.');
