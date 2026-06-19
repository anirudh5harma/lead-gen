(function () {
  "use strict";

  var script = document.currentScript;
  var sourceId = script && script.getAttribute("data-source-id");
  if (!sourceId) return;

  var endpoint =
    (script && script.getAttribute("data-endpoint")) ||
    new URL("/api/collect/visitors", script.src).toString();
  var provider =
    (script && script.getAttribute("data-provider")) || "bombsell_script";
  var loadedAt = Date.now();
  var maxScroll = 0;
  var sent = false;

  function identity() {
    var globalIdentity = window.bombsellIdentity || {};
    return {
      company_name:
        globalIdentity.company_name ||
        (script && script.getAttribute("data-company-name")) ||
        undefined,
      company_domain:
        globalIdentity.company_domain ||
        (script && script.getAttribute("data-company-domain")) ||
        undefined,
      person_name: globalIdentity.person_name || undefined,
      title: globalIdentity.title || undefined,
      email: globalIdentity.email || undefined,
      linkedin_url: globalIdentity.linkedin_url || undefined,
      industry: globalIdentity.industry || undefined,
      headcount: globalIdentity.headcount || undefined,
      funding_stage: globalIdentity.funding_stage || undefined,
      intent_score: numberOrUndefined(globalIdentity.intent_score),
    };
  }

  function consent() {
    var globalConsent = window.bombsellConsent || {};
    return {
      marketing_allowed: booleanOrUndefined(
        globalConsent.marketing_allowed,
        script && script.getAttribute("data-marketing-allowed"),
      ),
      privacy_disclosed: booleanOrUndefined(
        globalConsent.privacy_disclosed,
        script && script.getAttribute("data-privacy-disclosed"),
      ),
      do_not_track:
        globalConsent.do_not_track === true ||
        navigator.doNotTrack === "1" ||
        window.doNotTrack === "1",
      record_id: globalConsent.record_id || undefined,
      source: globalConsent.source || "website",
      timestamp: new Date().toISOString(),
      region: globalConsent.region || undefined,
    };
  }

  function repeatVisits() {
    try {
      var key = "bombsell:visits:" + location.hostname;
      var count = Number(localStorage.getItem(key) || "0") + 1;
      localStorage.setItem(key, String(count));
      return count;
    } catch (_err) {
      return undefined;
    }
  }

  var visits = repeatVisits();

  function updateScroll() {
    var doc = document.documentElement;
    var scrollTop = window.scrollY || doc.scrollTop || 0;
    var scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
    maxScroll = Math.max(maxScroll, Math.min(1, scrollTop / scrollable));
  }

  function payload() {
    updateScroll();
    return Object.assign(
      {
        source_id: sourceId,
        provider: provider,
        external_id:
          provider + ":" + location.href + ":" + new Date().toISOString().slice(0, 13),
        page_url: location.href,
        referrer: document.referrer || undefined,
        visited_at: new Date().toISOString(),
        dwell_time_seconds: Math.max(0, Math.round((Date.now() - loadedAt) / 1000)),
        scroll_depth: maxScroll,
        repeat_visits: visits,
        pages: [location.pathname + location.search],
        weighted_pages: [
          {
            path: location.pathname + location.search,
            url: location.href,
            dwell_time_seconds: Math.max(
              0,
              Math.round((Date.now() - loadedAt) / 1000),
            ),
            scroll_depth: maxScroll,
            visited_at: new Date().toISOString(),
          },
        ],
        consent: consent(),
        provenance: {
          adapter: "browser_collector",
          source: "visitor_deanonymization",
          page_title: document.title || undefined,
        },
      },
      identity(),
    );
  }

  function send() {
    if (sent) return;
    sent = true;
    var body = JSON.stringify(payload());
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "text/plain" });
      if (navigator.sendBeacon(endpoint, blob)) return;
    }
    fetch(endpoint, {
      method: "POST",
      body: body,
      headers: { "content-type": "text/plain" },
      keepalive: true,
      credentials: "omit",
    }).catch(function () {});
  }

  function numberOrUndefined(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function booleanOrUndefined(primary, fallback) {
    if (typeof primary === "boolean") return primary;
    if (fallback === "true") return true;
    if (fallback === "false") return false;
    return undefined;
  }

  window.bombsell = window.bombsell || function (command, data) {
    if (command === "identify") {
      window.bombsellIdentity = Object.assign(window.bombsellIdentity || {}, data || {});
    }
    if (command === "consent") {
      window.bombsellConsent = Object.assign(window.bombsellConsent || {}, data || {});
    }
    if (command === "track") send();
  };

  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("pagehide", send);
  window.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") send();
  });
  window.setTimeout(send, 15000);
})();
