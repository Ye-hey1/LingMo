export function LingMoLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`lingmo-logo ${className}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" role="img" focusable="false">
        <rect width="40" height="40" rx="8" fill="currentColor" />
        <circle cx="20" cy="20" r="13" fill="white" />
        <circle cx="20" cy="20" r="5.3" fill="currentColor" />
        <path
          d="M20 7c7.18 0 13 5.82 13 13"
          fill="none"
          stroke="#F5A623"
          strokeLinecap="round"
          strokeWidth="2.8"
        />
      </svg>
    </span>
  )
}
