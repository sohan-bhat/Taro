import { cn } from '@/lib/utils';
import { KEYS } from './content';
import { C, GROUP, H2, LINE, SECTION_PAD } from './grid';

const ROW = 'border-b border-rule py-3.5';

// Two equal halves from 1100px: at 7 to 5 the right column is too narrow for its statements to sit on one line.

export function Keys() {
  const { own, lane } = KEYS;
  return (
    <section id="keys" aria-labelledby="keys-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="keys-title" className={H2}>
            {KEYS.title}
          </h2>
          <div className="mt-8 grid gap-y-12 md:mt-12 wide:grid-cols-2 wide:items-start wide:gap-x-12">
            <section aria-labelledby="keys-own">
              <h3 id="keys-own" className={GROUP}>
                {own.title}
              </h3>
              <dl>
                {own.rows.map((row) => (
                  <div
                    key={row.label}
                    className={cn(ROW, 'grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-6')}
                  >
                    <dt className="text-sm font-semibold text-ash">{row.label}</dt>
                    <dd className="text-pretty text-[17px] leading-[1.45] text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 max-w-[36em] text-pretty text-body text-ink-2">{own.after}</p>
            </section>
            <section aria-labelledby="keys-lane">
              <h3 id="keys-lane" className={GROUP}>
                {lane.title}
              </h3>
              <ul role="list" className="list-none">
                {lane.items.map((item) => (
                  <li key={item} className={cn(ROW, 'text-pretty text-[17px] leading-[1.45] text-ink')}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
