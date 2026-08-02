import React from "react";

export function Logo({ size = "medium", wordmark = true }: {
  size?: "small" | "medium" | "large";
  wordmark?: boolean;
}) {
  return (
    <span className={`priva-logo priva-logo-${size}`} aria-label="PRIVA">
      <span className="priva-logo-mark" aria-hidden="true">
        <img src="./priva.png" alt="" />
      </span>
      {wordmark && <span className="priva-wordmark">PRIVA</span>}
    </span>
  );
}
