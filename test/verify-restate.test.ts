import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRestateDeployments } from "../scripts/verify-restate.ts";

test("verify-restate summarizes deployment URIs and missing services", () => {
  const summary = summarizeRestateDeployments(
    {
      deployments: [
        {
          id: "dp_old",
          uri: "https://old-worker.example.com/",
          services: [
            { name: "series_a_cold_open" },
            { name: "ingest_workspace_poll" },
          ],
        },
      ],
    },
    [
      "series_a_cold_open",
      "play.signal_to_email.v1",
      "ingest_workspace_poll",
    ],
  );

  assert.deepEqual(summary.deployments, [
    {
      id: "dp_old",
      uri: "https://old-worker.example.com/",
      services: ["ingest_workspace_poll", "series_a_cold_open"],
      missingRequiredServices: ["play.signal_to_email.v1"],
    },
  ]);
  assert.deepEqual(summary.services, ["ingest_workspace_poll", "series_a_cold_open"]);
  assert.deepEqual(summary.missing, ["play.signal_to_email.v1"]);
  assert.deepEqual(summary.incompleteRequiredDeployments, [
    {
      id: "dp_old",
      uri: "https://old-worker.example.com/",
      services: ["ingest_workspace_poll", "series_a_cold_open"],
      missingRequiredServices: ["play.signal_to_email.v1"],
    },
  ]);
});

test("verify-restate flags stale partial workflow deployments even when union coverage passes", () => {
  const summary = summarizeRestateDeployments(
    {
      deployments: [
        {
          id: "dp_new",
          uri: "https://new-worker.example.com/",
          services: [
            { name: "series_a_cold_open" },
            { name: "play.signal_to_email.v1" },
            { name: "ingest_workspace_poll" },
          ],
        },
        {
          id: "dp_old",
          uri: "https://old-worker.example.com/",
          services: [
            { name: "series_a_cold_open" },
            { name: "ingest_workspace_poll" },
          ],
        },
      ],
    },
    [
      "series_a_cold_open",
      "play.signal_to_email.v1",
      "ingest_workspace_poll",
    ],
  );

  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.incompleteRequiredDeployments, [
    {
      id: "dp_old",
      uri: "https://old-worker.example.com/",
      services: ["ingest_workspace_poll", "series_a_cold_open"],
      missingRequiredServices: ["play.signal_to_email.v1"],
    },
  ]);
});
