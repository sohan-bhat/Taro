import { Mark } from '@/components/brand';
import { cn } from '@/lib/utils';
import { HOW, type Step, type StepLine } from '../content';
import { avatarColor } from '../mocks/slack';
import { speech, Spoken } from '../talk';
import { ALWAYS, at, cue, shot, type ShotId } from './script';
import { step } from './steps';
import { SceneWindow, Swap } from './window';

// The exchanges the captions play, each over its shot's dwell. Each clears as the next one starts.
const EXCHANGES: Array<{ step: Step['id']; shot: ShotId; until: number; cam?: string }> = [
  { step: 'issue', shot: 'ask-issue', until: at('ask-post', 1) },
  { step: 'post', shot: 'ask-post', until: at('ask-pull', 1) },
  { step: 'pull', shot: 'ask-pull', until: at('ask-merge', 1) },
  // The camera comes in close on this one
  { step: 'merge', shot: 'ask-merge', until: at('ended', 2), cam: 'merge' },
];

// The meeting clock moves on as the camera heads back to the call, and stops when it ends
const CLOCK: Array<{ step: Step['id']; from: number }> = [
  { step: 'join', from: ALWAYS },
  { step: 'issue', from: at('ask-issue', -14) },
  { step: 'post', from: at('ask-post', -14) },
  { step: 'pull', from: at('ask-pull', -14) },
  { step: 'merge', from: at('ask-merge', -14) },
  { step: 'recap', from: at('ended', 2) },
];

// Pauses in ms of speech (talk.tsx paces a word every 150ms): between speakers, and before Taro answers
const TURN = 600;
const ANSWER = 700;
// Room at each end of a dwell, in vh of scroll: before the first word, and after Taro's answer
const LEAD = 4;
const HOLD = 12;

type Caption = { kind: 'said'; who: string; said: string; words: number[] } | { kind: 'taro'; text: string; at: number };

/** Lays an exchange out as speech, then stretches it over its shot's dwell, so every word has a point in the scroll. */
function exchange(lines: StepLine[], id: ShotId): Caption[] {
  let ms = 0;
  const timed: Caption[] = [];
  for (const line of lines) {
    if (line.kind === 'event') continue;
    if (line.kind === 'taro') {
      ms += ANSWER;
      timed.push({ kind: 'taro', text: line.text, at: ms });
      continue;
    }
    if (timed.length) ms += TURN;
    const { words, last } = speech(line.said, ms);
    timed.push({ kind: 'said', who: line.who, said: line.said, words: words.map((w) => w.at) });
    ms = last;
  }
  const { dwellFrom, end } = shot(id);
  const unit = (n: number) => dwellFrom + LEAD + (n / ms) * (end - HOLD - dwellFrom - LEAD);
  return timed.map((c) => (c.kind === 'taro' ? { ...c, at: unit(c.at) } : { ...c, words: c.words.map(unit) }));
}

const ROW = 'grid grid-cols-[40px_minmax(0,1fr)] items-baseline gap-x-2.5 md:grid-cols-[60px_minmax(0,1fr)] md:gap-x-4';
const NAME = 'text-right text-[11.5px] font-semibold leading-none md:text-[13.5px]';

function Line({ caption }: { caption: Caption }) {
  if (caption.kind === 'taro')
    // Records land whole
    return (
      <div className={cn(ROW, 'cue cue-rise')} style={cue(caption.at)}>
        <span className={cn(NAME, 'text-white')}>Taro</span>
        <p className="text-[15.5px] font-750 leading-[1.3] tracking-[-0.01em] text-white md:text-[19px]">{caption.text}</p>
      </div>
    );
  // People stream: the name just before the first word, then each word as it's said
  return (
    <div className={cn(ROW, 'cue')} style={cue(caption.words[0] - 0.6, undefined, 1)}>
      <span className={cn(NAME, 'text-taro-200')}>{caption.who}</span>
      <p className="said isolate text-[18px] leading-[1.32] text-poi md:text-[22px]">
        <Spoken text={caption.said} cues={caption.words} unit="step" wakeAfter={0.8} />
      </p>
    </div>
  );
}

// A thin ring around a tile while that person talks. Taro's shows when it answers, as its ding plays.
function Rings({ spans }: { spans: Array<[number, number]> }) {
  return (
    <>
      {spans.map(([from, to]) => (
        <span key={from} className="cue absolute inset-0 rounded-[10px] border-2 border-taro-200" style={cue(from, to, 1.5)} />
      ))}
    </>
  );
}

const TILE = 'relative grid place-items-center rounded-[10px]';
const TILE_NAME = 'absolute bottom-2 left-2.5 text-[11.5px] font-semibold leading-none md:bottom-3 md:left-3.5 md:text-[13px]';
// Each person's tile is tinted with their avatar color, muted on the dark call
const TINT: Record<string, string> = { Priya: 'bg-[#8A5A2B]/25', Dev: 'bg-[#7A3D5A]/25', Sam: 'bg-[#2F6B5E]/25' };

function Avatar({ who, className }: { who: string; className: string }) {
  return (
    <span className={cn('grid place-items-center rounded-full font-bold text-white', avatarColor(who), className)}>{who[0]}</span>
  );
}

export function Meeting() {
  const exchanges = EXCHANGES.map((e) => ({ ...e, captions: exchange(step(e.step).lines, e.shot) }));
  const talking = new Map<string, Array<[number, number]>>();
  for (const c of exchanges.flatMap((e) => e.captions)) {
    const who = c.kind === 'taro' ? 'Taro' : c.who;
    const span: [number, number] = c.kind === 'taro' ? [c.at, c.at + 8] : [c.words[0] - 0.6, c.words[c.words.length - 1] + 1.6];
    talking.set(who, [...(talking.get(who) ?? []), span]);
  }

  return (
    <SceneWindow
      cam="meeting"
      className="col-start-1 row-start-1 row-end-3"
      title={
        <>
          <span className="font-semibold text-ink">{HOW.scene.meeting}</span>
          <Swap
            className="ml-auto text-right"
            items={CLOCK.map((c, i) => ({ text: step(c.step).time, at: c.from, out: CLOCK[i + 1]?.from }))}
          />
        </>
      }
    >
      {/* In a tall window the call sits in the middle, as a phone shows one; on a wide desk it fills it */}
      <div className="flex flex-1 flex-col justify-center bg-ink p-2.5 md:p-3.5 md:landscape:justify-start">
        <div className="grid h-[420px] md:h-[520px] md:landscape:h-auto md:landscape:flex-1">
          <div
            data-cam="tiles"
            className="cue col-start-1 row-start-1 grid grid-cols-2 grid-rows-2 gap-2 md:gap-2.5"
            style={cue(ALWAYS, at('ended', 2), 4)}
          >
            {HOW.scene.people.map((who) => (
              <div key={who} className={cn(TILE, TINT[who] ?? 'bg-white/[0.07]')}>
                <Avatar who={who} className="size-12 text-[19px] md:size-[72px] md:text-[27px]" />
                <span className={cn(TILE_NAME, 'text-corm')}>{who}</span>
                <Rings spans={talking.get(who) ?? []} />
              </div>
            ))}
            {/* Taro's seat stays empty until it joins */}
            <div className={cn(TILE, 'cue cue-pop bg-taro')} style={cue(at('tiles', 5), undefined, 4)}>
              <Mark height={56} tone="poi" className="h-10 w-auto md:h-14" />
              <span className={cn(TILE_NAME, 'text-white')}>Taro</span>
              <Rings spans={talking.get('Taro') ?? []} />
            </div>
          </div>
          {/* The call's own end screen: how long it ran, and who was there */}
          <div
            className="cue cue-rise col-start-1 row-start-1 grid place-content-center justify-items-center"
            style={cue(at('ended', 3), undefined, 4)}
          >
            <p className="text-[22px] font-semibold tracking-[-0.01em] text-poi md:text-[34px]">{HOW.scene.ended}</p>
            <p className="mt-1 text-[14px] text-taro-200 md:mt-2 md:text-[18px]">{HOW.scene.duration}</p>
            <div className="mt-5 flex gap-2 md:mt-7 md:gap-2.5">
              {HOW.scene.people.map((who) => (
                <Avatar key={who} who={who} className="size-9 text-[15px] md:size-12 md:text-[20px]" />
              ))}
              <span className="grid size-9 place-items-center rounded-full bg-taro md:size-12">
                <Mark height={20} tone="poi" className="h-5 w-auto md:h-7" />
              </span>
            </div>
          </div>
        </div>
        {/* Live captions: one exchange at a time, settled at the bottom like a call's own */}
        <div data-cam="captions" className="mt-2.5 grid border-t border-white/10 px-1 pb-1 pt-3 md:mt-3.5 md:px-2 md:pb-1.5 md:pt-4">
          {exchanges.map((e) => (
            <div key={e.step} className="cue col-start-1 row-start-1 self-end" style={cue(ALWAYS, e.until)}>
              <div data-cam={e.cam} className="grid gap-y-1.5 md:gap-y-2.5">
                {e.captions.map((c, i) => (
                  <Line key={i} caption={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SceneWindow>
  );
}
