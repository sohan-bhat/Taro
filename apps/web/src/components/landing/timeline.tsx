import { HeardText, TRACK_LG } from '@/components/exchange';
import { cn } from '@/lib/utils';
import { HOW, type Step, type StepLine, type StepResult } from './content';
import { C, H2, LINE, PAGE_SPLIT, SECTION_PAD } from './grid';
import { GithubIssueCard, GithubMarkdown, GithubPullCard } from './mocks/github';
import { SlackCard, SlackDivider, SlackMessage } from './mocks/slack';
import { Scene } from './scene/scene';
import { cue, shot } from './scene/script';
import { Story } from './story';

// Each line over the stage arrives halfway through its shot's glide and leaves early in the next
// one's. The heading leaves as the camera first moves in, and comes back for the last wide shot.
const NOTES = HOW.scene.notes.map((note, i) => {
  const from = shot(note.from);
  const until = shot(HOW.scene.notes[i + 1]?.from ?? 'end');
  return { text: note.text, at: from.glideFrom + from.glide / 2, out: until.glideFrom + 2 };
});
const TITLE = { '--out': shot('join').glideFrom + 2, '--back': shot('end').glideFrom + shot('end').glide / 2 } as React.CSSProperties;

const MARK = /\[([^\]]+)\]\{(\w+)\}/;

/**
 * Renders "[words]{Priya}" as a provenance mark: words Taro took from what someone said. Hover,
 * focus, or a tap shows who said them; screen readers hear it after the words.
 */
function Provenance({ text }: { text: string }) {
  // split keeps both groups: plain text, the marked words, who said them, plain text, and so on
  const parts = text.split(MARK);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 3 === 0) return part;
        if (i % 3 === 2) return null;
        const said = `${parts[i + 1]} said this`;
        return (
          <span key={i} className="prov" tabIndex={0}>
            {part}
            <span className="sr-only">{` (${said})`}</span>
            <span aria-hidden="true" className="prov-who">
              {said}
            </span>
          </span>
        );
      })}
    </>
  );
}

function Speaker({ who, taro = false }: { who: string; taro?: boolean }) {
  return (
    <span className={cn('speaker col-start-1', taro && 'speaker-taro')}>
      {who}
      <span className="sr-only">:</span>
    </span>
  );
}

// Each line names its column, so every utterance starts a new row of the script grid.
function Line({ line, first }: { line: StepLine; first: boolean }) {
  switch (line.kind) {
    case 'event':
      // From 768px an opening event shares the time's row, like a line in a log
      return (
        <p className={cn('col-start-2 text-pretty text-[17px] leading-[1.4] text-ink md:text-[19px]', first && 'md:row-start-1')}>
          {line.text}
        </p>
      );
    case 'context':
    case 'request':
      return (
        <>
          <Speaker who={line.who} />
          <p className={cn('said col-start-2 text-pretty text-said-lg', line.kind === 'request' ? 'text-ink' : 'text-ink-2')}>
            <HeardText text={line.said} />
          </p>
        </>
      );
    case 'taro':
      return (
        <>
          <Speaker who="Taro" taro />
          <p className="col-start-2 text-row-answer font-bold text-ink">{line.text}</p>
        </>
      );
  }
}

/** A picture of one row of the dashboard's GitHub permissions. States are words, not drawn switches. */
function SettingCard({ result }: { result: Extract<StepResult, { kind: 'setting' }> }) {
  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-card border border-rule bg-paper shadow-artifact">
      <figcaption className="sr-only">{result.caption}</figcaption>
      <p className="border-b border-rule px-5 py-3.5 text-base font-semibold">{result.title}</p>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold">{result.label}</span>
          <span className="block text-xs text-ash">{result.description}</span>
        </span>
        <span className="shrink-0 text-meta font-medium text-ash">{result.state}</span>
      </div>
    </figure>
  );
}

function Result({ result }: { result: StepResult }) {
  switch (result.kind) {
    case 'issue':
      return (
        <GithubIssueCard repo={result.repo} number={result.number} title={result.title} caption={result.caption}>
          <GithubMarkdown source={result.body} inline={(text) => <Provenance text={text} />} />
        </GithubIssueCard>
      );
    case 'pull':
      return (
        <GithubPullCard
          repo={result.repo}
          number={result.number}
          title={result.title}
          base={result.base}
          head={result.head}
          commits={result.commits}
          caption={result.caption}
        >
          <GithubMarkdown source={result.body} />
        </GithubPullCard>
      );
    case 'setting':
      return <SettingCard result={result} />;
    case 'slack':
      return (
        <SlackCard channel={result.channel} thread={result.thread} caption={result.caption}>
          {result.messages.map((message, i) =>
            'divider' in message ? (
              <SlackDivider key={i}>{message.divider}</SlackDivider>
            ) : (
              <SlackMessage key={i} who={message.who} time={message.time} text={message.text} taro={message.taro} />
            )
          )}
        </SlackCard>
      );
  }
}

// One row per step: the meeting, then its result beside it from 1100px
function StoryStep({ step }: { step: Step }) {
  return (
    <li className="border-t border-rule">
      <div className={cn(PAGE_SPLIT, 'items-start gap-y-7 py-12 md:py-14 wide:py-16')}>
        {/* content-start and self-start keep the script from stretching beside a taller result */}
        <div className={cn(TRACK_LG, 'content-start gap-y-2.5 self-start')}>
          <time
            dateTime={step.dateTime}
            className="col-start-2 text-sm font-semibold text-ash md:col-start-1 md:row-start-1 md:text-right"
          >
            {step.time}
          </time>
          {step.lines.map((line, i) => (
            <Line key={i} line={line} first={i === 0} />
          ))}
          <p
            className={cn(
              'col-start-2 max-w-[34em] text-pretty text-[15.5px] leading-[1.55] text-ash',
              step.lines.length ? 'mt-2' : 'md:row-start-1'
            )}
          >
            {step.caption}
          </p>
        </div>
        {step.result && (
          <div className="min-w-0 md:ml-28 md:max-w-[560px] wide:ml-0 wide:max-w-none">
            <Result result={step.result} />
          </div>
        )}
      </div>
    </li>
  );
}

export function Timeline() {
  return (
    // Arrives with the end of the hero's intro (intro-late), so nothing below the hero sits there while it plays
    <section id="how" aria-labelledby="how-title" className={cn(SECTION_PAD, 'intro-late')}>
      <Story>
        {/* While the camera runs, the stage pins under the nav and the scene plays inside it */}
        <div className="story-stage">
          <div className="story-band pb-8 md:pb-12">
            <div className={C}>
              <div className={cn(LINE, 'story-heads')}>
                <h2 id="how-title" className={cn(H2, 'story-title')} style={TITLE}>
                  {HOW.title}
                </h2>
                <div className="story-notes" aria-hidden="true">
                  {NOTES.map((note) => (
                    <p
                      key={note.text}
                      className="story-note cue cue-rise max-w-[20em] text-balance text-h2-aside font-750 text-ink"
                      style={cue(note.at, note.out, 4)}
                    >
                      {note.text}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <Scene />
        </div>
        {/* The story as text: what screen readers read, and what shows without the camera */}
        <div className={cn(C, 'story-list')}>
          {/* role="list" because Safari stops announcing lists whose markers are removed. Never numbered on screen. */}
          <ol role="list" className="list-none border-b border-rule">
            {HOW.steps.map((step) => (
              <StoryStep key={step.id} step={step} />
            ))}
          </ol>
        </div>
      </Story>
    </section>
  );
}
