import { HeardText, TRACK_LG } from '@/components/exchange';
import { cn } from '@/lib/utils';
import { TIMELINE, type Artifact, type ScriptLine, type TimelineRow } from './content';
import { C, H2, LINE, PAGE_SPLIT, SECTION_PAD, SUB } from './grid';
import { GithubMarkdown, GithubPullCard } from './mocks/github';
import { SlackCard, SlackDivider, SlackMessage } from './mocks/slack';

// Each line names its column, so every utterance starts a new row of the script grid.
function Line({ line, first }: { line: ScriptLine; first: boolean }) {
  switch (line.kind) {
    case 'event':
      // From 768px an opening event shares the time's row, like a line in a log
      return (
        <p className={cn('col-start-2 text-[17px] leading-[1.4] text-ink md:text-[19px]', first && 'md:row-start-1')}>
          {line.text}
        </p>
      );
    case 'said':
      return (
        <>
          <span className="speaker col-start-1">
            {line.who}
            <span className="sr-only">:</span>
          </span>
          <p className={cn('said col-start-2 text-said-lg', line.context ? 'text-ink-2' : 'text-ink')}>
            <HeardText text={line.text} />
          </p>
        </>
      );
    case 'taro':
      return (
        <>
          <span className="speaker speaker-taro col-start-1">
            Taro
            <span className="sr-only">:</span>
          </span>
          <p className="col-start-2 text-row-answer font-bold text-ink">{line.text}</p>
        </>
      );
    case 'note':
      return <p className="col-start-2 text-[15.5px] leading-[1.55] text-ash">{line.text}</p>;
  }
}

function ArtifactView({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === 'pull') {
    return (
      <GithubPullCard
        repo={artifact.repo}
        number={artifact.number}
        title={artifact.title}
        base={artifact.base}
        head={artifact.head}
        commits={artifact.commits}
        caption={artifact.caption}
      >
        <GithubMarkdown source={artifact.body} />
      </GithubPullCard>
    );
  }
  return (
    <SlackCard channel={artifact.channel} thread={artifact.thread} caption={artifact.caption}>
      {artifact.messages.map((message, i) =>
        'divider' in message ? (
          <SlackDivider key={i}>{message.divider}</SlackDivider>
        ) : (
          <SlackMessage key={i} who={message.who} time={message.time} text={message.text} taro={message.taro} />
        )
      )}
    </SlackCard>
  );
}

function Row({ row }: { row: TimelineRow }) {
  return (
    <li className={cn(PAGE_SPLIT, 'items-start gap-y-5 border-t border-rule py-7 lg:py-9')}>
      {/* content-start and self-start keep the script from stretching beside a taller artifact */}
      <div className={cn(TRACK_LG, 'content-start gap-y-2.5 self-start')}>
        <time
          dateTime={row.dateTime}
          className="col-start-2 text-sm font-semibold text-ash md:col-start-1 md:row-start-1 md:text-right"
        >
          {row.time}
        </time>
        {row.script.map((line, i) => (
          <Line key={i} line={line} first={i === 0} />
        ))}
      </div>
      {row.artifact ? (
        <div className="min-w-0 md:ml-28 md:max-w-[560px] wide:ml-0 wide:max-w-none">
          <ArtifactView artifact={row.artifact} />
        </div>
      ) : (
        <div className="hidden wide:block" />
      )}
    </li>
  );
}

export function Timeline() {
  return (
    <section id="how" aria-labelledby="how-title" className={SECTION_PAD}>
      <div className={C}>
        <div className={LINE}>
          <h2 id="how-title" className={H2}>
            {TIMELINE.title}
          </h2>
          <p className={SUB}>{TIMELINE.sub}</p>
        </div>
        {/* role="list" because Safari stops announcing lists whose markers are removed. Never numbered on screen. */}
        <ol role="list" className="mt-8 list-none border-b border-rule md:mt-12">
          {TIMELINE.rows.map((row) => (
            <Row key={row.time} row={row} />
          ))}
        </ol>
      </div>
    </section>
  );
}
