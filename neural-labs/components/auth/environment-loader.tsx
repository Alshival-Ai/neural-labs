interface EnvironmentLoaderProps {
  label?: string;
}

export function EnvironmentLoader({
  label = "Provisioning your workspace",
}: EnvironmentLoaderProps) {
  return (
    <div className="nl-provision-loader" aria-live="polite">
      <div className="nl-provision-loader__backdrop" />
      <section
        className="nl-provision-loader__card"
        role="status"
        aria-label="Preparing environment"
      >
        <div className="nl-provision-loader__logo" aria-hidden="true">
          <div className="nl-provision-loader__logo-mark">
            <span>N</span>
            <span>L</span>
          </div>
        </div>
        <div className="nl-provision-loader__wordmark">Neural Labs</div>
        <div className="nl-provision-loader__label">{label}</div>
        <div className="nl-provision-loader__track" aria-hidden="true">
          <div className="nl-provision-loader__bar" />
        </div>
      </section>
    </div>
  );
}
