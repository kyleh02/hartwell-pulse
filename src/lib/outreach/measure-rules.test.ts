import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmedFaults,
  faultsOf,
  findTags,
  hasAdSignal,
  hasMobileViewport,
  hasTelLink,
  isBlockPage,
  looksScriptBuilt,
  menuLinks,
  phoneInHtml,
  pixelPageViews,
  qualifies,
  summarisePsi,
  type Facts,
} from "./measure-rules.ts";
import type { Fault } from "./rules.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const PAGE = `<!doctype html><html><head>
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
<script>gtag('config', 'AW-123456789'); gtag('config', 'UA-1234567-1');</script>
<script>!function(f,b,e,v,n,t,s){}(window);fbq('init', '1234567890123456');fbq('track', 'PageView');</script>
</head><body>
<header><nav>
  <a href="/">Home</a><a href="/canopies/">Canopies</a><a href="https://www.catten.com.au/contact#form">Contact</a>
  <a href="mailto:sales@catten.com.au">Email</a><a href="tel:0395551234">Call</a>
  <a href="https://facebook.com/catten">Facebook</a><a href="/brochure.pdf">Brochure</a>
</nav></header>
<main><p>Call us on (03) 9555 1234 for a quote.</p><p>${words(120)}</p></main>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>`;

test("tags in the source: Google Ads, Meta Pixel, old Analytics", () => {
  const t = findTags(PAGE);
  assert.deepEqual(t.aw, ["AW-123456789"]);
  assert.deepEqual(t.metaPixel, ["1234567890123456"]);
  assert.deepEqual(t.ua, ["UA-1234567-1"]);
  assert.deepEqual(t.ga4, []);
  assert.equal(hasAdSignal(t), true);
});

test("tags loaded through Tag Manager show up in the network requests", () => {
  const t = findTags("<html><script src='https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'></script></html>", [
    "https://www.googletagmanager.com/gtag/js?id=G-ABCDEF1234&l=dataLayer",
    "https://www.facebook.com/tr/?id=9876543210987&ev=PageView&dl=x",
    "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/987654321/?random=1&cv=11&tid=AW-987654321",
  ]);
  assert.deepEqual(t.ga4, ["G-ABCDEF1234"]);
  assert.deepEqual(t.metaPixel, ["9876543210987"]);
  assert.deepEqual(t.aw, ["AW-987654321"]);
});

test("no tags, no ad signal", () => {
  assert.equal(hasAdSignal(findTags(`<html><body>${words(100)}</body></html>`)), false);
});

test("Meta Pixel PageViews are counted per pixel", () => {
  const v = pixelPageViews([
    "https://www.facebook.com/tr/?id=111111111111&ev=PageView&dl=a",
    "https://www.facebook.com/tr/?id=111111111111&ev=PageView&dl=b",
    "https://www.facebook.com/tr/?id=111111111111&ev=ViewContent",
    "https://www.facebook.com/tr?id=222222222222&ev=PageView",
    "https://example.com/?ev=PageView&id=333333333333",
  ]);
  assert.deepEqual(v, { "111111111111": 2, "222222222222": 1 });
});

test("a phone number people can read, and whether it can be tapped", () => {
  assert.equal(phoneInHtml(PAGE), "(03) 9555 1234");
  assert.equal(phoneInHtml("<p>Mobile 0412 345 678</p>"), "0412 345 678");
  assert.equal(phoneInHtml("<p>Ring 1300 123 456</p>"), "1300 123 456");
  assert.equal(phoneInHtml("<p>Call +61 7 5555 1234</p>"), "+61 7 5555 1234");
  // Not in a script, and an ABN is not a phone number.
  assert.equal(phoneInHtml("<script>var p='0395551234'</script><p>ABN 51 824 753 556</p>"), null);
  assert.equal(hasTelLink(PAGE), true);
  assert.equal(hasTelLink("<a href='/contact'>Call</a>"), false);
});

test("a page built by script is recognised", () => {
  assert.equal(looksScriptBuilt('<html><body><div id="root"></div><script src="/app.js"></script></body></html>'), true);
  assert.equal(looksScriptBuilt(PAGE), false);
});

test("bot-protection pages mean couldn't check, a reCAPTCHA doesn't", () => {
  assert.equal(isBlockPage(403, "<html>Forbidden</html>"), true);
  assert.equal(isBlockPage(429, ""), true);
  assert.equal(isBlockPage(503, "<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x.js'></script>"), true);
  assert.equal(isBlockPage(200, "<title>Just a moment...</title>"), true);
  // A normal page with a contact form's reCAPTCHA and Cloudflare's background script.
  assert.equal(isBlockPage(200, `${PAGE}<script src="https://www.google.com/recaptcha/api.js"></script><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>`), false);
  assert.equal(isBlockPage(500, "<h1>Internal Server Error</h1>"), false);
});

test("the main menu: own pages only, no mail, phone, files or other sites", () => {
  const links = menuLinks(PAGE, "https://catten.com.au/");
  assert.deepEqual(
    links.map((l) => l.url),
    ["https://catten.com.au/", "https://catten.com.au/canopies/", "https://www.catten.com.au/contact"],
  );
  assert.equal(links[1].label, "Canopies");
  // The footer isn't the main menu.
  assert.ok(!links.some((l) => l.url.endsWith("/privacy")));
});

test("PageSpeed: the paint times, requests and screenshot", () => {
  const s = summarisePsi({
    lighthouseResult: {
      finalDisplayedUrl: "https://catten.com.au/",
      audits: {
        "first-contentful-paint": { numericValue: 4321.7 },
        "largest-contentful-paint": { numericValue: 6100.2 },
        "network-requests": { details: { items: [{ url: "https://catten.com.au/" }, { url: "https://www.facebook.com/tr/?id=1&ev=PageView" }] } },
        "final-screenshot": { details: { data: "data:image/jpeg;base64,AAAA" } },
      },
    },
  });
  assert.equal(s.ok, true);
  assert.equal(s.fcpMs, 4322);
  assert.equal(s.lcpMs, 6100);
  assert.equal(s.requestUrls.length, 2);
  assert.equal(s.screenshot, "data:image/jpeg;base64,AAAA");
  assert.equal(summarisePsi({ error: { message: "Quota exceeded" } }).ok, false);
  assert.equal(summarisePsi({ lighthouseResult: { runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "x" } } }).ok, false);
  assert.equal(summarisePsi(null).ok, false);
});

const base: Facts = {
  status: "ok",
  psiOk: true,
  fcpMs: 1500,
  lcpMs: 2500,
  https: "ok",
  httpLoads: true,
  menu: [],
  phoneInHtml: false,
  telLink: true,
  scriptBuilt: false,
  pixelPageViews: {},
  tags: { aw: ["AW-1"], metaPixel: [], ga4: ["G-ABCDEFGH12"], ua: [] },
};

test("a healthy site has no faults", () => {
  assert.deepEqual(faultsOf(base), []);
});

test("each of the six faults, by its own rule", () => {
  assert.deepEqual(faultsOf({ ...base, fcpMs: 4000 }), ["slow_mobile"]);
  assert.deepEqual(faultsOf({ ...base, lcpMs: 6000 }), ["slow_mobile"]);
  assert.deepEqual(faultsOf({ ...base, fcpMs: 3999, lcpMs: 5999 }), []);
  assert.deepEqual(faultsOf({ ...base, menu: [{ url: "x", status: 404, blocked: false }] }), ["broken_page"]);
  assert.deepEqual(faultsOf({ ...base, menu: [{ url: "x", status: 500, blocked: false }] }), ["broken_page"]);
  assert.deepEqual(faultsOf({ ...base, https: "bad_certificate" }), ["not_secure"]);
  assert.deepEqual(faultsOf({ ...base, https: "unreachable", httpLoads: true }), ["not_secure"]);
  assert.deepEqual(faultsOf({ ...base, phoneInHtml: true, telLink: false }), ["phone_not_tappable"]);
  assert.deepEqual(faultsOf({ ...base, pixelPageViews: { "1": 2 } }), ["pixel_double"]);
  assert.deepEqual(faultsOf({ ...base, tags: { aw: ["AW-1"], metaPixel: [], ga4: [], ua: ["UA-1-1"] } }), ["old_analytics"]);
});

test("the three 0067 faults: jumps around, freezes, not set up for phones", () => {
  assert.deepEqual(faultsOf({ ...base, cls: 0.25 }), ["layout_shift"]);
  assert.deepEqual(faultsOf({ ...base, cls: 0.249 }), []);
  assert.deepEqual(faultsOf({ ...base, tbtMs: 600 }), ["page_freezes"]);
  assert.deepEqual(faultsOf({ ...base, tbtMs: 599 }), []);
  assert.deepEqual(faultsOf({ ...base, mobileViewport: false }), ["no_mobile_layout"]);
  assert.deepEqual(faultsOf({ ...base, mobileViewport: true }), []);
  // Couldn't tell, or the speed test didn't run, or a page built by script: no claim.
  assert.deepEqual(faultsOf({ ...base, mobileViewport: null }), []);
  assert.deepEqual(faultsOf({ ...base, psiOk: false, cls: 0.6, tbtMs: 3000 }), []);
  assert.deepEqual(faultsOf({ ...base, mobileViewport: false, scriptBuilt: true }), []);
  // A slow site that also jumps about now has two faults, one for each email.
  assert.ok(qualifies(true, faultsOf({ ...base, fcpMs: 5000, cls: 0.4 })));
});

test("set up for phones: a device-width viewport tag, however it's written", () => {
  assert.equal(hasMobileViewport('<meta name="viewport" content="width=device-width, initial-scale=1">'), true);
  assert.equal(hasMobileViewport("<META content='initial-scale=1,width = device-width' NAME=viewport>"), true);
  assert.equal(hasMobileViewport('<meta name="viewport" content="width=1024">'), false);
  assert.equal(hasMobileViewport('<meta name="description" content="width=device-width">'), false);
  assert.equal(hasMobileViewport("<head><title>Old site</title></head>"), false);
});

test("PageSpeed's layout shift and blocking time are read, the shift to three places", () => {
  const s = summarisePsi({
    lighthouseResult: {
      audits: {
        "first-contentful-paint": { numericValue: 1800 },
        "largest-contentful-paint": { numericValue: 2600 },
        "cumulative-layout-shift": { numericValue: 0.31234 },
        "total-blocking-time": { numericValue: 1240.6 },
      },
    },
  });
  assert.equal(s.cls, 0.312);
  assert.equal(s.tbtMs, 1241);
  assert.equal(summarisePsi({ lighthouseResult: { audits: {} } }).cls, null);
});

test("what doesn't count as a fault", () => {
  // A blocked or timed-out link isn't a broken page.
  assert.deepEqual(faultsOf({ ...base, menu: [{ url: "x", status: 403, blocked: true }, { url: "y", status: null, blocked: false }] }), []);
  // A redirect or a login page isn't either.
  assert.deepEqual(faultsOf({ ...base, menu: [{ url: "x", status: 401, blocked: false }] }), []);
  // HTTPS that timed out, or a whole site that's down, isn't "not secure".
  assert.deepEqual(faultsOf({ ...base, https: "unknown" }), []);
  assert.deepEqual(faultsOf({ ...base, https: "unreachable", httpLoads: false }), []);
  // A page built by script may add its phone link later.
  assert.deepEqual(faultsOf({ ...base, phoneInHtml: true, telLink: false, scriptBuilt: true }), []);
  // Old Analytics alongside GA4 is fine.
  assert.deepEqual(faultsOf({ ...base, tags: { ...base.tags, ua: ["UA-1-1"] } }), []);
  // No speed figures, no speed fault.
  assert.deepEqual(faultsOf({ ...base, psiOk: false, fcpMs: 9000 }), []);
  // A page that couldn't be read shows nothing at all.
  assert.deepEqual(faultsOf({ ...base, status: "blocked", https: "bad_certificate" }), []);
});

test("a fault counts only when two runs an hour apart both show it", () => {
  const t0 = "2026-11-20T09:00:00+11:00";
  const run = (at: string, faults: Fault[], status: Facts["status"] = "ok") => ({ measuredAt: at, status, faults });
  assert.deepEqual(confirmedFaults([run(t0, ["slow_mobile", "broken_page"])]), []);
  assert.deepEqual(confirmedFaults([run(t0, ["slow_mobile"]), run("2026-11-20T09:59:00+11:00", ["slow_mobile"])]), []);
  assert.deepEqual(
    confirmedFaults([run(t0, ["slow_mobile", "broken_page"]), run("2026-11-20T10:00:00+11:00", ["slow_mobile", "phone_not_tappable"])]),
    ["slow_mobile"],
  );
  // A blocked run neither confirms nor clears.
  assert.deepEqual(confirmedFaults([run(t0, ["slow_mobile"]), run("2026-11-20T11:00:00+11:00", [], "blocked")]), []);
});

test("to qualify: the ad signal and two different faults", () => {
  assert.equal(qualifies(true, ["slow_mobile", "broken_page"]), true);
  assert.equal(qualifies(true, ["slow_mobile", "slow_mobile"]), false);
  assert.equal(qualifies(false, ["slow_mobile", "broken_page"]), false);
});

test("a menu marked by class name is found when there's no <nav>", () => {
  const html = `<div class="menu-main-container"><ul id="menu-main" class="menu"><li><a href="/services/">Services</a></li><li><a href="/about">About</a></li></ul></div><p>${words(100)}</p>`;
  assert.deepEqual(
    menuLinks(html, "https://shop.com.au/").map((l) => l.url),
    ["https://shop.com.au/services/", "https://shop.com.au/about"],
  );
  // A menu filled in by script leaves nothing to find.
  assert.deepEqual(menuLinks(`<div id="site-nav"></div><p>${words(100)}</p>`, "https://shop.com.au/"), []);
  // ...and its empty placeholder doesn't lend the page's other links to the menu.
  assert.deepEqual(menuLinks(`<div id="site-nav"></div><main><a href="/contact">Contact</a></main>`, "https://shop.com.au/"), []);
});
