/**
 * The Bellhop wordmark: display lettering in the brand face, with the "o" drawn as a bell whose
 * clapper hangs below the baseline like a descender. One element, one accessible name.
 */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wm" role="img" aria-label="Bellhop" style={{ fontSize: size }}>
      <span aria-hidden="true">Bellh</span>
      <svg className="wm-bell" viewBox="10 0 80 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="6" />
        <path d="M50 14 C31 14 27 33 27 55 C27 66 22 72 17 78 L83 78 C78 72 73 66 73 55 C73 33 69 14 50 14 Z" fill="currentColor" />
        <circle cx="50" cy="89" r="7" fill="currentColor" />
      </svg>
      <span aria-hidden="true">p</span>
    </span>
  );
}
