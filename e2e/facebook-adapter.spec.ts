import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const groupUrl = "https://www.facebook.com/groups/adapter-test/";
const job = { jobId: "test-job", expectedGroupUrl: groupUrl, caption: "Reviewed caption", linkUrl: "https://example.test/" };

async function setup(page: Page, html: string) {
  await page.route("https://www.facebook.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.goto(groupUrl);
  await page.evaluate(() => {
    const runtime = window as unknown as { chrome: unknown; adapterListener?: unknown; finalPostClicks: number };
    runtime.chrome = { runtime: { onMessage: { addListener: (handler: unknown) => { runtime.adapterListener = handler; } } } };
    runtime.finalPostClicks = 0;
    document.querySelectorAll("button.post").forEach((button) => button.addEventListener("click", () => runtime.finalPostClicks++));
  });
  await page.addScriptTag({ content: await readFile("extension/dist/content.js", "utf8") });
}

async function send(page: Page, message: Record<string, unknown>) {
  return page.evaluate((payload) => new Promise<{ ok: boolean; clicked?: boolean; reason?: string; message?: string; outcome?: string }>((resolve) => {
    const runtime = window as unknown as { adapterListener: (message: unknown, sender: unknown, reply: (value: { ok: boolean; clicked?: boolean; reason?: string; message?: string; outcome?: string }) => void) => void };
    runtime.adapterListener(payload, {}, resolve);
  }), message);
}

for (const scenario of ["composer", "missing", "verification"] as const) {
  test(`Facebook adapter: ${scenario}`, async ({ page }) => {
    await setup(page, scenario === "composer" ? '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>' : scenario === "verification" ? '<input name="pass" type="password" value="private-facebook-password">' : '<p>No composer available</p>');
    const result = await send(page, { type: "PREPARE_CAPTION", ...job });
    if (scenario === "composer") {
      expect(result.ok).toBe(true);
      await expect(page.getByRole("textbox")).toHaveText("Reviewed caption\n\nhttps://example.test/", { useInnerText: true });
      expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
    } else if (scenario === "missing") expect(result.reason).toBe("COMPOSER_NOT_FOUND");
    else { expect(result.reason).toBe("VERIFICATION_REQUIRED"); expect(JSON.stringify(result)).not.toContain("private-facebook-password"); }
  });
}

for (const label of ["Post", "Đăng"]) {
  test(`explicit publish fills and clicks the scoped ${label} button once`, async ({ page }) => {
    await setup(page, `<button class="post">Post</button><div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">${label}</button></div>`);
    const first = await send(page, { type: "PUBLISH_POST", ...job });
    expect(first).toMatchObject({ ok: true, clicked: true });
    expect((await send(page, { type: "PUBLISH_POST", ...job })).reason).toBe("ALREADY_SUBMITTED");
    expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(1);
  });
}

for (const scenario of ["disabled", "ambiguous", "wrong-group"] as const) {
  test(`publishing refuses ${scenario}`, async ({ page }) => {
    await setup(page, `<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post" ${scenario === "disabled" ? 'aria-disabled="true"' : ""}>Post</button>${scenario === "ambiguous" ? '<button class="post">Đăng</button>' : ""}</div>`);
    const result = await send(page, { type: "PUBLISH_POST", ...job, ...(scenario === "wrong-group" ? { expectedGroupUrl: "https://www.facebook.com/groups/other/" } : {}) });
    expect(result).toMatchObject({ ok: false, clicked: false });
    expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
  });
}

test("publishing preserves edits made after preparing", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  await send(page, { type: "PREPARE_CAPTION", ...job });
  await page.getByRole("textbox").fill("My revised caption");
  expect((await send(page, { type: "PUBLISH_POST", ...job })).ok).toBe(true);
  await expect(page.getByRole("textbox")).toHaveText("My revised caption");
});

test("prepare opens an identifiable composer without posting", async ({ page }) => {
  await setup(page, '<button id="compose">Write something...</button>');
  await page.evaluate(() => document.getElementById("compose")!.onclick = () => {
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
    dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button class="post">Post</button>';
    document.body.append(dialog);
  });
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  await expect(page.getByRole("textbox")).toContainText("Reviewed caption");
});


test("automatic image attachment waits for a preview and verifies publication", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/*" multiple><button class="post" disabled>Post</button></div>');
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    input.onchange = () => {
      document.body.dataset.files = [...input.files!].map((file) => file.name).join(",");
      const image = document.createElement("img"); image.src = URL.createObjectURL(input.files![0]); image.width = 20; image.height = 20;
      input.parentElement!.append(image);
      document.querySelector<HTMLButtonElement>("button.post")!.disabled = false;
    };
    document.querySelector<HTMLButtonElement>("button.post")!.onclick = () => {
      const notice = document.createElement("div"); notice.setAttribute("role", "status"); notice.textContent = "Your post was published."; document.body.append(notice);
    };
  });
  const attachments = [{ id: "image-1", filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=" }];
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, attachments })).ok).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-files", "pixel.png");
  expect((await send(page, { type: "PUBLISH_POST", ...job, trackOutcome: true })).outcome).toBe("published");
});

test("automatic submission distinguishes group approval from publication", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  await page.evaluate(() => { document.querySelector<HTMLElement>("button.post")!.onclick = () => {
    const notice = document.createElement("div"); notice.setAttribute("role", "alert"); notice.textContent = "Your post was submitted for approval."; document.body.append(notice);
  }; });
  expect((await send(page, { type: "PUBLISH_POST", ...job, trackOutcome: true })).outcome).toBe("approval");
});

test("stop cancels verification of an uncertain submission without clicking again", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  const pending = send(page, { type: "PUBLISH_POST", ...job, trackOutcome: true });
  await expect.poll(() => page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(1);
  await send(page, { type: "CANCEL_JOB", jobId: job.jobId });
  expect((await pending).outcome).toBe("unknown");
  expect((await send(page, { type: "PUBLISH_POST", ...job })).ok).toBe(false);
});

test("localized composer trigger opens a post editor even when a comment textbox exists", async ({ page }) => {
  await setup(page, '<div role="textbox" contenteditable="true">Comment field</div><button id="compose" aria-label="Bạn viết gì đi, Vinh?">Compose</button>');
  await page.evaluate(() => {
    document.getElementById("compose")!.onclick = () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button class="post">Đăng</button>';
      document.body.append(dialog);
    };
  });
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  await expect(page.locator("[role='dialog'] [role='textbox']")).toContainText("Reviewed caption");
  await expect(page.locator("body > [role='textbox']")).toHaveText("Comment field");
});

test("ambiguous composer entry points do not trigger accidental clicks", async ({ page }) => {
  await setup(page, '<button aria-label="Write something...">A</button><button aria-label="Write something...">B</button>');
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).reason).toBe("COMPOSER_NOT_FOUND");
});


test("screenshot-like group page: use inline composer, attach image and publish only once", async ({ page }) => {
  await setup(page,
    '<div role="textbox" contenteditable="true" id="comment">Bình luận dưới tên Mì</div>' +
    '<section id="feed"><div id="inline" role="button"><span>Bạn viết gì đi....</span></div></section>' +
    '<aside><button id="sidebar">Tạo bài viết</button></aside>'
  );
  await page.evaluate(() => {
    document.getElementById("sidebar")!.onclick = () => { document.body.dataset.sidebarClicked = "yes"; };
    document.getElementById("inline")!.onclick = () => {
      document.body.dataset.inlineClicked = "yes";
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button id="photo">Ảnh/video</button><button id="post" disabled>Đăng</button>';
      document.body.append(dialog);
      dialog.querySelector<HTMLButtonElement>("#photo")!.onclick = () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*"; input.multiple = true;
        input.onchange = () => {
          document.body.dataset.uploaded = input.files?.[0]?.name ?? "";
          const preview = document.createElement("img");
          preview.src = URL.createObjectURL(input.files![0]); preview.width = 30; preview.height = 30;
          dialog.append(preview);
          dialog.querySelector<HTMLButtonElement>("#post")!.disabled = false;
        };
        dialog.append(input);
      };
      dialog.querySelector<HTMLButtonElement>("#post")!.onclick = () => {
        document.body.dataset.posted = "true";
        const notice = document.createElement("div");
        notice.setAttribute("role", "status");
        notice.textContent = "Your post was published.";
        document.body.append(notice);
      };
    };
  });
  const attachments = [{
    id: "image-2", filename: "sample.png", mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII="
  }];
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, attachments })).ok).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-inline-clicked", "yes");
  await expect(page.locator("body")).not.toHaveAttribute("data-sidebar-clicked", "yes");
  await expect(page.locator("body")).toHaveAttribute("data-uploaded", "sample.png");
  await expect(page.locator("#comment")).toHaveText("Bình luận dưới tên Mì");
  await expect(page.locator("[role='dialog'] [role='textbox']")).toContainText("Reviewed caption");
  const result = await send(page, { type: "PUBLISH_POST", ...job, trackOutcome: true });
  expect(result).toMatchObject({ ok: true, clicked: true, outcome: "published" });
  await expect(page.locator("body")).toHaveAttribute("data-posted", "true");
  expect((await send(page, { type: "PUBLISH_POST", ...job })).reason).toBe("ALREADY_SUBMITTED");
});

test("English Write something is preferred over the sidebar Create post", async ({ page }) => {
  await setup(page, '<button id="inline">Write something...</button><button id="sidebar">Create post</button>');
  await page.evaluate(() => {
    document.getElementById("sidebar")!.onclick = () => { document.body.dataset.sidebarClicked = "yes"; };
    document.getElementById("inline")!.onclick = () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button>Post</button>';
      document.body.append(dialog);
    };
  });
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  await expect(page.locator("[role='dialog'] [role='textbox']")).toContainText("Reviewed caption");
  await expect(page.locator("body")).not.toHaveAttribute("data-sidebar-clicked", "yes");
});

test("inline composer fallback recognizes text without an interactive role", async ({ page }) => {
  await setup(page, '<div id="feed"><div id="launcher"><span>Bạn viết gì đi....</span></div></div><button id="sidebar">Tạo bài viết</button>');
  await page.evaluate(() => {
    document.getElementById("launcher")!.onclick = () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button>Đăng</button>';
      document.body.append(dialog);
    };
  });
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  await expect(page.locator("[role='dialog'] [role='textbox']")).toContainText("Reviewed caption");
});


test("a group comment form is not a post composer", async ({ page }) => {
  await setup(page, '<form id="comment-form"><div role="textbox" contenteditable="true">Bình luận</div></form>');
  const result = await send(page, { type: "PREPARE_CAPTION", ...job });
  expect(result).toMatchObject({ ok: false, clicked: false, reason: "COMPOSER_NOT_FOUND" });
  await expect(page.locator("#comment-form [role='textbox']")).toHaveText("Bình luận");
});

test("image picker inserted outside the dialog is accepted only after Photo/video is opened", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button id="photo">Ảnh/video</button><button id="post" disabled>Đăng</button></div>');
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
    dialog.querySelector<HTMLButtonElement>("#photo")!.onclick = () => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/png";
      picker.onchange = () => {
        document.body.dataset.uploaded = picker.files?.[0]?.name ?? "";
        const image = document.createElement("img"); image.src = URL.createObjectURL(picker.files![0]);
        image.width = 30; image.height = 30;
        dialog.append(image);
        dialog.querySelector<HTMLButtonElement>("#post")!.disabled = false;
      };
      document.body.append(picker);
    };
  });
  const attachments = [{
    id: "portal-image", filename: "portal.png", mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII="
  }];
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, attachments })).ok).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-uploaded", "portal.png");
});
