import { cn } from '@/lib/utils';
import { SAY } from './content';
import { C, GROUP, H2, LINE, SECTION_PAD, SUB } from './grid';

// Names only, set in short columns so the whole list reads in a few seconds. From 768px the Slack
// group takes one column and GitHub two, so the three columns are the same width. Below 360px a
// column is too narrow for "Open a pull request", so each group is one column.
export function SayList() {
  return (
    <section id="say" aria-labelledby="say-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="say-title" className={H2}>
            {SAY.title}
          </h2>
          <p className={SUB}>{SAY.sub}</p>
          <div className="mt-8 grid gap-y-8 md:mt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-x-8 wide:gap-x-12">
            {SAY.groups.map((group, g) => (
              <section key={group.title} aria-labelledby={`say-group-${g}`}>
                <h3 id={`say-group-${g}`} className={GROUP}>
                  {group.title}
                </h3>
                <ul
                  role="list"
                  className={cn(
                    'mt-3 list-none columns-2 gap-x-6 text-[17px] font-medium leading-[1.35] text-ink max-[359px]:columns-1 md:gap-x-8 wide:gap-x-12 wide:text-[19px]',
                    g === 0 && 'md:columns-1'
                  )}
                >
                  {group.items.map((item) => (
                    <li key={item} className="break-inside-avoid py-[7px]">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-6 max-w-measure text-pretty text-sm text-ash md:mt-7">{SAY.note}</p>
        </div>
      </div>
    </section>
  );
}
