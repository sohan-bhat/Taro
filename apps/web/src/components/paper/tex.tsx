// Temporary: keeps pages from the abandoned LaTeX experiment compiling until the redesign replaces them. Delete with them.
import { cn } from '@/lib/utils';

export function Section({ n, title, id, className, children }: { n: number | string; title: string; id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={cn('mt-14', className)}>
      <h2 className="text-2xl font-bold">
        <span className="mr-3">{n}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Cite({ n }: { n: number }) {
  return <a href={`#ref-${n}`}>[{n}]</a>;
}

export function Implies({ className }: { className?: string }) {
  return <span className={className}>⟹</span>;
}
