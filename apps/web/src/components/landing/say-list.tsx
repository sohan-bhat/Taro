import { HeardText } from '@/components/exchange';
import { SAY } from './content';
import { C, H2, LINE, SECTION_PAD, SUB } from './grid';

export function SayList() {
  return (
    <section id="say" aria-labelledby="say-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="say-title" className={H2}>
            {SAY.title}
          </h2>
          <p className={SUB}>{SAY.sub}</p>
          <div className="mt-8 grid gap-10 md:mt-12 md:gap-12">
            {SAY.groups.map((group, g) => (
              <section key={group.title} aria-labelledby={`say-group-${g}`}>
                <h3 id={`say-group-${g}`} className="border-b border-ink pb-2.5 text-[15px] font-semibold text-ink">
                  {group.title}
                </h3>
                <ul role="list" className="list-none">
                  {group.items.map((item) => (
                    // From 1100px the result column starts on the 7/5 line
                    <li
                      key={item.said}
                      className="grid gap-1.5 border-b border-rule py-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:items-baseline md:gap-x-8 md:py-[18px] wide:gap-x-12"
                    >
                      <p className="said text-said-md text-ink">
                        <HeardText text={item.said} />
                      </p>
                      <p className="text-base text-ink">
                        {item.result}
                        {item.note && <span className="mt-0.5 block text-sm text-ash">{item.note}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
