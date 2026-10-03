import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { PrimaryCta } from '@/components/sign-in';
import { Cite, Implies, Section } from '@/components/paper/tex';
import { FlowFigure } from '@/components/paper/flow-figure';

const REPO = process.env.NEXT_PUBLIC_REPO_URL;

const ALGORITHM: { text: React.ReactNode; depth: number }[] = [
  { text: 'post the meeting link in Slack', depth: 0 },
  { text: 'Taro joins the call', depth: 0 },
  { text: <><b>while</b> the meeting goes on <b>do</b></>, depth: 0 },
  { text: <><b>if</b> someone says “Hey Taro, …” <b>then</b></>, depth: 1 },
  { text: 'do it in Slack or GitHub', depth: 2 },
  { text: 'play a ding in the call', depth: 2 },
  { text: <b>end if</b>, depth: 1 },
  { text: <b>end while</b>, depth: 0 },
  { text: 'post a recap in the thread', depth: 0 },
];

const KEYS: [string, React.ReactNode, string][] = [
  ['Meeting bot', <>MeetingBaas <Cite n={3} /></>, 'you'],
  ['AI model', <>Anthropic, OpenAI, Google, Groq, or OpenRouter <Cite n={4} /></>, 'you'],
  ['Transcription', 'Whisper on Groq or OpenAI', 'you'],
  ['Taro', 'this website', 'nobody'],
];

const SAY: [string, string][] = [
  ['Hey Taro, file an issue about that.', 'an issue, written up'],
  ['Hey Taro, tell engineering the deploy is done.', 'a post in #engineering'],
  ['Hey Taro, open a pull request to fix the reports page.', 'a branch and a pull request'],
  ['Hey Taro, make a todo list for the launch.', 'a checklist in Slack'],
];

const REFERENCES: [string, string, string?][] = [
  ['Slack', 'Where Taro finds links and posts results.', 'https://slack.com'],
  ['GitHub', 'Where Taro files issues and opens pull requests, as its own app.', 'https://github.com'],
  ['MeetingBaas', 'The meeting bot service that joins the call and streams its audio.', 'https://meetingbaas.com'],
  ['Your AI provider', 'Anthropic, OpenAI, Google, Groq, or OpenRouter. It reads the conversation and writes the request properly.'],
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-page items-center justify-between px-5 py-4 sm:px-2 sm:py-6">
        <Link href="/" aria-label="Taro home" className="rounded-sm">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-5 sm:gap-7">
          <Link href="/demo" className="sc text-[1.0625rem] text-ink-2 hover:text-ink">
            Demo
          </Link>
          <PrimaryCta size="sm" compact />
        </nav>
      </header>

      <main id="main" className="sm:px-5">
        <article className="paper relative mx-auto max-w-page px-5 pb-10 pt-12 sm:rounded-[2px] sm:px-12 sm:shadow-page md:px-[100px] md:pb-14 md:pt-20">
          <p
            aria-hidden
            className="pointer-events-none absolute left-7 top-28 hidden rotate-180 select-none font-title text-[21px] tracking-[0.02em] text-[#B9B1A3] [writing-mode:vertical-rl] lg:block"
          >
            tarXiv:2610.03142v1 [cs.MEET] 3 Oct 2026
          </p>

          <header className="text-center">
            <h1 className="mx-auto max-w-[17em] text-balance font-title text-title text-ink">
              Taro: Say It in the Meeting, Done Before You Hang Up
            </h1>
            <p className="mt-6 text-[1.25rem]">
              Taro<sup>1</sup> <span className="px-1">and</span> You<sup>2</sup>
            </p>
            <p className="mt-1 text-sm text-ink-2">
              <sup>1</sup>Your meetings <span className="px-2" /> <sup>2</sup>Your Slack and GitHub
            </p>
            <p className="mt-3 text-[1.0625rem]">October 2026</p>
          </header>

          <section aria-labelledby="abstract" className="mx-auto mt-10 max-w-[33rem]">
            <h2 id="abstract" className="text-center text-sm font-bold">
              Abstract
            </h2>
            <p className="mt-2 text-justify text-[1rem] leading-[1.6] [hyphens:auto]">
              Taro joins your Google Meet, Zoom, and Teams calls. When someone says “Hey Taro,” it files the issue, posts
              the message, or opens the pull request while the meeting keeps going <Cite n={1} />, <Cite n={2} />. You
              bring the keys. Taro does the wiring.
            </p>
            <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <PrimaryCta size="lg" />
              <Button asChild variant="secondary" size="lg">
                <Link href="/demo">See the demo</Link>
              </Button>
            </div>
            <p className="mt-3 text-center text-sm text-ink-2">
              Free to use.<sup>∗</sup>
            </p>
          </section>

          <div className="mt-12 grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-3 text-[1.2rem] sm:text-equation" role="img" aria-label="Equation 1: a meeting plus Hey Taro implies done.">
            <span />
            <span className="whitespace-nowrap" aria-hidden>
              <i>meeting</i> + “Hey Taro” <Implies /> <i>done</i>
            </span>
            <span className="justify-self-end text-body text-ink" aria-hidden>
              (1)
            </span>
          </div>

          <FlowFigure />

          <Section n={1} title="How it works" id="how">
            <figure className="border-y-[1.5px] border-ink">
              <figcaption className="border-b border-ink py-1.5 text-body">
                <b>Algorithm 1</b> Taro in a meeting
              </figcaption>
              <ol className="py-2.5 text-body">
                {ALGORITHM.map((line, i) => (
                  <li key={i} className="grid grid-cols-[2.2em_minmax(0,1fr)] items-baseline">
                    <span className="text-right text-sm text-ink-2">{i + 1}:</span>
                    <span style={{ paddingLeft: `${0.6 + line.depth * 1.5}em` }}>{line.text}</span>
                  </li>
                ))}
              </ol>
            </figure>
          </Section>

          <Section n={2} title="Bring your own keys" id="keys">
            <p className="text-body">Every workspace plugs in its own accounts and pays them directly.</p>
            <div className="mt-6">
              <table className="booktabs text-body">
                <caption className="mb-2 caption-top text-center text-sm text-ink-2">
                  <span className="text-ink">Table 1:</span> Who provides what, and who pays.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Provided by</th>
                    <th scope="col" className="whitespace-nowrap">Paid by</th>
                  </tr>
                </thead>
                <tbody>
                  {KEYS.map(([part, provider, payer]) => (
                    <tr key={part}>
                      <td className="whitespace-nowrap">{part}</td>
                      <td>{provider}</td>
                      <td className={payer === 'nobody' ? 'whitespace-nowrap italic' : 'whitespace-nowrap'}>{payer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-8 text-body">
              <p>
                <b>Theorem 1</b> (Your keys stay yours)<b>.</b>{' '}
                <i>Every key is checked with its provider, encrypted, and never shown again.</i>
              </p>
              <p className="qed mt-2">
                <i>Proof.</i> AES-256-GCM, bound to your workspace.{' '}
                {REPO ? (
                  <a href={`${REPO}/blob/main/packages/api/src/lib/crypto.ts`} className="tex-link">
                    Read the source.
                  </a>
                ) : (
                  'The source is open.'
                )}
              </p>
            </div>
          </Section>

          <Section n={3} title="Things you can say" id="say">
            <ul className="space-y-3 text-body">
              {SAY.map(([said, result], i) => (
                <li
                  key={said}
                  className="grid grid-cols-[minmax(0,1fr)_2.2em] items-baseline gap-x-4 md:grid-cols-[minmax(0,1fr)_13.5em_2.2em]"
                >
                  <span className="col-start-1 row-start-1">“{said}”</span>
                  <span className="col-start-1 row-start-2 text-ink-2 md:col-start-2 md:row-start-1">
                    <span aria-hidden className="mr-1.5">→</span>
                    {result}
                  </span>
                  <span className="col-start-2 row-start-1 text-right text-ink-2 md:col-start-3" aria-hidden>
                    ({i + 2})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-body text-ink-2">Taro reads the conversation, so “that” means what you were just talking about.</p>
          </Section>

          <section aria-labelledby="refs-title" className="mt-14 md:mt-16">
            <h2 id="refs-title" className="font-head text-section font-bold">
              References
            </h2>
            <ol className="mt-4 space-y-2 text-[1rem]">
              {REFERENCES.map(([name, note, href], i) => (
                <li key={name} id={`ref-${i + 1}`} className="grid scroll-mt-24 grid-cols-[2.4em_minmax(0,1fr)] items-baseline">
                  <span>[{i + 1}]</span>
                  <span>
                    {name}. <span className="text-ink-2">{note}</span>{' '}
                    {href && (
                      <a href={href} className="tex-link wrap-anywhere">
                        {href.replace('https://', '')}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <aside className="mt-14 text-foot text-ink-2">
            <hr className="mb-2 w-32 border-0 border-t border-ink" />
            <p>
              <sup>∗</sup>You pay MeetingBaas and your AI provider directly. Taro adds no fee.
            </p>
          </aside>

          <p className="mt-10 text-center text-[1rem]" aria-hidden>
            1
          </p>
        </article>

        <footer className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-6 gap-y-2 px-5 py-8 text-ink-2">
          <Link href="/demo" className="sc hover:text-ink">
            Demo
          </Link>
          <Link href="/signin" className="sc hover:text-ink">
            Sign in
          </Link>
          {REPO && (
            <a href={REPO} className="sc hover:text-ink">
              Source
            </a>
          )}
        </footer>
      </main>
    </div>
  );
}
