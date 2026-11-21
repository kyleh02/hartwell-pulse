/**
 * The sample workshop (Kyle, 21 Nov 2026): a made-up canopy business at
 * portal.hartwelldigital.com/sample-workshop, broken on purpose, so the
 * forced end-to-end test can run every step of Draper once, into the test
 * inbox, before the daily run goes live.
 *
 * Broken in three ways Pulse measures, none needing a form:
 *   - no phone layout (no viewport tag)           no_mobile_layout
 *   - the phone number isn't a tap-to-call link    phone_not_tappable
 *   - Gallery, in the main menu, is a 404          broken_page
 * and it carries a Google Ads tag, the ad signal.
 *
 * It runs under Hartwell Digital's own name and ABN, so the ABN check is
 * honest, with a fictional phone number (ACMA's 07 5550 range) and an
 * address on a .invalid domain that can never receive mail. Every page says
 * it's a sample and asks search engines to leave it alone.
 *
 * Plain HTML from route handlers, not Next pages: a Next page always gets a
 * viewport tag, which would fix one of the faults it exists to show. Pure,
 * tested in sample-site.test.ts.
 */

export const SAMPLE_PATH = "/sample-workshop";
export const SAMPLE_EMAIL = "workshop@sample-workshop.invalid";
export const SAMPLE_PHONE = "07 5550 4321";
export const SAMPLE_PAGES = ["canopies", "contact"] as const;
export type SamplePage = "home" | (typeof SAMPLE_PAGES)[number];

const ADS_ID = "AW-000000001";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>${title} | Hartwell Digital sample workshop</title>
<meta name="robots" content="noindex, nofollow">
<script async src="https://www.googletagmanager.com/gtag/js?id=${ADS_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ADS_ID}');</script>
<style>body{font-family:Arial,Helvetica,sans-serif;width:960px;margin:0 auto;padding:24px;color:#222;line-height:1.5}nav a{margin-right:18px;color:#0b5394}footer{margin-top:40px;font-size:13px;color:#666}</style>
</head>
<body>
<header>
<h1>Hartwell Digital sample workshop</h1>
<nav>
<a href="${SAMPLE_PATH}">Home</a>
<a href="${SAMPLE_PATH}/canopies">Canopies</a>
<a href="${SAMPLE_PATH}/gallery">Gallery</a>
<a href="${SAMPLE_PATH}/contact">Contact</a>
</nav>
</header>
<main>
${body}
</main>
<footer>
<p>Call the workshop on ${SAMPLE_PHONE}. Caloundra QLD 4551.</p>
<p>Hartwell Digital, ABN 44 286 503 049. This is a sample page Hartwell Digital uses to test its own tools. It isn't a real workshop.</p>
</footer>
</body>
</html>
`;
}

export function samplePage(which: SamplePage): string {
  switch (which) {
    case "home":
      return page(
        "Canopies, trays and drawers",
        `<h2>Ute canopies, trays and drawer systems in Caloundra</h2>
<p>We build aluminium canopies, ute trays and drawer systems for tradies and tourers across the Sunshine Coast.</p>
<p>See our <a href="${SAMPLE_PATH}/canopies">canopies</a>, or ring the workshop on ${SAMPLE_PHONE} for a quote.</p>`,
      );
    case "canopies":
      return page(
        "Canopies",
        `<h2>Aluminium ute canopies</h2>
<p>Made to measure in our Caloundra workshop, with lift-up doors, roof racks and drawer systems to suit.</p>
<p>Most canopies are ready in three weeks. Call ${SAMPLE_PHONE} to book a measure-up.</p>`,
      );
    case "contact":
      return page(
        "Contact",
        `<h2>Contact the workshop</h2>
<p>Email us at <a href="mailto:${SAMPLE_EMAIL}">${SAMPLE_EMAIL}</a>, or call ${SAMPLE_PHONE}.</p>
<p>Open Monday to Friday, 7am to 4pm.</p>`,
      );
  }
}

export function sampleNotFound(): string {
  return page("Page not found", "<h2>Page not found</h2><p>That page isn't here.</p>");
}

export const SAMPLE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};
