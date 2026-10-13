import { test, expect } from "@playwright/test";
test("Discover opens first and queue remove stays a functional square on phones", async ({page})=>{
 await page.goto("/");await page.getByLabel("Display name").fill("Discover host");await page.getByRole("button",{name:"＋ Create a room"}).click();
 await expect(page.locator(".video-message")).toHaveCount(0);
 const nav=page.getByRole("navigation",{name:"Room tools"});await expect(nav.locator("button")).toHaveText(["Discover","Room","People1"]);await expect(nav.getByRole("button",{name:"Discover",exact:true})).toHaveAttribute("aria-pressed","true");
 await page.locator(".movie").filter({hasText:"Cinema Color Journey"}).getByRole("button",{name:"＋ Queue"}).click();await nav.getByRole("button",{name:"Room",exact:true}).click();await page.getByRole("button",{name:"Queue 1",exact:true}).click();
 const remove=page.getByRole("button",{name:"Remove Cinema Color Journey"});for(const width of [920,320]){await page.setViewportSize({width,height:844});await expect(remove).toBeVisible();const r=await remove.boundingBox();expect(r!.width).toBe(44);expect(r!.height).toBe(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.screenshot({path:"evidence/compact-queue-remove.png",fullPage:true});await remove.click();await expect(remove).toHaveCount(0);await expect(page.getByRole("button",{name:"Queue",exact:true})).toBeVisible();
});
