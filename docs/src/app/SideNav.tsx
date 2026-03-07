"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import * as Motion from "../components/Motion";
import { TOC } from "../components/TOC";
import { navIcons } from "./components/NavIcons";

function TerminalLogo() {
  return (
    <span className="terminal-logo-window">
      <span className="terminal-logo-dots">
        <span className="terminal-logo-dot" />
        <span className="terminal-logo-dot" />
        <span className="terminal-logo-dot" />
      </span>
      <span className="terminal-logo-prompt">_</span>
    </span>
  );
}

const links: {
  href: string;
  label: string;
  items?: { id: string; text: string }[];
}[] = [
  { href: "/", label: "Overview" },
  {
    href: "/getting-started",
    label: "Getting Started",
    items: [
      { id: "installation", text: "Installation" },
      { id: "basic-setup", text: "Basic Setup" },
      { id: "agentic-loop", text: "Agentic Loop" },
    ],
  },
  {
    href: "/tools",
    label: "Tools",
    items: [
      { id: "bash", text: "Bash" },
      { id: "read", text: "Read" },
      { id: "write", text: "Write" },
      { id: "edit", text: "Edit" },
      { id: "glob", text: "Glob" },
      { id: "grep", text: "Grep" },
      { id: "websearch", text: "WebSearch" },
      { id: "webfetch", text: "WebFetch" },
      { id: "task", text: "Task" },
      { id: "todowrite", text: "TodoWrite" },
    ],
  },
  {
    href: "/sandboxes",
    label: "Sandboxes",
    items: [
      { id: "sandbox-interface", text: "Sandbox Interface" },
      { id: "local-sandbox", text: "LocalSandbox" },
      { id: "vercel-sandbox", text: "VercelSandbox" },
      { id: "e2b-sandbox", text: "E2BSandbox" },
    ],
  },
  {
    href: "/api-reference",
    label: "API Reference",
    items: [
      { id: "create-agent-tools", text: "createAgentTools" },
      { id: "configuration", text: "Configuration" },
      { id: "middleware", text: "Middleware" },
      { id: "caching", text: "Caching" },
      { id: "budget-tracking", text: "Budget Tracking" },
      { id: "message-pruning", text: "Message Pruning" },
    ],
  },
];

const themeIcons: Record<string, React.ReactNode> = {
  system: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  light: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  dark: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
};

const themeOrder = ["system", "light", "dark"] as const;

function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !expanded || !containerRef.current) return;
    const activeIndex = themeOrder.indexOf(
      (theme || "system") as (typeof themeOrder)[number],
    );
    if (activeIndex < 0) return;
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>(
      ".theme-picker-option",
    );
    const btn = buttons[activeIndex];
    if (btn) {
      setIndicatorStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
  }, [theme, mounted, expanded]);

  if (!mounted) return <div style={{ width: 14, height: 14 }} />;

  const currentTheme = theme || "system";

  return (
    <div
      className="theme-picker-wrap"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="theme-picker-trigger">{themeIcons[currentTheme]}</div>
      <Motion.Presence>
        {expanded && (
          <motion.div
            className="theme-picker"
            ref={containerRef}
            initial={{ clipPath: "inset(0 0 0 100%)" }}
            animate={{ clipPath: "inset(0 0 0 0%)" }}
            exit={{ clipPath: "inset(0 0 0 100%)" }}
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          >
            {indicatorStyle && (
              <motion.div
                className="theme-picker-indicator"
                animate={{
                  left: indicatorStyle.left,
                  width: indicatorStyle.width,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {themeOrder.map((t) => (
              <button
                key={t}
                className={`theme-picker-option ${currentTheme === t ? "active" : ""}`}
                onClick={() => setTheme(t)}
                aria-label={`${t} theme`}
                title={t.charAt(0).toUpperCase() + t.slice(1)}
              >
                {themeIcons[t]}
              </button>
            ))}
          </motion.div>
        )}
      </Motion.Presence>
    </div>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [heroVisible, setHeroVisible] = useState(true);

  useEffect(() => {
    if (!isHome) {
      setHeroVisible(false);
      return;
    }
    const el = document.getElementById("hero-title");
    if (!el) {
      setHeroVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isHome]);

  const showLogoText = !isHome || !heroVisible;

  return (
    <nav className="side-nav">
      <div className="side-nav-scroll">
        <div className="side-nav-logo">
          <Link
            href="/"
            className="side-nav-logo-link"
            style={{
              cursor: isHome ? "default" : "pointer",
            }}
            onClick={
              isHome ? (e: React.MouseEvent) => e.preventDefault() : undefined
            }
            tabIndex={isHome ? -1 : 0}
          >
            <TerminalLogo />
            <span
              className={`side-nav-logo-text ${showLogoText ? "visible" : ""}`}
            >
              bashkit
            </span>
          </Link>
        </div>
        <div className="nav-links">
          {links.map((link) => {
            const isActive = pathname === link.href;
            const hasItems = link.items && link.items.length > 0;

            return (
              <div key={link.href} className="nav-item-wrapper">
                <Link
                  href={link.href}
                  className={`nav-link ${isActive ? "active" : ""}`}
                >
                  <span className="nav-link-icon">{navIcons[link.href]}</span>
                  {link.label}
                </Link>

                <Motion.Config
                  transition={{
                    type: "spring",
                    damping: 18,
                    mass: 0.2,
                    stiffness: 280,
                  }}
                >
                  <Motion.Presence mode="sync">
                    {isActive && hasItems && (
                      <Motion.Height>
                        <TOC
                          headings={link.items!.map((item) => ({
                            id: item.id,
                            level: 1,
                            text: item.text,
                          }))}
                          title=""
                          className="nav-toc"
                        />
                      </Motion.Height>
                    )}
                  </Motion.Presence>
                </Motion.Config>
              </div>
            );
          })}
        </div>
      </div>
      <div className="nav-meta">
        <a
          href="https://github.com/jbreite/bashkit"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-icon-link"
          aria-label="GitHub"
          title="GitHub"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/package/bashkit"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-version"
          title="View on npm"
        >
          v0.5.3
        </a>
        <ThemePicker />
      </div>
    </nav>
  );
}
