import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePublicHostname,
  normalizePublicHttpUrl,
  publicHostMatches,
} from "../lib/network/public-url.ts";

test("public URL helper normalizes public http urls", () => {
  assert.equal(normalizePublicHttpUrl("bombsell.com"), "https://bombsell.com");
  assert.equal(
    normalizePublicHttpUrl("https://www.bombsell.com/#top"),
    "https://bombsell.com",
  );
});

test("public URL helper rejects localhost and private network urls", () => {
  assert.equal(normalizePublicHttpUrl("localhost:3000"), null);
  assert.equal(normalizePublicHttpUrl("http://127.0.0.1:8080"), null);
  assert.equal(normalizePublicHttpUrl("http://10.0.0.12"), null);
  assert.equal(normalizePublicHttpUrl("http://169.254.169.254"), null);
  assert.equal(normalizePublicHttpUrl("http://[::1]"), null);
  assert.equal(normalizePublicHttpUrl("ftp://bombsell.com"), null);
});

test("public hostname helper normalizes public domains and blocks internal ones", () => {
  assert.equal(normalizePublicHostname("https://www.bombsell.com"), "bombsell.com");
  assert.equal(normalizePublicHostname("api.bombsell.com"), "api.bombsell.com");
  assert.equal(normalizePublicHostname("localhost"), null);
  assert.equal(normalizePublicHostname("10.0.0.8"), null);
  assert.equal(normalizePublicHostname("internal.local"), null);
});

test("public host matcher allows exact domains and subdomains", () => {
  assert.equal(publicHostMatches("bombsell.com", "bombsell.com"), true);
  assert.equal(publicHostMatches("docs.bombsell.com", "bombsell.com"), true);
  assert.equal(publicHostMatches("evilbombsell.com", "bombsell.com"), false);
});
