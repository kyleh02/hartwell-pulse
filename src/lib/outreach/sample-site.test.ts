import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_EMAIL, SAMPLE_PATH, sampleNotFound, samplePage } from "./sample-site.ts";
import { faultsOf, findTags, hasAdSignal, hasMobileViewport, hasTelLink, looksScriptBuilt, menuLinks, phoneInHtml, type Facts } from "./measure-rules.ts";
import { addressOnPage } from "./contact.ts";

const ORIGIN = "https://portal.hartwelldigital.com";

test("the sample workshop is broken in exactly the ways the end-to-end test needs", () => {
  for (const which of ["home", "canopies"] as const) {
    const html = samplePage(which);
    assert.ok(hasAdSignal(findTags(html)), `${which}: the ad signal`);
    assert.equal(hasMobileViewport(html), false, `${which}: no phone layout`);
    assert.ok(phoneInHtml(html), `${which}: a phone number in the page`);
    assert.equal(hasTelLink(html), false, `${which}: it can't be tapped`);
    assert.equal(looksScriptBuilt(html), false, `${which}: plain HTML`);
    const menu = menuLinks(html, `${ORIGIN}${SAMPLE_PATH}`).map((l) => l.label);
    assert.deepEqual(menu, ["Home", "Canopies", "Gallery", "Contact"]);
  }
  // Measured as Pulse would, with Gallery answering 404: three faults and the ad signal.
  const html = samplePage("home");
  const facts: Facts = {
    status: "ok",
    psiOk: true,
    fcpMs: 1200,
    lcpMs: 1500,
    https: "ok",
    httpLoads: true,
    menu: menuLinks(html, `${ORIGIN}${SAMPLE_PATH}`).map((l) => ({ url: l.url, status: l.label === "Gallery" ? 404 : 200, blocked: false })),
    phoneInHtml: true,
    telLink: false,
    scriptBuilt: false,
    pixelPageViews: {},
    tags: findTags(html),
    cls: 0,
    tbtMs: 0,
    mobileViewport: false,
  };
  assert.deepEqual(faultsOf(facts).sort(), ["broken_page", "no_mobile_layout", "phone_not_tappable"]);
});

test("its contact page publishes the address, with no 'no marketing' note", () => {
  const found = addressOnPage(samplePage("contact"), SAMPLE_EMAIL);
  assert.equal(found.found, true);
  assert.equal(found.noMarketingNearby, false);
  // The address can never receive mail.
  assert.match(SAMPLE_EMAIL, /\.invalid$/);
});

test("every page says it's a sample and asks search engines to stay away", () => {
  for (const html of [samplePage("home"), samplePage("canopies"), samplePage("contact"), sampleNotFound()]) {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /isn't a real workshop/);
    assert.ok(!/draper/i.test(html), "the product name stays out of anything an email could quote");
  }
});
