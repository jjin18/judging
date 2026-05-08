export default function BackHome({ className = '' }) {
  return (
    <a
      href="/"
      className={`inline-flex items-center gap-1 text-sm text-ink-500 hover:text-accent-600 px-2 py-1 rounded touch-target ${className}`}
      aria-label="Back to home"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Home
    </a>
  );
}
