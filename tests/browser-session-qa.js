async (page) => {
  await page.goto('http://127.0.0.1:5173');
  const backup = await page.evaluate(() => Object.fromEntries(['arena-ear:v1:references','arena-ear:v1:settings','arena-ear:v1:history','arena.map'].map(key=>[key,localStorage.getItem(key)])));
  await page.evaluate(async () => {
    const { createReference, encodeWav } = await import('/src/lib/audio.ts');
    const samples = Float32Array.from({length:24000}, (_, i) => .2 * Math.sin(2 * Math.PI * 440 * i / 48000));
    const reference = await createReference(encodeWav(samples, 48000), 'QA session 440', 'rare');
    localStorage.setItem('arena-ear:v1:references', JSON.stringify([reference]));
    localStorage.setItem('arena-ear:v1:settings', JSON.stringify({autoScan:false}));
  });
  await page.reload();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  try {
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d');
      const paint = () => { ctx.fillStyle='#222'; ctx.fillRect(0,0,640,360); ctx.strokeStyle='#888'; for(let x=0;x<640;x+=64)ctx.strokeRect(x,0,64,360); };
      paint();
      const context = new AudioContext(); await context.resume();
      const oscillator=context.createOscillator(); oscillator.frequency.value=440;
      const gain=context.createGain(); gain.gain.value=0;
      const destination=context.createMediaStreamDestination();
      oscillator.connect(gain); gain.connect(destination); oscillator.start();
      const source = canvas.captureStream(10);
      source.addTrack(destination.stream.getAudioTracks()[0]);
      window.__arenaQA = {source, gain, context, oscillator, timer:setInterval(paint,100)};
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>source});
    });
    await page.getByRole('button',{name:'Слушать игру',exact:true}).first().click();
    await page.getByRole('button',{name:'Остановить захват',exact:true}).waitFor();
    await page.getByRole('button',{name:'Выбрать ячейку cell-0-0',exact:true}).click();
    await page.evaluate(()=>window.__arenaQA.gain.gain.value=.2);
    await page.getByRole('heading',{name:'QA session 440',exact:true}).waitFor();
    const assigned=await page.locator('.slot.rare').count();
    assert(assigned===1,'Live result was not assigned exactly once');
    const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('arena-ear:v1:history')));
    assert(history[0].demo===false && history[0].cellId==='cell-0-0','Live history has wrong cell or demo marker');
    await page.getByRole('button',{name:'Показать превью захвата',exact:true}).click();
    const initialPreview=await page.locator('.video-preview video').evaluate(v=>!!v.srcObject);
    await page.getByRole('button',{name:'Выделить область торговца',exact:true}).click();
    const bounds=await page.locator('[aria-label="Выделение области торговца"]').boundingBox();
    assert(bounds && bounds.width > 0 && bounds.height > 0, 'Preview has no selectable video area');
    await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height*.2);
    await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.8,bounds.y+bounds.height*.8,{steps:5});
    await page.mouse.up();
    const region=await page.evaluate(()=>JSON.parse(localStorage.getItem('arena-ear:v1:settings')).region);
    assert(Math.abs(region.x-.2)<.02 && Math.abs(region.width-.6)<.02, 'Drag crop not normalized/saved');
    await page.getByRole('button',{name:/Библиотека звуков/}).click();
    await page.getByRole('button',{name:'Анализ груза',exact:true}).click();
    const restoredPreview=await page.locator('.video-preview video').evaluate(v=>!!v.srcObject);
    assert(initialPreview&&restoredPreview,'Preview source lost on navigation');
    await page.getByRole('button',{name:'Остановить захват',exact:true}).click();
    const tracksStopped=await page.evaluate(()=>window.__arenaQA.source.getTracks().every(t=>t.readyState==='ended'));
    assert(tracksStopped,'Stop left captured tracks alive');
    await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{throw new DOMException('Denied by QA','NotAllowedError')}}));
    await page.getByRole('button',{name:'Слушать игру',exact:true}).first().click();
    await page.getByRole('alert').waitFor();
    assert((await page.getByRole('alert').innerText()).includes('не предоставлен'),'Permission denial not explained');
    await page.getByRole('button',{name:'Закрыть ошибку'}).click();
    await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:()=>new Promise(resolve=>window.__arenaQA.resolve=resolve)}));
    await page.getByRole('button',{name:'Слушать игру',exact:true}).first().click();
    await page.getByRole('button',{name:'Демо интерфейса',exact:true}).click();
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=10;c.height=10;c.getContext('2d').fillRect(0,0,10,10);
      const s=c.captureStream();window.__arenaQA.late=s;window.__arenaQA.resolve(s);
    });
    await page.waitForTimeout(100);
    assert(await page.getByText('ДЕМО ИНТЕРФЕЙСА',{exact:true}).isVisible(),'Late capture replaced demo');
    const lateStopped=await page.evaluate(()=>window.__arenaQA.late.getTracks().every(t=>t.readyState==='ended'));
    assert(lateStopped,'Cancelled chooser leaked late stream');
    return {passed:true,liveAssignedCells:assigned,realHistory:true,previewRestored:restoredPreview,dragRegion:region,tracksStopped,denialHandled:true,cancelledChooserStopped:lateStopped};
  } finally {
    await page.evaluate(async()=>{const q=window.__arenaQA;if(!q)return;clearInterval(q.timer);q.source.getTracks().forEach(t=>t.stop());q.late?.getTracks().forEach(t=>t.stop());q.oscillator.stop();await q.context.close();delete window.__arenaQA;});
    await page.evaluate(backup=>{for(const [key,value] of Object.entries(backup)) {if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}},backup);
    await page.reload();
  }
}
