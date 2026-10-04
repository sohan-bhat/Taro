import { HeardText, TRACK_LG } from '@/components/exchange';
import { cn } from '@/lib/utils';
import { HOW, type Step, type StepLine, type StepResult } from './content';
import { C, H2, LINE, PAGE_SPLIT, SECTION_PAD } from './grid';
import { GithubIssueCard, GithubMarkdown, GithubPullCard } from './mocks/github';
import { SlackCard, SlackDivider, SlackMessage } from './mocks/slack';
import { Story } from './story';
import { speech, Spoken } from './talk';

// Where each part of a step arrives within its stretch of the scroll, as t goes from 0 to 1
// (story.tsx). The meeting comes in by 0.12; a request's words land one by one between WORDS[0] and
// WORDS[1]; Taro's answer and its result land at ANSWER, the caption just after. A step without a
// request shows its result right after its lines. The mapping to motion is in globals.css.
const WORDS = [0.15, 0.57] as const;
const ANSWER = 0.6;
const CAPTION_AFTER_ANSWER = 0.06;
const RESULT_AFTER_LINES = 0.12;
const CAPTION_AFTER_EVENT = 0.05;

function cues(step: Step) {
  const request = step.lines.some((line) => line.kind === 'request');
  return {
    land: request ? ANSWER : RESULT_AFTER_LINES,
    caption: request ? ANSWER + CAPTION_AFTER_ANSWER : step.lines.length ? CAPTION_AFTER_EVENT : 0,
  };
}

/** Each word's point in the step, paced like speech between WORDS[0] and WORDS[1]. */
function wordPoints(said: string) {
  const { words, last } = speech(said, 0);
  return words.map((word) => WORDS[0] + (last ? word.at / last : 0) * (WORDS[1] - WORDS[0]));
}

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

function Speaker({ who, taro = false, className }: { who: string; taro?: boolean; className?: string }) {
  return (
    <span className={cn('speaker col-start-1', taro && 'speaker-taro', className)}>
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
      return (
        <>
          <Speaker who={line.who} />
          <p className="said col-start-2 text-pretty text-said-lg text-ink-2">
            <HeardText text={line.said} />
          </p>
        </>
      );
    case 'request':
      return (
        <>
          <Speaker who={line.who} className="story-asker" />
          <p className="said col-start-2 text-said-lg text-ink">
            <span className="sr-only">{line.said}</span>
            <Spoken text={line.said} cues={wordPoints(line.said)} unit="step" wakeAfter={0.01} />
          </p>
        </>
      );
    case 'taro':
      return (
        <>
          <Speaker who="Taro" taro className="story-answer" />
          <p className="story-answer col-start-2 text-row-answer font-bold text-ink">{line.text}</p>
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

// In the plain list each step is a row: the meeting, then its result beside it from 1100px. Pinned,
// every step sits in the same place on the stage, and the scroll decides which one shows.
function StoryStep({ step, next }: { step: Step; next?: Step }) {
  const { land, caption } = cues(step);
  // The result stays until the next one lands, then crossfades into it
  const vars = { '--land': land, '--cap': caption, '--land-next': next ? cues(next).land : 9 } as React.CSSProperties;
  return (
    <li data-step="" className="story-step border-t border-rule" style={vars}>
      <div className={cn(PAGE_SPLIT, 'items-start gap-y-7 py-12 md:py-14 wide:py-16')}>
        {/* content-start and self-start keep the script from stretching beside a taller result */}
        <div className={cn(TRACK_LG, 'story-meeting content-start gap-y-2.5 self-start')}>
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
              'story-caption col-start-2 max-w-[34em] text-pretty text-[15.5px] leading-[1.55] text-ash',
              step.lines.length ? 'mt-2' : 'md:row-start-1'
            )}
          >
            {step.caption}
          </p>
        </div>
        {step.result && (
          <div className="story-card min-w-0 md:ml-28 md:max-w-[560px] wide:ml-0 wide:max-w-none">
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
      {/* The gap is padding here, not a margin on the list, so the heading is clear of the stage when it pins */}
      <div className={cn(C, 'pb-8 md:pb-12')}>
        <h2 id="how-title" className={cn(LINE, H2)}>
          {HOW.title}
        </h2>
      </div>
      <Story steps={HOW.steps.length}>
        <div className={C}>
          {/* role="list" because Safari stops announcing lists whose markers are removed. Never numbered on screen. */}
          <ol role="list" className="story-steps list-none border-b border-rule">
            {HOW.steps.map((step, i) => (
              <StoryStep key={step.time} step={step} next={HOW.steps[i + 1]} />
            ))}
          </ol>
        </div>
      </Story>
    </section>
  );
}
