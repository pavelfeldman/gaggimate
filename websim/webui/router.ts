// preact-iso for the simulator's web UI build (scripts/build-webui.mjs resolves 'preact-iso' here).
// The firmware serves the web UI at the site root and preact-iso routes on location.pathname; a
// static site serves it from a subdirectory, so this LocationProvider keeps the route in the
// fragment instead (#/settings), which makes reloads and deep links work on any static host.
// Everything else is preact-iso itself.
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useReducer } from 'preact/hooks';
import { LocationProvider as PathLocationProvider } from 'preact-iso/router';

export * from 'preact-iso/router';
export { default as lazy, ErrorBoundary } from 'preact-iso/lazy';
export { default as hydrate } from 'preact-iso/hydrate';

type Navigation = MouseEvent | PopStateEvent | HashChangeEvent | string | { url: string; replace?: boolean };

const current = () => location.hash.replace(/^#/, '') || '/';
let wasPush = false;

// Same cases as preact-iso's own reducer, with the URL kept after the '#'.
function navigate(state: string, action: Navigation): string {
  let url: string;
  let push: boolean | undefined;
  if (action instanceof MouseEvent) {
    if (action.ctrlKey || action.metaKey || action.altKey || action.shiftKey || action.button !== 0) return state;
    const link = (action.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    const href = link?.getAttribute('href');
    // App routes only: not other origins, fragments, downloads or the device API.
    if (!link || !href || !/^\/(?!\/|api\/)/.test(href) || link.hasAttribute('download') || !/^(_?self)?$/i.test(link.target)) return state;
    action.preventDefault();
    url = href;
    push = true;
  } else if (typeof action === 'string') {
    url = action;
    push = true;
  } else if ('url' in action) {
    url = action.url;
    push = !action.replace;
  } else {
    url = current(); // popstate / hashchange
  }
  if (push === true) history.pushState(null, '', `#${url}`);
  else if (push === false) history.replaceState(null, '', `#${url}`);
  wasPush = push === true;
  return url;
}

type Context = { Provider: (props: { value: unknown; children?: ComponentChildren }) => unknown };

export function LocationProvider(props: { children?: ComponentChildren }) {
  const [url, route] = useReducer(navigate, '', current);
  const push = wasPush;
  const value = useMemo(() => {
    const u = new URL(url, location.origin);
    return {
      url,
      path: u.pathname.replace(/\/+$/g, '') || '/',
      query: Object.fromEntries(u.searchParams),
      route: (to: string, replace?: boolean) => route({ url: to, replace }),
      wasPush: push,
    };
  }, [url]);

  useLayoutEffect(() => {
    addEventListener('click', route);
    addEventListener('popstate', route);
    addEventListener('hashchange', route);
    return () => {
      removeEventListener('click', route);
      removeEventListener('popstate', route);
      removeEventListener('hashchange', route);
    };
  }, []);

  // Router and useLocation read preact-iso's own context.
  const ctx = (PathLocationProvider as unknown as { ctx: Context }).ctx;
  return h(ctx.Provider as never, { value }, props.children);
}
LocationProvider.ctx = (PathLocationProvider as unknown as { ctx: Context }).ctx;
