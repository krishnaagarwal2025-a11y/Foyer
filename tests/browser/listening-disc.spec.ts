import { test, expect } from "@playwright/test";
test("listening vinyl and its center artwork rotate only during actual playback", async ({browser})=>{
 const c=await browser.newContext({viewport:{width:390,height:844}});
 const artwork="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8a4db0"/><path d="M0 0L64 64" stroke="#f4d5ff" stroke-width="12"/></svg>');
 await c.routeWebSocket("**/socket.io/**",socket=>{const server=socket.connectToServer();socket.onMessage(message=>server.send(message));server.onMessage(message=>{let text=String(message);const start=text.indexOf("[");if(start>=0){try{const data=JSON.parse(text.slice(start));const walk=(v:any)=>{if(!v||typeof v!=="object")return;if(v.media?.kind==="audio")v.media.artwork=artwork;Object.values(v).forEach(walk);};walk(data);text=text.slice(0,start)+JSON.stringify(data);}catch{}}socket.send(text);});});
 const page=await c.newPage();try{
 await page.goto("/");await page.getByLabel("Display name").fill("Record listener");await page.getByRole("button",{name:"♪ Listen",exact:true}).click();await page.getByRole("button",{name:"＋ Create a room"}).click();
 const disc=page.locator(".listening-disc");await expect(disc).toBeVisible();await expect(disc).toHaveCSS("border-radius","50%");await expect(disc).toHaveCSS("animation-play-state","paused");await expect(disc.locator("img")).toHaveAttribute("src",artwork);
 await page.getByRole("button",{name:"Play",exact:true}).click();await expect(disc).toHaveCSS("animation-play-state","running");const before=await disc.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(300);expect(await disc.evaluate(el=>getComputedStyle(el).transform)).not.toBe(before);
 await page.screenshot({path:"evidence/listening-disc-phone.png",fullPage:true});await page.getByRole("button",{name:"Pause",exact:true}).click();await expect(disc).toHaveCSS("animation-play-state","paused");
 const stopped=await disc.evaluate(el=>getComputedStyle(el).transform);await page.waitForTimeout(300);expect(await disc.evaluate(el=>getComputedStyle(el).transform)).toBe(stopped);
 await page.emulateMedia({reducedMotion:"reduce"});await expect(disc).toHaveCSS("animation-name","none");
 }finally{await c.close();}
});
