import { cn } from '@/lib/utils';
import { SECURITY } from './content';
import { C, H2, LINE, LINE_SPLIT, SECTION_PAD } from './grid';

// The dashboard's GitHub permissions panel as a new workspace sees it. States are the words On and
// Off, not drawn switches, so nothing here looks like a control that doesn't work.
function PermissionsPanel() {
  const { panel } = SECURITY;
  return (
    <figure className="m-0 min-w-0">
      <div className="overflow-hidden rounded-card border border-rule bg-paper">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-4">
          <p className="text-base font-semibold">{panel.title}</p>
          <p className="whitespace-nowrap text-meta text-ash">{panel.count}</p>
        </div>
        {panel.groups.map((group) => (
          <div key={group.label}>
            <p className="px-5 pb-1.5 pt-3.5 text-meta font-semibold text-ash">{group.label}</p>
            <ul role="list" className="list-none">
              {group.rows.map((row) => (
                <li
                  key={row.action}
                  className="flex items-center justify-between gap-4 border-b border-rule-soft px-5 py-[11px] last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold">{row.label}</span>
                    <span className="block text-xs text-ash">{row.description}</span>
                  </span>
                  <span className={cn('shrink-0 text-meta', group.on ? 'font-semibold text-ink' : 'font-medium text-ash')}>
                    {group.on ? panel.states.on : panel.states.off}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 text-sm text-ash">{panel.caption}</figcaption>
    </figure>
  );
}

export function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="security-title" className={H2}>
            {SECURITY.title}
          </h2>
          <div className={cn(LINE_SPLIT, 'mt-8 gap-y-10 md:mt-12 wide:items-start')}>
            <div className="grid gap-7">
              {SECURITY.statements.map((statement) => (
                <div key={statement.title}>
                  <h3 className="text-h3 font-bold">{statement.title}</h3>
                  <p className="mt-2 max-w-[32em] text-base leading-[1.6] text-ink-2">{statement.body}</p>
                </div>
              ))}
            </div>
            <PermissionsPanel />
          </div>
        </div>
      </div>
    </section>
  );
}
