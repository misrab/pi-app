import { useCallback, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import type { Block } from "../hooks/useSession";
import { t } from "../lib/i18n";
import { SkeletonBubble } from "./Skeleton";
import { PiLogo } from "./PiLogo";
import styles from "./Transcript.module.css";

// Custom <pre> renderer — gives us a copy button without Streamdown's
// Tailwind-dependent code block chrome (which breaks without Tailwind).
function CodePre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = preRef.current?.querySelector("code")?.innerText ?? "";
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={styles.codeWrap}>
      <button className={`${styles.copyBtn} ${copied ? styles.copyDone : ""}`} onClick={copy}>
        {copied ? "✓" : "Copy"}
      </button>
      <pre ref={preRef} className={styles.codePre} {...props}>{children}</pre>
    </div>
  );
}

const markdownComponents = { pre: CodePre };

// Streamdown renders model markdown safely: images, tables, links, code
// (Shiki-highlighted), plus mermaid/math. parseIncompleteMarkdown keeps partial
// syntax (half-typed ```/**) from flickering mid-stream. urlTransform passthrough
// permits any image/link src (incl. data: URIs); tighten if untrusted content is
// ever rendered.
function StreamMarkdown({ text }: { text: string }) {
  return (
    <Streamdown
      parseIncompleteMarkdown
      animated={false}
      urlTransform={(url) => url}
      shikiTheme={["github-light", "github-dark"]}
      controls={false}
      components={markdownComponents}
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

// Distance from bottom (px) within which we consider the user "at the bottom".
const BOTTOM_THRESHOLD = 80;

export function Transcript({ blocks, streaming, initializing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Whether auto-scroll is active. Pauses when user scrolls up; resumes when
  // they scroll back down or a new user message starts a fresh turn.
  const autoScrollRef = useRef(true);
  const [, forceRender] = useState(0);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  // User manually scrolled — decide whether to pause or resume auto-scroll.
  const onScroll = useCallback(() => {
    const near = isNearBottom();
    if (autoScrollRef.current !== near) {
      autoScrollRef.current = near;
      forceRender((n) => n + 1); // re-render to show/hide the jump button
    }
  }, [isNearBottom]);

  // Re-enable auto-scroll when a new user message appears (fresh turn start).
  const lastRole = blocks[blocks.length - 1]?.kind;
  const prevLastRole = useRef(lastRole);
  useEffect(() => {
    if (lastRole === "user" && prevLastRole.current !== "user") {
      autoScrollRef.current = true;
    }
    prevLastRole.current = lastRole;
  }, [lastRole]);

  // Auto-scroll to bottom while enabled.
  useEffect(() => {
    if (autoScrollRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [blocks, streaming]);

  const jumpToBottom = useCallback(() => {
    autoScrollRef.current = true;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    forceRender((n) => n + 1);
  }, []);

  const showJump = !autoScrollRef.current;

  return (
    <div style={{ position: "relative" }}>
    <div
      ref={containerRef}
      className={styles.transcript}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={streaming}
      onScroll={onScroll}
    >
      {initializing && (
        <>
          <SkeletonBubble align="right" />
          <SkeletonBubble align="left" />
          <SkeletonBubble align="right" />
        </>
      )}
      {!initializing && blocks.length === 0 && <div className={styles.empty}>Start a conversation with pi.</div>}
      {blocks.map((b, i) => (
        <BlockView key={b.id} block={b} active={streaming && i === blocks.length - 1} />
      ))}
      {streaming && (() => {
        const last = blocks[blocks.length - 1]?.kind;
        return last !== "text" && last !== "thinking";
      })() && (
        <div className={styles.spinner}>…</div>
      )}
      <div ref={endRef} />
    </div>
    {showJump && (
      <button
        className={styles.jumpBtn}
        onClick={jumpToBottom}
        aria-label="Jump to latest"
      >
        ↓ Latest
      </button>
    )}
    </div>
  );
}

function BlockView({ block, active }: { block: Block; active?: boolean }) {
  switch (block.kind) {
    case "user": {
      const cls = [styles.bubble, styles.user, block.queued ? styles.userQueued : ""].filter(Boolean).join(" ");
      return (
        <div className={cls} role="article" aria-label="You">
          {block.imageUrls && block.imageUrls.length > 0 && (
            <div className={styles.userImages}>
              {block.imageUrls.map((url, i) => (
                <img key={i} src={url} alt="attachment" className={styles.userImage} />
              ))}
            </div>
          )}
          {block.text && <span>{block.text}</span>}
          {block.queued && (
            <span className={styles.queuedBadge} title={t("queuedBadge")}>
              <QueuedIcon /> {t("queuedBadge")}
            </span>
          )}
        </div>
      );
    }
    case "text":
      return (
        <div className={styles.assistantRow} role="article" aria-label="pi">
          <div className={styles.assistantMark} aria-hidden="true">
            <PiLogo size={18} />
          </div>
          <div className={styles.assistantBody}>
            <Markdown text={block.text} />
          </div>
        </div>
      );
    case "thinking":
      return (
        <div className={`${styles.thinkingWrap} ${active ? styles.thinkingActive : ""}`} role="status">
          <span className={styles.thinkingLabel}>{t("activityThinking")}</span>
          {block.text && (
            <div className={styles.thinkingBody}>
              <Markdown text={block.text} />
            </div>
          )}
        </div>
      );
    case "image":
      return <img src={block.url} alt="Generated image" className={styles.inlineImage} />;
    case "tool":
      return <ToolView block={block} />;
  }
}


function ToolView({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  return (
    <div className={`${styles.bubble} ${styles.tool}`}>
      <div className={styles.toolHead}>
        <span className={styles.toolName}>{block.name}</span>
        {!block.done && <span className={styles.toolPending}>{t("activityTool")}</span>}
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

function QueuedIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
