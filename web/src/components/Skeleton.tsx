import styles from "./Skeleton.module.css";

interface Props {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

/** A shimmer skeleton block. Use for any loading placeholder. */
export function Skeleton({ width = "100%", height = "1em", radius = "6px", className }: Props) {
  return (
    <div
      className={`${styles.skeleton} ${className ?? ""}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}

/** A stack of skeleton lines mimicking text content. */
function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ["85%", "100%", "70%", "90%", "60%"];
  return (
    <div className={styles.text}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={widths[i % widths.length]} height="0.85em" />
      ))}
    </div>
  );
}

/** A skeleton that looks like a chat bubble. */
export function SkeletonBubble({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div className={`${styles.bubble} ${align === "right" ? styles.right : styles.left}`}>
      <SkeletonText lines={2} />
    </div>
  );
}
