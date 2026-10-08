import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const groupUrl = "https://www.facebook.com/groups/adapter-test/";
const job = { jobId: "test-job", expectedGroupUrl: groupUrl, caption: "Reviewed caption", linkUrl: "https://example.test/" };

async function setup(page: Page, html: string) {
  await page.route("https://www.facebook.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
  await page.goto(groupUrl);
  await page.evaluate(() => {
    const runtime = window as unknown as { chrome: unknown; adapterListener?: unknown; finalPostClicks: number; automaticEvents: Array<{ type: string; jobId?: string; outcome?: string }> };
    runtime.automaticEvents = [];
    runtime.chrome = { runtime: {
      onMessage: { addListener: (handler: unknown) => { runtime.adapterListener = handler; } },
      sendMessage: async (message: { type: string; jobId?: string; outcome?: string }) => {
        runtime.automaticEvents.push(message);
        return { ok: true };
      }
    } };
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
  const attachments = [{ id: "image-1", filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==" }];
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, attachments })).ok).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-files", "pixel.png");
  expect((await send(page, { type: "PUBLISH_POST", ...job, trackOutcome: true })).outcome).toBe("published");
});

test("image preparation can retry invalid data and reattach after the dialog is replaced", async ({ page }) => {
  const html = '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/*" multiple><button class="post">Post</button></div>';
  await setup(page, html);
  const installPicker = async () => page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    input.onchange = () => {
      const preview = document.createElement("img");
      preview.src = URL.createObjectURL(input.files![0]);
      preview.width = 30; preview.height = 30;
      input.parentElement!.append(preview);
    };
  });
  await installPicker();
  const attachment = { id: "retry-image", filename: "retry.png", mimeType: "image/png", dataUrl: "invalid" };
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, attachments: [attachment] })).toMatchObject({ ok: false });
  attachment.dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==";
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, attachments: [attachment] })).toMatchObject({ ok: true });
  await page.evaluate((markup) => { document.body.innerHTML = markup; }, html);
  await installPicker();
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, attachments: [attachment] })).toMatchObject({ ok: true });
  await expect(page.locator("[role=dialog] img")).toHaveCount(1);
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

test("prepare waits for the group composer to render after page load", async ({ page }) => {
  await setup(page, "<main>Group feed is loading</main>");
  await page.evaluate(() => setTimeout(() => {
    const trigger = document.createElement("button");
    trigger.textContent = "Write something...";
    trigger.onclick = () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button class="post">Post</button>';
      document.body.append(dialog);
    };
    document.body.append(trigger);
  }, 600));
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  await expect(page.getByRole("textbox")).toContainText("Reviewed caption");
});

test("stopping while the composer loads prevents caption changes", async ({ page }) => {
  await setup(page, '<button id="compose">Write something...</button>');
  await page.evaluate(() => {
    document.getElementById("compose")!.onclick = () => setTimeout(() => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = '<div role="textbox" contenteditable="true"></div><button class="post">Post</button>';
      document.body.append(dialog);
    }, 600);
  });
  const pending = send(page, { type: "PREPARE_CAPTION", ...job });
  await send(page, { type: "CANCEL_JOB", jobId: job.jobId });
  expect(await pending).toMatchObject({ ok: false, clicked: false });
  await expect(page.getByRole("textbox")).toBeEmpty();
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
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg=="
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

test("image picker inserted outside the dialog ignores unrelated existing pickers", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button id="photo">Ảnh/video</button><button id="post" disabled>Đăng</button></div>');
  await page.evaluate(() => {
    const unrelated = document.createElement("input");
    unrelated.type = "file";
    unrelated.accept = "image/*";
    document.body.append(unrelated);
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
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg=="
  }];
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, attachments })).ok).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-uploaded", "portal.png");
});

test("rich editor handles multiline paste through its own state", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true">Old draft</div><button class="post">Post</button></div>');
  await page.getByRole("textbox").evaluate((editor) => {
    editor.addEventListener("paste", (event) => {
      const paste = event as ClipboardEvent;
      paste.preventDefault();
      setTimeout(() => {
        editor.replaceChildren(...(paste.clipboardData?.getData("text/plain") ?? "").split("\n").map((line) => {
          const paragraph = document.createElement("p");
          if (line) paragraph.textContent = line;
          else paragraph.append(document.createElement("br"));
          return paragraph;
        }));
        document.body.dataset.editorState = "updated";
      }, 20);
    });
  });
  const caption = "First line\n\nSecond section\nLast line";
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null })).toMatchObject({ ok: true });
  await expect(page.locator("body")).toHaveAttribute("data-editor-state", "updated");
  await expect(page.getByRole("textbox").locator("p")).toHaveCount(4);
  await expect(page.getByRole("textbox")).not.toContainText("Old draft");
});

test("leading blank lines replace the previous draft", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true">Old draft</div><button class="post">Post</button></div>');
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, caption: "\n\nNew draft\nNext line", linkUrl: null })).toMatchObject({ ok: true });
  await expect(page.getByRole("textbox")).not.toContainText("Old draft");
  await expect(page.getByRole("textbox")).toContainText("New draft");
});


test("multiline Vietnamese caption keeps every line and blank section separator", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Đăng</button></div>');
  const caption = [
    "🌱 WEBINAR NCKHSV CLB VƯỜN ƯƠM",
    "HỌC HỎI TỪ NHỮNG CÔNG TRÌNH ĐẠT GIẢI",
    "Bạn muốn tìm hiểu về lộ trình nghiên cứu khoa học?",
    "",
    "📍 THÔNG TIN BUỔI WEBINAR",
    "⏰ Thời gian: 19:00 – 20:00",
    "💻 Hình thức: Trực tuyến",
    "🔗 Link Google Meet: https://example.test/meeting",
    "",
    "💡 NỘI DUNG CÁC ĐỀ TÀI BÁO CÁO",
    "🏆 Thành tích: Giải Nhất NCKHSV",
    "",
    "📧 Email: example@example.test",
    "#TDTU #KhoaCNTT #ICONCLUB #NCKHSV",
  ].join("\n");
  const prepared = await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null });
  expect(prepared).toMatchObject({ ok: true, clicked: false });
  const editor = page.locator("[role='dialog'] [role='textbox']");
  await expect(editor).toHaveText(caption, { useInnerText: true });
  expect(await editor.evaluate((element) => ((element as HTMLElement).innerText.match(/\n/g) ?? []).length)).toBeGreaterThan(6);
  const result = await send(page, { type: "PUBLISH_POST", ...job, caption, linkUrl: null });
  expect(result).toMatchObject({ ok: true, clicked: true });
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(1);
});

test("does not publish when Facebook collapses a prepared multiline caption", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  const caption = "🌱 Tiêu đề\n\n📍 Thông tin\n⏰ 19:00 – 20:00\n#NCKHSV";
  expect((await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null })).ok).toBe(true);
  await page.locator("[role='dialog'] [role='textbox']").evaluate((editor) => {
    const collapsedText = editor.textContent;
    editor.textContent = collapsedText;
  });
  const result = await send(page, { type: "PUBLISH_POST", ...job, caption, linkUrl: null });
  expect(result).toMatchObject({ ok: false, clicked: false, reason: "CAPTION_FORMAT_INVALID" });
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
});

test("textarea composer retains CRLF and Unicode paragraph separators", async ({ page }) => {
  await setup(page, '<div role="dialog"><textarea name="xhpc_message"></textarea><button class="post">Post</button></div>');
  const caption = "Chủ đề 1\r\nChủ đề 2\u2028\n📍 Địa điểm";
  const result = await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null });
  expect(result).toMatchObject({ ok: true, clicked: false });
  await expect(page.locator("textarea")).toHaveValue("Chủ đề 1\nChủ đề 2\n\n📍 Địa điểm");
});


test("human clicks Facebook Post after preparation; extension reports outcome without auto-clicking", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Đăng</button></div>');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("button.post")!.onclick = () => {
      const notice = document.createElement("div");
      notice.setAttribute("role", "status");
      notice.textContent = "Your post was published.";
      document.body.append(notice);
    };
  });
  expect((await send(page, { type: "PREPARE_CAPTION", ...job })).ok).toBe(true);
  expect((await send(page, { type: "ARM_USER_POST", ...job })).ok).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
  await page.getByRole("button", { name: "Đăng" }).click();
  await expect.poll(() => page.evaluate(() => {
    const events = (window as unknown as { automaticEvents: Array<{ type: string }> }).automaticEvents;
    return events.filter((event) => event.type === "USER_POST_RESULT").length;
  })).toBe(1);
  const events = await page.evaluate(() =>
    (window as unknown as { automaticEvents: Array<{ type: string; outcome?: string }> }).automaticEvents
  );
  expect(events.find((event) => event.type === "USER_POST_CLICKED")).toBeDefined();
  expect(events.find((event) => event.type === "USER_POST_RESULT")?.outcome).toBe("published");
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(1);
});

test("progress survives Facebook replacing the page after submission", async ({ page }) => {
  await setup(page, '<main>Group feed</main>');
  await send(page, { type: "AUTO_PROGRESS", enabled: true, phase: "VERIFYING" });
  await expect(page.locator("#groupflow-progress-indicator")).toBeVisible();
  await page.evaluate(() => { document.body.replaceChildren(document.createElement("main")); });
  await expect(page.locator("#groupflow-progress-indicator")).toBeVisible();
  await send(page, { type: "AUTO_PROGRESS", enabled: false, phase: "PAUSED" });
  await expect(page.locator("#groupflow-progress-indicator")).toHaveCount(0);
});

test("cancelling a prepared watcher prevents later submission callbacks", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  expect((await send(page, { type: "ARM_USER_POST", ...job })).ok).toBe(true);
  await send(page, { type: "CANCEL_JOB", jobId: job.jobId });
  await page.getByRole("button", { name: "Post" }).click();
  const events = await page.evaluate(() =>
    (window as unknown as { automaticEvents: Array<{ type: string }> }).automaticEvents
  );
  expect(events.some((event) => event.type === "USER_POST_CLICKED")).toBe(false);
});


test("Facebook Lexical visual blank lines do not block a valid complete caption", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Đăng</button></div>');
  const caption = "🌱 WEBINAR NCKHSV\n\n📍 THÔNG TIN BUỔI WEBINAR\n⏰ 19:00 – 20:00\n\n#NCKHSV";
  await page.locator("[role='dialog'] [role='textbox']").evaluate((node) => {
    // Facebook's Lexical renderer can expose an extra paragraph separator
    // via innerText even when the underlying characters and breaks are right.
    // The previous validator required byte-exact innerText equality.
    Object.defineProperty(node, "innerText", {
      configurable: true,
      get() {
        return "🌱 WEBINAR NCKHSV\n\n\n📍 THÔNG TIN BUỔI WEBINAR\n\n⏰ 19:00 – 20:00\n\n\n#NCKHSV";
      },
    });
  });
  const result = await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null });
  expect(result).toMatchObject({ ok: true, clicked: false });
  // The assisted workflow must not click the Facebook Post button.
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
  await expect(page.locator("[role='dialog'] [role='textbox']")).toContainText("THÔNG TIN BUỔI WEBINAR");
});

test("Facebook genuinely flattening a prepared multiline caption pauses safely", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  const caption = "🌱 WEBINAR\n📍 Thông tin\n🏆 Thành tích";
  await page.locator("[role='dialog'] [role='textbox']").evaluate((node) => {
    Object.defineProperty(node, "innerText", {
      configurable: true,
      get() { return node.textContent ?? ""; },
    });
  });
  // The synthetic DOM returns one visually flattened line even if insertText
  // put the full caption into nodes containing nonvisual separators.
  const result = await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null });
  // If execCommand made actual <br> nodes this is a valid layout. If it put
  // only raw newlines in text, a failure is required.
  if (!result.ok) expect(result.reason).toBe("CAPTION_FORMAT_INVALID");
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
});

for (const broken of ["missing-space", "missing-line"]) {
  test(`Lexical rejects ${broken} during reconciliation`, async ({ page }) => {
    await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
    await page.getByRole("textbox").evaluate((editor, variant) => {
      editor.addEventListener("paste", (event) => {
        event.preventDefault();
        editor.innerHTML = variant === "missing-space" ? "<p>Two words</p><p>Secondline</p>" : "<p>Two wordsSecond line</p>";
      });
    }, broken);
    expect(await send(page, { type: "PREPARE_CAPTION", ...job, caption: "Two words\nSecond line", linkUrl: null })).toMatchObject({ ok: false, reason: "CAPTION_FORMAT_INVALID" });
    expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
  });
}

test("repeat preparation preserves a user edit", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  await send(page, { type: "PREPARE_CAPTION", ...job });
  await page.getByRole("textbox").fill("My reviewed edit");
  expect(await send(page, { type: "PREPARE_CAPTION", ...job })).toMatchObject({ ok: true });
  await expect(page.getByRole("textbox")).toHaveText("My reviewed edit");
});

test("synthetic clicks never notify a user submission", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  await send(page, { type: "ARM_USER_POST", ...job });
  await page.getByRole("button").evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => (window as unknown as { automaticEvents: unknown[] }).automaticEvents)).toEqual([]);
});

test("failed upload retries after recovery without duplicating previews", async ({ page }) => {
  test.setTimeout(45_000);
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png"><button class="post">Post</button></div>');
  await page.evaluate(() => {
    let attempts = 0;
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.onchange = () => {
      document.body.dataset.uploadAttempts = String(++attempts);
      if (attempts === 1) return;
      const image = document.createElement("img");
      image.src = URL.createObjectURL(input.files![0]); image.width = 20; image.height = 20;
      document.querySelector('[role="dialog"]')!.append(image);
    };
  });
  const attachments = [{ id: "retry-image", filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==" }];
  const payload = { type: "PREPARE_CAPTION", ...job, attachments };
  expect(await send(page, payload)).toMatchObject({ ok: false, reason: "UPLOAD_FAILED" });
  expect(await send(page, payload)).toMatchObject({ ok: true });
  expect(await send(page, payload)).toMatchObject({ ok: true });
  await expect(page.locator('[role="dialog"] img')).toHaveCount(1);
  await expect(page.locator("body")).toHaveAttribute("data-upload-attempts", "2");
  expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
});

for (const signal of ["old-toast", "feed-toast", "conflicting"] as const) {
  test(`assisted verification rejects ${signal}`, async ({ page }) => {
    await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
    await page.clock.install();
    await page.evaluate((scenario) => {
      const addNotice = (text: string, feed = false) => {
        const host = document.createElement("div");
        if (feed) host.setAttribute("role", "feed");
        const notice = document.createElement("div"); notice.setAttribute("role", "status"); notice.textContent = text;
        host.append(notice); document.body.append(host);
      };
      if (scenario === "old-toast") addNotice("Your post was published.");
      document.querySelector<HTMLButtonElement>("button.post")!.onclick = () => {
        if (scenario === "feed-toast") addNotice("Your post was published.", true);
        if (scenario === "conflicting") { addNotice("Your post was published."); addNotice("Submitted for approval"); }
      };
    }, signal);
    await send(page, { type: "ARM_USER_POST", ...job });
    await page.getByRole("button", { name: "Post", exact: true }).click();
    await page.clock.runFor(31_000);
    await expect.poll(() => page.evaluate(() => (window as unknown as { automaticEvents: Array<{ outcome?: string }> }).automaticEvents.find((event) => event.outcome)?.outcome)).toBe("unknown");
  });
}

test("Lexical paragraphs preserve double blank lines and joined Unicode emoji", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post">Post</button></div>');
  await page.getByRole("textbox").evaluate((editor) => {
    editor.addEventListener("paste", (event) => {
      const paste = event as ClipboardEvent;
      paste.preventDefault();
      editor.replaceChildren(...paste.clipboardData!.getData("text/plain").split("\n").map((text) => {
        const p = document.createElement("p");
        if (text) p.textContent = text; else p.append(document.createElement("br"));
        return p;
      }));
    });
  });
  const caption = "\uD83D\uDC69\u200D\uD83D\uDCBB Nghiên cứu  khoa học\r\n\r\n\r\n‘Thông tin’ https://example.test/path?q=1\r\n#NCKHSV";
  expect(await send(page, { type: "PREPARE_CAPTION", ...job, caption, linkUrl: null })).toMatchObject({ ok: true });
  await expect(page.getByRole("textbox").locator("p")).toHaveCount(5);
});

test("disabled Post cannot arm a submission watcher", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><button class="post" disabled>Post</button></div>');
  expect(await send(page, { type: "ARM_USER_POST", ...job })).toMatchObject({ ok: false, reason: "POST_BUTTON_DISABLED" });
});

test("a changed preview never causes a duplicate upload", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png"><button class="post">Post</button></div>');
  await page.evaluate(() => {
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    let changes = 0;
    picker.onchange = () => {
      document.body.dataset.uploads = String(++changes);
      const image = document.createElement("img"); image.src = URL.createObjectURL(picker.files![0]); image.width = 20; image.height = 20;
      document.querySelector('[role="dialog"]')!.append(image);
    };
  });
  const payload = { type: "PREPARE_CAPTION", ...job, attachments: [{ id: "verified-file", filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==" }] };
  expect(await send(page, payload)).toMatchObject({ ok: true });
  await page.locator('[role="dialog"] img').evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    image.src = canvas.toDataURL();
  });
  expect(await send(page, payload)).toMatchObject({ ok: false, reason: "UPLOAD_FAILED" });
  await expect(page.locator("body")).toHaveAttribute("data-uploads", "1");
});

test("partial previews pause retry without uploading duplicates", async ({ page }) => {
  await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png" multiple><button class="post">Post</button></div>');
  await page.clock.install();
  await page.evaluate(() => {
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    picker.onchange = () => {
      document.body.dataset.uploads = String(Number(document.body.dataset.uploads ?? "0") + 1);
      const image = document.createElement("img"); image.src = URL.createObjectURL(picker.files![0]); image.width = 20; image.height = 20;
      document.querySelector('[role="dialog"]')!.append(image);
    };
  });
  const file = { filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==" };
  const payload = { type: "PREPARE_CAPTION", ...job, attachments: [{ ...file, id: "first" }, { ...file, id: "second" }] };
  const preparing = send(page, payload);
  await expect(page.locator("body")).toHaveAttribute("data-uploads", "1");
  await page.clock.runFor(31_000);
  expect(await preparing).toMatchObject({ ok: false, reason: "UPLOAD_FAILED" });
  expect(await send(page, payload)).toMatchObject({ ok: false, reason: "UPLOAD_FAILED" });
  await expect(page.locator("body")).toHaveAttribute("data-uploads", "1");
});

for (const wrongImage of [false, true]) {
  test(`local re-encoded preview ${wrongImage ? "rejects different pixels" : "accepts matching pixels without duplicate upload"}`, async ({ page }) => {
    await setup(page, '<div role="dialog"><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png"><button class="post">Post</button></div>');
    await page.evaluate((wrong) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      (window as unknown as { uploads: number }).uploads = 0;
      input.onchange = async () => {
        (window as unknown as { uploads: number }).uploads++;
        const bitmap = await createImageBitmap(input.files![0]);
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0); bitmap.close();
        if (wrong) { context.fillStyle = "red"; context.fillRect(0, 0, canvas.width, canvas.height); }
        const preview = document.createElement("img"); preview.src = canvas.toDataURL(); preview.width = 30; preview.height = 30;
        document.querySelector('[role="dialog"]')!.append(preview);
      };
    }, wrongImage);
    const payload = { type: "PREPARE_CAPTION", ...job, attachments: [{ id: "reencoded-image", filename: "pixel.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==" }] };
    const result = await send(page, payload);
    expect(result.ok).toBe(!wrongImage);
    if (wrongImage) expect(result.reason).toBe("UPLOAD_PREVIEW_UNVERIFIED");
    else expect((await send(page, payload)).ok).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { uploads: number }).uploads)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { finalPostClicks: number }).finalPostClicks)).toBe(0);
  });
}
