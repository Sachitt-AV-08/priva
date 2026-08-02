export default function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-label={label}>
      <span className="spinner" aria-hidden="true" />
    </span>
  );
}
