import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import type { Block } from "../hooks/useSession";
import { SkeletonBubble } from "./Skeleton";
import styles from "./Transcript.module.css";

// Streamdown renders model markdown safely: images, tables, links, code
// (Shiki-highlighted), plus mermaid/math. parseIncompleteMarkdown keeps partial
// syntax (half-typed ```/**) from flickering mid-stream. urlTransform passthrough
// permits any image/link src (incl. data: URIs); tighten if untrusted content is
// ever rendered.
function StreamMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      parseIncompleteMarkdown
      urlTransform={(url) => url}
      shikiTheme={["github-light", "github-dark"]}
      className={styles.markdown}
    >
      {text}
    </Streamdown>
  );
}

// Self-contained ```html / ```svg fences render as sandboxed-iframe artifacts;
// ```mermaid fences render as client-side SVG diagrams. Only CLOSED fences match,
// so a still-streaming block stays a normal code block until complete, then flips
// to its rich rendering (this also avoids mid-stream re-mend scrambling).
const BLOCK_RE = /```(html|svg|mermaid)\s*\n([\s\S]*?)```/g;

// Markdown splits text into ordered segments of plain markdown and rich blocks
// (artifacts/diagrams), rendering each in place so prose and visuals interleave.
function Markdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BLOCK_RE)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push(<StreamMarkdown key={`md${i}`} text={text.slice(last, start)} />);
    }
    const lang = m[1];
    if (lang === "mermaid") {
      parts.push(<Mermaid key={`mer${i}`} code={m[2]} />);
    } else {
      parts.push(<Artifact key={`art${i}`} lang={lang as "html" | "svg"} code={m[2]} />);
    }
    last = start + m[0].length;
    i++;
  }
  if (last < text.length) {
    parts.push(<StreamMarkdown key={`md${i}`} text={text.slice(last)} />);
  }
  return <>{parts}</>;
}

// Mermaid renders a diagram to SVG client-side. mermaid is lazy-imported so its
// weight only loads when a diagram actually appears. securityLevel "strict"
// sanitizes the generated SVG (mitigates the known mermaid label XSS).
function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const id = "m" + Math.random().toString(36).slice(2);
        const { svg } = await mermaid.render(id, code);
        if (alive) setSvg(svg);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);
  if (error)
    return (
      <pre className={styles.artifactCode}>
        mermaid error: {error}
        {"\n\n"}
        {code}
      </pre>
    );
  if (!svg) return <pre className={styles.artifactCode}>{code}</pre>;
  return <div className={styles.mermaid} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Artifact renders a self-contained HTML/SVG document in a sandboxed iframe
// (allow-scripts WITHOUT allow-same-origin, so it cannot reach the parent
// origin, cookies, or storage). A toggle reveals the raw source.
function Artifact({ lang, code }: { lang: "html" | "svg"; code: string }) {
  const [showCode, setShowCode] = useState(false);
  const srcDoc =
    lang === "svg"
      ? `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;display:grid;place-items:center;background:#fff}</style>${code}`
      : code;
  return (
    <div className={styles.artifact}>
      <div className={styles.artifactHead}>
        <span className={styles.artifactLabel}>{lang.toUpperCase()} preview</span>
        <button className={styles.artifactToggle} onClick={() => setShowCode((s) => !s)}>
          {showCode ? "Preview" : "Code"}
        </button>
      </div>
      {showCode ? (
        <pre className={styles.artifactCode}>{code}</pre>
      ) : (
        <iframe
          className={styles.artifactFrame}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={`${lang} artifact`}
        />
      )}
    </div>
  );
}

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
      return (
        <div className={`${styles.bubble} ${styles.assistant}`}>
          <Markdown text={block.text} />
        </div>
      );
    case "thinking":
      return (
        <div className={`${styles.bubble} ${styles.thinking}`}>
          <Markdown text={block.text} />
        </div>
      );
    case "image":
      return <img src={block.url} alt="" className={styles.inlineImage} />;
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
