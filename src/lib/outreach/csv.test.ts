import { test } from "node:test";
import assert from "node:assert/strict";
import { keysFromCsv, parseCsv } from "./csv.ts";

test("CSV: quotes, commas and line breaks inside quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\nlast,,\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "two\nlines"],
    ["last", "", ""],
  ]);
});

test("the Ironpeak register's columns are read: company, website_domain, email", () => {
  const csv = [
    "company,website_domain,email,contact,campaign,status",
    "Catten Industries,catten.com.au,sales@catten.com.au,Ian Cubitt,test,sent",
    "DVR Engineering,dvrengineering.com.au,,Mike Nikol,test,sent",
  ].join("\n");
  const r = keysFromCsv(csv);
  assert.equal(r.problem, undefined);
  assert.equal(r.rows, 2);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.columns, { domain: "website_domain", email: "email", name: "company" });
  assert.deepEqual(
    r.keys.map((k) => `${k.kind}:${k.value}`).sort(),
    [
      "domain:catten.com.au",
      "domain:dvrengineering.com.au",
      "email:sales@catten.com.au",
      "name:cattenindustries",
      "name:dvrengineering",
    ],
  );
});

test("a business column wins over a person's name column", () => {
  const r = keysFromCsv("name,business,email\nIan Cubitt,Catten Industries,ian@catten.com.au\n");
  assert.equal(r.columns.name, "business");
  assert.ok(r.keys.some((k) => k.kind === "name" && k.value === "cattenindustries"));
  assert.ok(!r.keys.some((k) => k.value === "iancubitt"));
});

test("rows with nothing usable are counted, not guessed at", () => {
  const r = keysFromCsv("email,business\nnot-an-email,\n,A\nsam@gmail.com,\n");
  assert.equal(r.rows, 3);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.keys.map((k) => `${k.kind}:${k.value}`), ["email:sam@gmail.com"]);
});

test("a file without a usable column is refused with a reason", () => {
  assert.ok(keysFromCsv("contact,notes\nIan,hello\n").problem);
  assert.ok(keysFromCsv("domain\n").problem);
  assert.ok(keysFromCsv("").problem);
});
