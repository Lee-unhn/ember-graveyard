import { serve, openPage, sleep } from './tests/lib/browser.mjs';
const srv = await serve(); const url = `http://127.0.0.1:${srv.address().port}/index.html`;
const p = await openPage(url); await p.waitFor(`!document.querySelector('#go').disabled`);
const p2 = await openPage(url); await sleep(6000);
console.log(await p2.evaluate(`JSON.stringify({ready: document.readyState, three: typeof THREE, go: document.querySelector('#go')?.textContent, props: (()=>{try{return props.length}catch(e){return e.message}})(), atlas: (()=>{try{return !!atlas}catch(e){return e.message}})()})`));
await p.close(); await p2.close(); srv.close();
