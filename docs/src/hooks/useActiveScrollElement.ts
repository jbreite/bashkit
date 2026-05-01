import { useState, useEffect, useRef, useLayoutEffect } from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

type Options = {
  defaultActive?: string;
  vhFromTopOfPage?: number;
};

export const useActiveScrollElement = (
  ids: string[],
  options: Options = {},
) => {
  const opts = {
    defaultActive: ids[0],
    vhFromTopOfPage: 50,
    ...options,
  };

  const [active, setActive] = useState(opts.defaultActive ?? ids[0]);
  const updatesPaused = useRef(false);

  function updateActive(id: string) {
    if (!updatesPaused.current) {
      setActive(id);
    }
  }

  useIsomorphicLayoutEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const id = window.location.hash?.slice(1);
      if (ids.includes(id)) {
        setActive(id);
      }
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateActive is stable via ref
  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: ReturnType<typeof setTimeout>;
    let firstObserver = true;
    let maxScroll = Number.MAX_SAFE_INTEGER;
    const hasScrollEnd = "onscrollend" in document.documentElement;
    const rootStyle = getComputedStyle(document.documentElement);
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el) => !!el) as HTMLElement[];

    function observerCb(entries: IntersectionObserverEntry[]) {
      if (firstObserver) {
        firstObserver = false;
        return;
      }

      if (window.scrollY <= 0) {
        return;
      }

      for (const entry of entries) {
        const { isIntersecting, target, boundingClientRect, rootBounds } =
          entry;
        const id = target.id;

        if (!id || !rootBounds) return;

        const didIntersectAtTop =
          rootBounds.bottom - boundingClientRect.bottom > rootBounds.bottom / 2;

        if (didIntersectAtTop) return;

        if (isIntersecting) {
          updateActive(id);
          return;
        }

        const index = ids.indexOf(id);
        const previous = ids[Math.max(index - 1, 0)];
        updateActive(previous);
      }
    }

    function handleHash(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const anchorElement = target.closest("a");
      const href = anchorElement?.getAttribute("href");
      if (!anchorElement || !href || !href.startsWith("#")) return;

      const hash = href?.slice(1);
      if (!ids.includes(hash)) return;

      setActive(hash);
      updatesPaused.current = true;

      if (hasScrollEnd) {
        document.addEventListener(
          "scrollend",
          () => {
            updatesPaused.current = false;
          },
          { once: true },
        );
      } else {
        clearTimeout(timer);
        const ms = rootStyle.scrollBehavior === "smooth" ? 1000 : 60;
        timer = setTimeout(() => {
          updatesPaused.current = false;
        }, ms);
      }
    }

    const handleResize = debounce(() => {
      maxScroll =
        Math.max(
          document.body.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.clientHeight,
          document.documentElement.scrollHeight,
          document.documentElement.offsetHeight,
        ) - window.innerHeight;
    }, 500);

    function handleScroll() {
      if (window.scrollY <= 0) updateActive(ids[0]);
      if (window.scrollY >= maxScroll) updateActive(ids[ids.length - 1]);
    }

    const scrollObserver = new IntersectionObserver(observerCb, {
      threshold: [1],
      rootMargin: `0% 0% -${opts.vhFromTopOfPage}% 0%`,
    });

    const resizeObserver = new ResizeObserver(handleResize);

    handleResize();
    if (window.scrollY > 0) handleScroll();

    for (const heading of sections) scrollObserver.observe(heading);
    resizeObserver.observe(document.body);
    document.addEventListener("click", handleHash);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      document.removeEventListener("click", handleHash);
      window.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      scrollObserver.disconnect();
      clearTimeout(timer);
    };
  }, [ids, opts.vhFromTopOfPage]);

  return active;
};
