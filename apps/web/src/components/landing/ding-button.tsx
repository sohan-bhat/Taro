'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { playDing } from '@/lib/ding';

/** Plays the two notes Taro plays in a call. Only on a click, and the label never changes. */
export function DingButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Button variant="link" size="sm" className={className} onClick={() => playDing()}>
      {children}
    </Button>
  );
}
