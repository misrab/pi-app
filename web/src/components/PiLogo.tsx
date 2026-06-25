/**
 * Shared π logo mark — used in the Header and as the assistant avatar in the
 * Transcript. Draw as geometric SVG paths so it scales cleanly at any size.
 */
interface Props {
  size?: number;
}

export function PiLogo({ size = 20 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      {/* horizontal bar */}
      <line
        x1="2.5" y1="5"
        x2="17.5" y2="5"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      {/* left leg — straight down */}
      <line
        x1="6.5" y1="5"
        x2="6.5" y2="16"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      {/* right leg — curls left at the bottom (classic π) */}
      <path
        d="M13.5 5 L13.5 13 Q13.5 16.5 10.5 16.5"
        stroke="var(--accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
