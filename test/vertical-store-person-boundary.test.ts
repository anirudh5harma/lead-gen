import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresVerticalSliceStore } from "../core/plays/vertical-store.ts";

test("postgres vertical store normalizes raw Postgres array literal emails", async () => {
  const personId = randomUUID();
  const now = new Date("2026-07-27T12:00:00Z");
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: personId,
            workspace_id: randomUUID(),
            full_name: "Anne Brown",
            given_name: "Anne",
            family_name: "Brown",
            title: "CEO",
            company_id: randomUUID(),
            emails: "{anne@example.com,anne@acme.example}",
            phones: "{}",
            linkedin_url: "https://www.linkedin.com/in/anne-brown",
            x_handle: null,
            properties: {},
            provenance: {},
            embedded_at: null,
            created_at: now,
            updated_at: now,
          },
        ],
      };
    },
  };
  const store = createPostgresVerticalSliceStore(pool as never);

  const person = await store.getPerson(personId);

  assert.deepEqual(person?.emails, ["anne@example.com", "anne@acme.example"]);
  assert.deepEqual(person?.phones, []);
});
