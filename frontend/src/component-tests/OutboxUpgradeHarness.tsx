import { useEffect, useState } from "react";
import { runOutboxUpgradeSuite } from "../db/outboxUpgradeHarness";

export default function OutboxUpgradeHarness() {
  const [status, setStatus] = useState("pending");
  useEffect(() => {
    void runOutboxUpgradeSuite()
      .then((result) => setStatus(result.ok ? "ok" : `fail:${result.notes.join("|")}`))
      .catch((error: Error) => setStatus(`fail:${error.message}`));
  }, []);
  return (
    <div>
      <div data-testid="outbox-upgrade">{status}</div>
    </div>
  );
}
