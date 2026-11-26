/**
 * 0071's tracking gaps (Kyle, 27 November 2026): what measures a site's ads,
 * read from the page, its tag manager containers, Shopify's pixel settings
 * and the requests Google's phone test saw. The snippets are cut down from
 * the paper test's real sites. The rule that matters most: when Pulse can't
 * tell, it claims nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTellTracking,
  faultsOf,
  findTags,
  gtmIds,
  hasConsentTool,
  readGtmContainer,
  shopifyMetaPixel,
  siteKind,
  trackingFacts,
  withContainerTags,
  type Facts,
  type GtmReading,
} from "./measure-rules.ts";

const EMPTY_CONTAINER = `var data = {"resource": {"version":"3","macros":[{"function":"__e"}],"tags":[],"predicates":[],"rules":[]},"runtime":[]};`;
const GOOGLE_CONTAINER = `var data = {"resource": {"version":"9","macros":[{"function":"__u"}],"tags":[{"function":"__gclidw","tag_id":3},{"function":"__googtag","vtp_tagId":"G-X58021SFC6","tag_id":5},{"function":"__gaawe","vtp_eventName":"form_lead"}],"predicates":[]}};`;
const PIXEL_CONTAINER = `var data = {"resource": {"version":"4","tags":[{"function":"__html","vtp_html":"\\u003Cscript\\u003E!function(f,b,e,v,n,t,s){n.src='https:\\/\\/connect.facebook.net\\/en_US\\/fbevents.js'}fbq('init','123456789012345');\\u003C\\/script\\u003E"}],"predicates":[]}};`;

test("reading a tag manager container", () => {
  const e = readGtmContainer("GTM-WFTNVQQK", EMPTY_CONTAINER);
  assert.deepEqual([e.ok, e.empty, e.metaPixel, e.googleTag], [true, true, false, false]);
  const g = readGtmContainer("GTM-MKFWPR7L", GOOGLE_CONTAINER);
  assert.deepEqual([g.ok, g.empty, g.metaPixel, g.googleTag], [true, false, false, true]);
  assert.deepEqual(g.ga4, ["G-X58021SFC6"]);
  const p = readGtmContainer("GTM-NZ55CLG", PIXEL_CONTAINER);
  assert.equal(p.metaPixel, true);
  const notOne = readGtmContainer("GTM-XXXX", "<html>Not found</html>");
  assert.equal(notOne.ok, false);
});

test("site kinds, containers, Shopify's pixel, consent banners", () => {
  assert.equal(siteKind('<link href="//cdn.shopify.com/s/files/1/theme.css">'), "shopify");
  assert.equal(siteKind('<img src="https://static.wixstatic.com/media/a.jpg">'), "wix");
  assert.equal(siteKind('<script>Static.SQUARESPACE_CONTEXT = {}</script>'), "squarespace");
  assert.equal(siteKind('<img src="https://irp-cdn.multiscreensite.com/a.png">'), "duda");
  assert.equal(siteKind('<link href="/wp-content/themes/x/style.css">'), "wordpress");
  assert.equal(siteKind("<html><body>Hand built</body></html>"), "other");
  assert.deepEqual(gtmIds("googletagmanager.com/gtm.js?id=GTM-WDRK65K", ["https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"]), ["GTM-ABC1234", "GTM-WDRK65K"]);
  const shop = `webPixelsConfigList: [{"id":"2431025317","configuration":"{\\"pixel_id\\":\\"1209710053026871\\",\\"pixel_type\\":\\"facebook_pixel\\"}","type":"APP"}]`;
  assert.equal(shopifyMetaPixel(shop), true);
  assert.equal(shopifyMetaPixel(`webPixelsConfigList: [{"id":"1","configuration":"{}","type":"APP","apiClientId":5940125}]`), false);
  assert.equal(hasConsentTool('<script src="https://consent.cookiebot.com/uc.js"></script>'), true);
  assert.equal(hasConsentTool("<html></html>"), false);
  // Named in settings but not loaded: a Duda site's config, a pixel plugin's options.
  assert.equal(hasConsentTool(`rtCommonProps["cookiebot.mapbox.consent.category"] = 'marketing';`), false);
  assert.equal(hasConsentTool(`{"cookiebot_integration_enabled":false,"cookiebot_facebook_consent_category":"marketing"}`), false);
});

test("found live on 27 November: a noscript Pixel, and Google's Site Kit tag", () => {
  // A pixel plugin's noscript image is a Pixel, so no gap (the paper test missed this one).
  const pys = factsFor(`<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=1959457900822506&ev=PageView&noscript=1"></noscript><script>'GTM-WDRK65K'</script>`, [], [readGtmContainer("GTM-WDRK65K", GOOGLE_CONTAINER)]);
  assert.deepEqual(faultsOf(pys), []);
  // Site Kit loads the Google tag by its GT- id: a Google tag, so no Google gap (the paper test missed this too).
  const siteKit = factsFor(`<script src="https://www.googletagmanager.com/gtag/js?id=GT-NFBLHRKD" async></script><script>gtag("config", "GT-NFBLHRKD");</script><script>'GTM-WFTNVQQK'</script>`, [], [readGtmContainer("GTM-WFTNVQQK", EMPTY_CONTAINER)]);
  assert.deepEqual(faultsOf(siteKit), ["no_meta_pixel"]);
});

const ok = (over: Partial<Facts>): Facts => ({
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
  tags: { aw: [], metaPixel: [], ga4: [], ua: [] },
  cls: 0,
  tbtMs: 0,
  mobileViewport: true,
  tracking: null,
  ...over,
});

function factsFor(html: string, requests: string[] = [], containers: GtmReading[] = []): Facts {
  return ok({ tags: withContainerTags(findTags(html, requests), containers), tracking: trackingFacts(html, requests, containers) });
}

test("Black Diamond: no Pixel, only the old analytics", () => {
  const html = `<script>ga('create', 'UA-55538711-1', 'auto'); ga('send', 'pageview');</script><p>(07) 5627 4077</p>`;
  const f = factsFor(html, ["https://www.google-analytics.com/analytics.js"]);
  assert.deepEqual(faultsOf(f).sort(), ["no_meta_pixel", "old_analytics"]);
});

test("Southeast Fibreglass: an empty tag manager, nothing else", () => {
  const html = `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-WFTNVQQK"></script><link href="/wp-content/x.css">`;
  const f = factsFor(html, [], [readGtmContainer("GTM-WFTNVQQK", EMPTY_CONTAINER)]);
  assert.deepEqual(faultsOf(f).sort(), ["no_google_tag", "no_meta_pixel"]);
  assert.equal(f.tracking!.gtmEmpty, true);
});

test("The Tint Joint: Analytics in its tag manager, no Pixel", () => {
  const html = `<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-WDRK65K');</script>`;
  const f = factsFor(html, [], [readGtmContainer("GTM-WDRK65K", GOOGLE_CONTAINER)]);
  assert.deepEqual(faultsOf(f), ["no_meta_pixel"]);
  assert.deepEqual(f.tags.ga4, ["G-X58021SFC6"]);
});

test("a Pixel anywhere means no gap: the page, a container, Shopify, or the phone test's requests", () => {
  assert.ok(!faultsOf(factsFor("<script>fbq('init', '123456789012345');</script><script>gtag('config','G-AAAA11112222')</script>")).includes("no_meta_pixel"));
  const viaGtm = factsFor("<script>'GTM-NZ55CLG'</script>", [], [readGtmContainer("GTM-NZ55CLG", PIXEL_CONTAINER)]);
  assert.ok(!faultsOf(viaGtm).includes("no_meta_pixel"));
  const viaRequests = factsFor("<div>Wix site</div>", ["https://www.facebook.com/tr/?id=1209710053026871&ev=PageView"]);
  assert.ok(!faultsOf(viaRequests).includes("no_meta_pixel"));
  const shop = factsFor(`webPixelsConfigList: [{"configuration":"{\\"pixel_id\\":\\"1\\",\\"pixel_type\\":\\"facebook_pixel\\"}"}]`);
  assert.ok(!faultsOf(shop).includes("no_meta_pixel"));
});

test("when Pulse can't tell, it claims nothing", () => {
  const bare = "<html><body>Nothing here</body></html>";
  assert.deepEqual(faultsOf(factsFor(bare)).sort(), ["no_google_tag", "no_meta_pixel"]);
  // The phone test didn't run.
  assert.deepEqual(faultsOf({ ...factsFor(bare), psiOk: false }), []);
  // A container that couldn't be read.
  const unread = factsFor("<script>'GTM-ABCDE12'</script>", [], [{ id: "GTM-ABCDE12", ok: false, empty: false, metaPixel: false, googleTag: false, ga4: [], aw: [] }]);
  assert.deepEqual(faultsOf(unread), []);
  // A container the page loads that Pulse never fetched (seen only in the requests).
  assert.deepEqual(faultsOf(factsFor(bare, ["https://www.googletagmanager.com/gtm.js?id=GTM-LATE123"])), []);
  // A consent banner that can hold tags back.
  assert.deepEqual(faultsOf(factsFor('<script src="https://cdn-cookieyes.com/client_data/x.js"></script>')), []);
  // No tracking facts at all (a measurement from before 0071).
  assert.equal(canTellTracking({ status: "ok", psiOk: true, tracking: null }), false);
  // A page that couldn't be read.
  assert.deepEqual(faultsOf({ ...factsFor(bare), status: "blocked" }), []);
});
