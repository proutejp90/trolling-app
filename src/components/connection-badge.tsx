"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

/** Shows "Offline" in the top bar while the device has no connection. Hidden when online. */
export function ConnectionBadge() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const read = () => setOffline(!navigator.onLine);
    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => { window.removeEventListener("online", read); window.removeEventListener("offline", read); };
  }, []);
  return <span role="status">{offline ? <Badge tone="warning" icon={WifiOff}>Offline</Badge> : null}</span>;
}
