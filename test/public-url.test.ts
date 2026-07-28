import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicIpAddress,
  normalizePublicHostname,
  normalizePublicHttpUrl,
  publicHostMatches,
} from "../lib/network/public-url.ts";
import {
  normalizeWebsiteInputUrl,
  PUBLIC_WEBSITE_INPUT_PATTERN,
} from "../lib/network/website-input.ts";

test("public website input pattern accepts pasted URLs and rejects malformed domains", () => {
  const pattern = new RegExp(`^(?:${PUBLIC_WEBSITE_INPUT_PATTERN})$`, "v");
  for (const value of [
    "bombsell.com",
    "HTTPS://BOMBSELL.COM",
    "https://bombsell.com/pricing?utm=launch",
    "docs.bombsell.com",
    "bombsell.com:65535",
    "bombsell.com.",
    "münich.com",
    "xn--mnich-kva.com",
  ]) {
    assert.equal(pattern.test(value), true, `expected ${value} to be accepted`);
  }
  for (const value of [
    "foo..com",
    "foo_.com",
    "foo-.com",
    "localhost",
    "foo.local",
    "HTTPS://FOO.INTERNAL/path",
    "foo.localhost",
    "foo.internal.:443",
    "foo.local.:80/path",
    "bombsell.com:65536",
    "foo.xn--ab-",
    "https://user:password@bombsell.com",
  ]) {
    assert.equal(pattern.test(value), false, `expected ${value} to be rejected`);
  }
});

test("website input normalization matches browser validation boundaries", () => {
  assert.equal(normalizeWebsiteInputUrl("bombsell.com:65535"), "https://bombsell.com:65535");
  assert.equal(normalizeWebsiteInputUrl("bombsell.com."), "https://bombsell.com");
  assert.equal(normalizeWebsiteInputUrl("münich.com"), "https://xn--mnich-kva.com");
  assert.equal(normalizeWebsiteInputUrl("xn--mnich-kva.com"), "https://xn--mnich-kva.com");
  assert.equal(normalizeWebsiteInputUrl(`${"ü".repeat(63)}.com`), null);
  for (const value of [
    "foo.local",
    "HTTPS://FOO.INTERNAL/path",
    "foo.localhost",
    "foo.internal.:443",
    "foo.local.:80/path",
    "bombsell.com:65536",
    "foo.xn--ab-",
    "https://user:password@bombsell.com",
  ]) {
    assert.equal(normalizeWebsiteInputUrl(value), null, `expected ${value} to be rejected`);
  }
});

test("public URL helper normalizes public http urls", () => {
  assert.equal(normalizePublicHttpUrl("bombsell.com"), "https://bombsell.com");
  assert.equal(
    normalizePublicHttpUrl("HTTPS://BOMBSELL.COM/pricing?utm=launch#top"),
    "https://bombsell.com/pricing?utm=launch",
  );
  assert.equal(
    normalizePublicHttpUrl("https://www.bombsell.com/#top"),
    "https://bombsell.com",
  );
});

test("public URL helper rejects localhost and private network urls", () => {
  assert.equal(normalizePublicHttpUrl("foo..com"), null);
  assert.equal(normalizePublicHttpUrl("foo_.com"), null);
  assert.equal(normalizePublicHttpUrl("foo-.com"), null);
  assert.equal(normalizePublicHttpUrl("localhost:3000"), null);
  assert.equal(normalizePublicHttpUrl("http://127.0.0.1:8080"), null);
  assert.equal(normalizePublicHttpUrl("http://10.0.0.12"), null);
  assert.equal(normalizePublicHttpUrl("http://169.254.169.254"), null);
  assert.equal(normalizePublicHttpUrl("http://[::1]"), null);
  assert.equal(normalizePublicHttpUrl("ftp://bombsell.com"), null);
});

test("public IP classification blocks non-routable IPv4 and IPv6 ranges", () => {
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
  ]) {
    assert.equal(isPublicIpAddress(address), true, `expected ${address} to be public`);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "198.18.0.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b:1::a9fe:a9fe",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ]) {
    assert.equal(
      isPublicIpAddress(address),
      false,
      `expected ${address} to be non-public`,
    );
  }
});

test("public hostname helper normalizes public domains and blocks internal ones", () => {
  assert.equal(normalizePublicHostname("https://www.bombsell.com"), "bombsell.com");
  assert.equal(normalizePublicHostname("api.bombsell.com"), "api.bombsell.com");
  assert.equal(normalizePublicHostname("foo..com"), null);
  assert.equal(normalizePublicHostname("foo_.com"), null);
  assert.equal(normalizePublicHostname("foo-.com"), null);
  assert.equal(normalizePublicHostname("localhost"), null);
  assert.equal(normalizePublicHostname("10.0.0.8"), null);
  assert.equal(normalizePublicHostname("internal.local"), null);
});

test("public host matcher allows exact domains and subdomains", () => {
  assert.equal(publicHostMatches("bombsell.com", "bombsell.com"), true);
  assert.equal(publicHostMatches("docs.bombsell.com", "bombsell.com"), true);
  assert.equal(publicHostMatches("evilbombsell.com", "bombsell.com"), false);
});
