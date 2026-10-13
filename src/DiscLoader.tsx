export function DiscLoader({
  label,
  fullScreen = false,
}: {
  label: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      className={`disc-loader${fullScreen ? " disc-loader-screen" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-disc" aria-hidden="true">
        <span className="disc-label">
          <i />
        </span>
      </div>
      <div>
        <span className="eyebrow">FOYER</span>
        <p>{label}</p>
      </div>
    </div>
  );
}
