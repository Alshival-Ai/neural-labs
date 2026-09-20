import { useEffect, useState } from "react";
import { settingsRequest } from "./settingsApi";

export function UpdateNotice() {
  const [maintenance, setMaintenance] = useState(false);
  useEffect(() => {
    const poll = () => void settingsRequest<{ maintenance: boolean }>("/api/updates/maintenance").then(r => setMaintenance(r.maintenance)).catch(() => undefined);
    poll(); const timer = window.setInterval(poll, 5000); return () => window.clearInterval(timer);
  }, []);
  return maintenance ? <div className="workspace-update-notice" role="status">Workspace maintenance is in progress. Your files are preserved; access will return after verification.</div> : null;
}
