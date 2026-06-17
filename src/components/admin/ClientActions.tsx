"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setClientStatus,
  deleteClient,
  restoreClient,
} from "@/app/admin/clients/actions";
import { Button } from "@/components/ui/Button";

const DELETE_WARNING = (name: string) =>
  `Delete ${name}?\n\nThey'll move to "Recently deleted" — you can restore them for 30 days, after which their portal data is permanently removed. Their invoices are always kept.`;

export function ClientActions({
  clientId,
  clientName,
  section,
}: {
  clientId: string;
  clientName: string;
  section: "active" | "inactive" | "deleted";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }
  function confirmDelete() {
    if (window.confirm(DELETE_WARNING(clientName))) {
      run(() => deleteClient(clientId));
    }
  }

  if (section === "deleted") {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => run(() => restoreClient(clientId))}
      >
        Restore
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {section === "active" ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setClientStatus(clientId, "paused"))}
        >
          Make inactive
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setClientStatus(clientId, "active"))}
        >
          Reactivate
        </Button>
      )}
      <Button variant="danger" size="sm" disabled={pending} onClick={confirmDelete}>
        Delete
      </Button>
    </div>
  );
}
