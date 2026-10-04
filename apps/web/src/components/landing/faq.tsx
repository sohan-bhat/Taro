import { FAQ } from './content';
import { C, H2, LINE, SECTION_PAD } from './grid';

// Questions are said, answers are recorded. Native disclosures, all closed at first: no script, no
// animation, and the toggle is a word.
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="faq-title" className={H2}>
            {FAQ.title}
          </h2>
          <div className="mt-8 border-t border-rule md:mt-10">
            {FAQ.items.map((item) => (
              <details key={item.q} className="group border-b border-rule">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 py-[22px] [&::-webkit-details-marker]:hidden">
                  <span className="said text-said-lg text-ink">{item.q}</span>
                  <span aria-hidden="true" className="text-sm font-semibold text-taro">
                    <span className="group-open:hidden">{FAQ.toggle.open}</span>
                    <span className="hidden group-open:inline">{FAQ.toggle.close}</span>
                  </span>
                </summary>
                <p className="max-w-[40em] pb-6 text-body text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
