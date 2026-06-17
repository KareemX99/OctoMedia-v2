// index.js
// -----------------------------------------------------------------------------
// COMPLETE FACEBOOK OAuth FLOW HANDLER
// Handles: login → 2FA → remember_browser → permissions → skip/submit → Instagram token
// -----------------------------------------------------------------------------

const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = 3000;

const MOCK_TOKEN = "DEMO_FAKE_TOKEN_abc123";

// ----- Mock page -----
app.get("/mock", (req, res) => {
  res.send(`<!doctype html>
<html>
  <head><title>Mock Redirect Page</title></head>
  <body>
    <h1>Mock page loaded</h1>
    <p>In 1 second this page will change its own URL hash (client-side).</p>
    <script>
      setTimeout(function () {
        location.hash = "redirected&access_token=${MOCK_TOKEN}";
      }, 1000);
    </script>
  </body>
</html>`);
});

// ----- /demo route -----
app.get("/demo", async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/mock`);
    await page.waitForFunction(
      () => window.location.href.includes("access_token="),
      { timeout: 10000 }
    );
    const fullUrl = await page.evaluate(() => window.location.href);
    const match = fullUrl.match(/access_token=([^&]+)/);
    const token = match ? match[1] : null;
    await browser.close();
    if (!token) throw new Error("Token not found");
    res.json({ ok: true, note: "Mock token from hash.", token });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// /auth route – FULL FLOW with all intermediate pages handled
// ---------------------------------------------------------------------------
app.get("/auth", async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Log every URL change
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        console.log("[URL]", frame.url());
      }
    });

    const FB_OAUTH_URL =
      "https://www.facebook.com/dialog/oauth?client_id=124024574287414&redirect_uri=https://www.instagram.com/accounts/signup/&scope=pages_show_list,pages_messaging,pages_read_engagement&response_type=token";

    await page.goto(FB_OAUTH_URL, { waitUntil: "networkidle2" });
    console.log("⏳ Waiting for you to log in...");

    // -----------------------------------------------------------------------
    // Helper: click any visible/near‑visible button that contains specific text
    // -----------------------------------------------------------------------
    const clickButtonContaining = async (...texts) => {
      for (const text of texts) {
        try {
          // Wait a moment for the button to appear
          await page.waitForFunction(
            (t) => {
              const els = document.querySelectorAll(
                'button, input[type="submit"], a[role="button"], div[role="button"], span[role="button"]'
              );
              for (const el of els) {
                if (
                  el.innerText &&
                  el.innerText.toLowerCase().includes(t.toLowerCase()) &&
                  el.offsetParent !== null // visible
                ) {
                  return true;
                }
              }
              return false;
            },
            { timeout: 3000 },
            text
          );

          // Click it via evaluate for reliability
          await page.evaluate((t) => {
            const els = document.querySelectorAll(
              'button, input[type="submit"], a[role="button"], div[role="button"], span[role="button"]'
            );
            for (const el of els) {
              if (
                el.innerText &&
                el.innerText.toLowerCase().includes(t.toLowerCase()) &&
                el.offsetParent !== null
              ) {
                el.click();
                return;
              }
            }
          }, text);

          console.log(`   ✅ Clicked button containing "${text}"`);
          // Wait for navigation or a short delay
          try {
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 });
          } catch {
            await new Promise((r) => setTimeout(r, 3000));
          }
          return true;
        } catch {
          // Button not found, try next text
        }
      }
      return false;
    };

    // -----------------------------------------------------------------------
    // Main waiting loop – handles all intermediate pages
    // -----------------------------------------------------------------------
    let token = null;
    const MAX_WAIT = 180_000; // 3 minutes
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT) {
      const currentUrl = page.url();
      const currentFullUrl = await page.evaluate(() => window.location.href);

      // ── CHECK: Did we land on Instagram with a token? ──
      if (
        currentFullUrl.includes("instagram.com") &&
        currentFullUrl.includes("access_token=")
      ) {
        const m = currentFullUrl.match(/access_token=([^&]+)/);
        if (m) {
          token = m[1];
          console.log("🎉 Token found!");
          break;
        }
      }

      // ── CHECK: Are we on the "remember browser" page? ──
      if (currentUrl.includes("/two_factor/remember_browser")) {
        console.log("📍 On 'remember browser' page – clicking 'Continue'...");
        await clickButtonContaining("Continue", "متابعة", "Save", "حفظ", "OK");
        continue;
      }

      // ── CHECK: Are we on the permissions page? ──
      if (
        currentUrl.includes("/dialog/oauth") &&
        !currentUrl.includes("/skip/submit") &&
        !currentUrl.includes("instagram.com")
      ) {
        // Might be the permissions screen – try to click "Continue as..." or "متابعة"
        console.log("📍 On permissions page – approving...");
        await clickButtonContaining(
          "Continue as",
          "متابعة باسم",
          "Allow",
          "موافقة",
          "Accept"
        );
        continue;
      }

      // ── CHECK: Blank skip/submit page ──
      if (currentUrl.includes("/dialog/oauth/skip/submit")) {
        console.log("📍 On skip/submit page...");

        // Dump HTML for debugging (first 1500 chars)
        try {
          const html = await page.content();
          console.log("--- PAGE HTML (first 2000 chars) ---");
          console.log(html.substring(0, 2000));
          console.log("--- END HTML ---");
        } catch {}

        // Try clicking any visible submit button
        const clicked = await clickButtonContaining(
          "Continue", "متابعة", "Skip", "تخطي", "OK", "Submit", "إرسال"
        );

        if (!clicked) {
          // Fallback: try to submit any form
          const formExists = await page.evaluate(() => {
            const f = document.querySelector("form");
            if (f) { f.submit(); return true; }
            return false;
          });
          if (formExists) {
            console.log("   Submitted a hidden form.");
            try {
              await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 });
            } catch {}
          } else {
            // Last resort: go directly to Instagram
            console.log("   No clickable element – redirecting to Instagram directly...");
            await page.goto("https://www.instagram.com/accounts/signup/", {
              waitUntil: "networkidle2",
              timeout: 15000,
            });
          }
        }
        continue;
      }

      // ── CHECK: Did we land on the 2FA code page? ──
      if (currentUrl.includes("/two_step_verification/two_factor")) {
        console.log("📍 Waiting for you to enter 2FA code in the browser...");
        // Just wait – user types the code manually
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // ── CHECK: Are we still on the login page? ──
      if (currentUrl.includes("/login.php")) {
        console.log("📍 Waiting for you to enter email/password...");
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // Generic wait
      await new Promise((r) => setTimeout(r, 2000));
    }

    // -----------------------------------------------------------------------
    if (!token) {
      throw new Error(
        "⏰ Timed out waiting for access_token. The flow may need manual intervention."
      );
    }

    await browser.close();
    browser = undefined;

    res.json({
      ok: true,
      note: "Token obtained via real Facebook Implicit Grant.",
      access_token: token,
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Demo server running: http://localhost:${PORT}/demo`);
  console.log(`Real OAuth demo:        http://localhost:${PORT}/auth`);
});