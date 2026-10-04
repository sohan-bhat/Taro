'use client';

import { useEffect, useState } from 'react';

const MAX = 40;

/**
 * The address that wasn't found. It's read after mount, so the prerendered 404 (and the first
 * paint) says "this address" and hydration always matches.
 */
export function MissingPath({ className }: { className?: string }) {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    const p = window.location.pathname;
    setPath(p.length > MAX ? `${p.slice(0, MAX - 1)}…` : p);
  }, []);

  return path ? <span className={className}>{path}</span> : <>this address</>;
}
