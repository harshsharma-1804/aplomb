import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Crumb = { label: string; to?: string };

const BreadcrumbContext = createContext<{
  get: (pathname: string) => Crumb[] | undefined;
  set: (pathname: string, crumbs: Crumb[]) => void;
}>({ get: () => undefined, set: () => {} });

export { BreadcrumbContext };

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [trails, setTrails] = useState<Record<string, Crumb[]>>({});
  const value = useMemo(() => ({
    get: (pathname: string) => trails[pathname],
    set: (pathname: string, crumbs: Crumb[]) => {
      setTrails(prev => (prev[pathname] === crumbs ? prev : { ...prev, [pathname]: crumbs }));
    },
  }), [trails]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Publish a breadcrumb trail for the current pathname. Pages call this once
 * their entity data is loaded so the top bar can show real names instead of
 * raw ids. Passing null leaves the trail untouched.
 */
export function useBreadcrumb(pathname: string | undefined, crumbs: Crumb[] | null) {
  const { set } = useContext(BreadcrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    if (pathname && crumbs) set(pathname, crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, key]);
}
