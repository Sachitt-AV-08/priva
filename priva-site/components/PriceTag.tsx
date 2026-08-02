export const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function PriceTag({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return <span className={`price-tag ${className}`.trim()}>{usd.format(value)}</span>;
}
