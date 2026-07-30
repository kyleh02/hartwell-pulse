"use client";

import { useMemo, useState } from "react";
import { ListSwitcher } from "@/components/crm/ListSwitcher";
import { ProspectTable, StageStrip } from "@/components/crm/ProspectTable";
import { stageCounts, type ProspectRow } from "@/lib/crm";
import type { CrmList } from "@/lib/types/database";

/**
 * Holds which source list is being worked, so the stage counts and the table
 * below describe that list rather than an average across all of them. Reply
 * rates from a grant list and a cold trade-show list are different numbers and
 * averaging them tells you nothing useful.
 */
export function PipelineView({
  lists,
  rows,
}: {
  lists: (CrmList & { count: number })[];
  rows: ProspectRow[];
}) {
  const [selected, setSelected] = useState<string | "all">(
    lists.length === 1 ? lists[0].id : "all",
  );

  const visible = useMemo(
    () => (selected === "all" ? rows : rows.filter((r) => r.list_id === selected)),
    [rows, selected],
  );

  return (
    <div className="space-y-4">
      <ListSwitcher lists={lists} selected={selected} onSelect={setSelected} />
      <div>
        <StageStrip counts={stageCounts(visible)} />
        <ProspectTable rows={visible} />
      </div>
    </div>
  );
}
