import { expect, test } from "@playwright/test";

test("sign-in page presents application email and password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/register");
});

test("registration page explains the workspace and password policy", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "10");
  await expect(page.getByText("A personal workspace is created automatically.")).toBeVisible();
});
