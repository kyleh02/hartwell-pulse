"use client";

import { useState, useTransition } from "react";
import { decideConnector } from "@/app/oauth/authorize/actions";
import type { AuthorizeParams } from "@/lib/mcp/oauth";
import { Button } from "@/components/ui/Button";

/** Allow or Cancel. Either way the browser goes back to Claude with the answer. */
export function ConnectorConsent({ params }: { params: AuthorizeParams }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(allow: boolean) {
    setError(null);
    start(async () => {
      const res = await decideConnector(params, allow);
      if ("url" in res) window.location.assign(res.url);
      else setError(res.message);
    });
  }

  return (
    <div>
      {error && <p className="mb-4 text-sm text-pulse-danger">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => decide(true)} disabled={pending}>
          {pending ? "Connecting…" : "Allow"}
        </Button>
        <Button variant="secondary" onClick={() => decide(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
