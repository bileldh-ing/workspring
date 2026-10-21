/** Original WorkSpring mark: a rising coil (spring) inside a rounded square, plus wordmark. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="#1f4fd1" />
        <path d="M9 22c3.5 0 3.5-4 7-4s3.5 4 7 4M9 16c3.5 0 3.5-4 7-4s3.5 4 7 4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="23" cy="9" r="2.6" fill="#34d399" />
      </svg>
      {compact ? null : <span className="text-lg font-extrabold tracking-tight text-ink">Work<span className="text-brand">Spring</span></span>}
    </span>
  );
}
