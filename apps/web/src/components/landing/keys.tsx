import { KEYS } from './content';
import { C, H2, LINE, SECTION_PAD, SUB } from './grid';

// `backticks` in the copy are set in the code face
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          <code key={i} className="font-mono text-[0.88em]">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

export function Keys() {
  return (
    <section id="keys" aria-labelledby="keys-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="keys-title" className={H2}>
            {KEYS.title}
          </h2>
          <p className={SUB}>{KEYS.sub}</p>
          <ul
            role="list"
            className="mt-8 grid list-none gap-y-8 border-t border-ink pt-6 md:mt-12 lg:grid-cols-3 lg:gap-x-12 lg:pt-7"
          >
            {KEYS.slots.map((slot) => (
              <li key={slot.label}>
                <p className="text-sm font-semibold text-ash">{slot.label}</p>
                <h3 className="mt-2 text-[22px] font-bold leading-[1.25] tracking-[-0.02em]">{slot.title}</h3>
                <p className="mt-2.5 text-[15.5px] leading-[1.55] text-ink-2">{slot.body}</p>
                <p className="mt-4 text-sm font-semibold text-ink">{slot.pays}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-base text-ink-2">{KEYS.after}</p>

          <h3 className="mt-14 text-h3 font-bold">{KEYS.factsTitle}</h3>
          <dl className="mt-4 grid max-w-[44rem] gap-3 border-t border-rule pt-5">
            {KEYS.facts.map((fact) => (
              <div key={fact.term} className="grid gap-1 md:grid-cols-[140px_minmax(0,1fr)] md:gap-6">
                <dt className="text-ui font-semibold text-ink">{fact.term}</dt>
                <dd className="text-base text-ink-2">
                  <WithCode text={fact.detail} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
