import { useEffect, useRef } from "react";
import type { Block } from "../hooks/useSession";
import { SkeletonBubble } from "./Skeleton";
import styles from "./Transcript.module.css";

interface Props {
  blocks: Block[];
  streaming: boolean;
  initializing: boolean;
}

export function Transcript({ blocks, streaming, initializing }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as content streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [blocks, streaming]);

  return (
    <div className={styles.transcript}>
      {initializing && (
        <>
          <SkeletonBubble align="right" />
          <SkeletonBubble align="left" />
          <SkeletonBubble align="right" />
        </>
      )}
      {!initializing && blocks.length === 0 && <div className={styles.empty}>Start a conversation with pi.</div>}
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
      {streaming && blocks[blocks.length - 1]?.kind !== "text" && (
        <div className={styles.spinner}>…</div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "user":
      return <div className={`${styles.bubble} ${styles.user}`}>{block.text}</div>;
    case "text":
      return <div className={`${styles.bubble} ${styles.assistant}`}>{block.text}</div>;
    case "thinking":
      return <div className={`${styles.bubble} ${styles.thinking}`}>{block.text}</div>;
    case "tool":
      return <ToolView block={block} />;
  }
}

function ToolView({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  return (
    <div className={`${styles.bubble} ${styles.tool}`}>
      <div className={styles.toolHead}>
        <span className={styles.toolName}>{block.name}</span>
        {!block.done && <span className={styles.toolPending}>running…</span>}
      </div>
      <pre className={styles.toolArgs}>{JSON.stringify(block.args, null, 2)}</pre>
      {block.result !== undefined && (
        <pre className={`${styles.toolResult} ${block.isError ? styles.toolError : ""}`}>
          {block.result || "(no output)"}
        </pre>
      )}
    </div>
  );
}
