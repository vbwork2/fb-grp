import { test, expect } from "@playwright/test";

test("Vietnamese language selection persists and translates auth feedback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.locator("#app-language").selectOption("vi");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByRole("heading", { name: "Chào mừng bạn trở lại" })).toBeVisible();
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Trợ lý đăng bài/);
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ data: null, error: { message: "Email or password is incorrect." } }) }));
  await page.getByLabel("Email", { exact: true }).fill("translation@example.test");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Example-password9");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Email hoặc mật khẩu không đúng.");
  await page.locator("#app-language").selectOption("en");
  await expect(page.locator("form").getByRole("alert")).toHaveText("Email or password is incorrect.");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.locator("#app-language").selectOption("vi");
  await expect(page.getByRole("heading", { name: "Bắt đầu" })).toBeVisible();
  await expect(page.getByLabel("Tên", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

