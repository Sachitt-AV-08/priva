import Link from "next/link";

type LogoProps = {
  href?: string;
  size?: "small" | "medium" | "large";
  compact?: boolean;
  className?: string;
};

export default function Logo({
  href = "/",
  size = "medium",
  compact = false,
  className = "",
}: LogoProps) {
  return (
    <Link
      href={href}
      className={`brand-logo brand-logo-${size} ${className}`.trim()}
      aria-label="PRIVA home"
    >
      <span className="brand-logo-mark" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-logo-image" src="/priva/priva.png" alt="" />
      </span>
      {!compact && <span className="brand-wordmark">PRIVA</span>}
    </Link>
  );
}
