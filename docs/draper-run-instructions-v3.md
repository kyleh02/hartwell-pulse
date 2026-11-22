Draper plan 2 (22 November 2026). Every business needs live Google or Meta ads, shown by the ad libraries, and one fault Pulse measured on its website. Two steps each morning: the cloud run finds and measures; the browser step checks ads, writes and submits.

A. THE CLOUD RUN (5:30am, no browser)
1. Call outreach_brief, then outreach_ads_queue. Work only in the active lane. Aim to leave three businesses waiting for the ads check for every email the target still needs (count the ones already waiting), then stop; also stop after reading 8 sites for each business you're aiming to add (never more than 200 sites). If the target is 0, only label replies.
2. Find businesses with web search: the lane's services plus each suburb. Favour ones likely to advertise: sponsored results, online booking or quote forms, specials, more than one location, hiring. A directory or listing site may be used only to find a business's name; then search for its own site and read that. No site of its own: skip it.
3. Check each one with outreach_check_business. Blocked: move on.
4. Read their own site. Confirm they do the lane's work in the area and note their main services. Find a published email on their own site: never guess one, build one from a pattern, or take one from a directory or finder tool; skip it if a "no marketing" note sits near it. Prefer a named owner's address.
5. Check the ABN on ABN Lookup (abr.business.gov.au), from their site or their name, state and postcode. Keep them only if the ABN is active, certainly theirs, and registered for GST (the Goods & Services Tax line shows "Registered from" a date). Pass abn_status and gst_registered.
6. outreach_add_prospect, then outreach_measure on the home page and the main service page (the page their ads most likely send people to). Neither page has a fault: outreach_drop with "no faults".
7. Never submit in the cloud run: the ads check needs a browser. Leave measured businesses waiting; the browser step takes them.
8. Label replies: outreach_replies_to_label, then outreach_label_reply for each whose meaning is plain.
9. outreach_finish_run with sites read, skipped before adding by reason, added, measured, submitted (0), dropped by reason. Then a two-line summary: sites read, left waiting for the ads check, dropped by reason.

B. THE BROWSER STEP (Kyle's computer, after the cloud run)
1. Call outreach_brief, then outreach_ads_queue. Work best first, and stop when the target is met.
2. For each business, in the browser: open its meta search, wait for the results, copy the page's visible text (document.body.innerText) and call outreach_record_ads with platform meta. Open its google search, copy the text and record it; if it lists ads, open up to three of them to find the latest "Last shown", and record with that ad's address as ad_url and its text as ad_text. Never click an ad. Never sign in, and never get past a login page or a captcha: if either appears, stop the step and say so.
3. Neither library shows live ads pointing to their website: outreach_drop with "no live ads". GST unknown: check ABN Lookup first; not registered: drop with "not registered for GST".
4. Live ads: write the slots by the template's slot rules, about the best-ranked fault on record, and call outreach_submit with the template_version from the brief. One fault on record: leave second_finding empty (no follow-up). Refused: fix it once; refused again: drop it.
5. outreach_finish_run with libraries opened as sites read, and how many were checked, submitted and dropped by reason. Then a two-line summary: checked, live, submitted, dropped by reason.
