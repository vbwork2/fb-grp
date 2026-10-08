export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.info("Development password reset URL", resetUrl);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Configure Resend to deliver password reset email in production.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: "Reset your Groupflow password", html: `<p>Use this link to reset your password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p>` }),
  });
  if (!response.ok) throw new Error("Unable to send password reset email.");
}
