import * as React from 'react';
import { cn } from '@/lib/utils';
import { cue } from './script';

/**
 * One app window on the scene's desk: rounded, a hairline edge, a soft shadow, and a quiet title bar
 * naming the app and where in it we are.
 */
export function SceneWindow({
  cam,
  title,
  className,
  children,
}: {
  cam: string;
  title: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-cam={cam}
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-card border border-rule bg-paper shadow-artifact', className)}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule bg-mist px-3.5 text-[12.5px] text-ash md:h-10 md:gap-2.5 md:px-4 md:text-[13px]">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Words in a title bar that change as the story goes on: each version holds the same spot and crossfades. */
export function Swap({ items, className }: { items: Array<{ text: string; at: number; out?: number }>; className?: string }) {
  return (
    <span className={cn('grid', className)}>
      {items.map((item, i) => (
        <span key={i} className="cue col-start-1 row-start-1" style={cue(item.at, item.out, 2)}>
          {item.text}
        </span>
      ))}
    </span>
  );
}
