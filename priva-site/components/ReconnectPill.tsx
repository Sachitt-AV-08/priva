"use client";

import { RefreshCw } from "lucide-react";
import { useBackendStatus } from "../lib/backend";

export default function ReconnectPill() {
  const { reconnecting } = useBackendStatus();

  return (
    <span
      className={`reconnect-pill${reconnecting ? " reconnect-pill-visible" : ""}`}
      aria-live="polite"
      aria-hidden={!reconnecting}
    >
      <RefreshCw size={12} aria-hidden="true" />
      Reconnecting...
    </span>
  );
}
