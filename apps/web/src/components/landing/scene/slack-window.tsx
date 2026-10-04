import { HOW, type SlackLine } from '../content';
import { SlackDivider, SlackMessage } from '../mocks/slack';
import { ALWAYS, at, cue } from './script';
import { result } from './steps';
import { SceneWindow, Swap } from './window';

// The channel changes while the camera is on its way, so it arrives on the right one
const TO_ENGINEERING = at('posted', -14);
const BACK_TO_PRODUCT = at('recap', -16);

function Message({ line }: { line: SlackLine }) {
  return 'divider' in line ? (
    <SlackDivider>{line.divider}</SlackDivider>
  ) : (
    <SlackMessage who={line.who} time={line.time} text={line.text} taro={line.taro} />
  );
}

// One view of the window. Channels keep their newest message at the bottom, as Slack does.
const VIEW = 'cue col-start-1 row-start-1 flex flex-col py-1.5';

/**
 * Slack, top right: the #product thread where Priya posted the link and Taro replied, #engineering
 * when Taro posts there, and the thread again at its end for the recap. Each view is one layer; the
 * newest message in it arrives as the camera dwells.
 */
export function SlackWindow() {
  const joined = result('join', 'slack');
  const thread = joined.messages;
  // Everything from the "1 reply" divider on is Taro's reply
  const reply = thread.findIndex((line) => 'divider' in line);
  const posted = result('post', 'slack');
  const end = result('recap', 'slack').messages;

  return (
    <SceneWindow
      cam="slack"
      className="col-start-2 row-start-1"
      title={
        <>
          <span className="font-semibold text-ink">Slack</span>
          <Swap
            items={[
              { text: `#${joined.channel}`, at: ALWAYS, out: TO_ENGINEERING },
              { text: `#${posted.channel}`, at: TO_ENGINEERING, out: BACK_TO_PRODUCT },
              { text: `#${joined.channel}`, at: BACK_TO_PRODUCT },
            ]}
          />
        </>
      }
    >
      <div className="grid flex-1 font-slack text-slack-text">
        <div className={VIEW} style={cue(ALWAYS, TO_ENGINEERING)}>
          {thread.slice(0, reply).map((line, i) => (
            <Message key={i} line={line} />
          ))}
          <div className="cue cue-rise" style={cue(at('join', 9), undefined, 4)}>
            {thread.slice(reply).map((line, i) => (
              <Message key={i} line={line} />
            ))}
          </div>
        </div>
        <div className={`${VIEW} justify-end`} style={cue(TO_ENGINEERING, BACK_TO_PRODUCT)}>
          {HOW.scene.engineering.map((line, i) => (
            <Message key={i} line={line} />
          ))}
          <div className="cue cue-rise" style={cue(at('posted', 5), undefined, 4)}>
            {posted.messages.map((line, i) => (
              <Message key={i} line={line} />
            ))}
          </div>
        </div>
        <div className={`${VIEW} justify-end`} style={cue(BACK_TO_PRODUCT)}>
          {end.slice(0, -1).map((line, i) => (
            <Message key={i} line={line} />
          ))}
          <div className="cue cue-rise" style={cue(at('recap', 6), undefined, 4)}>
            <Message line={end[end.length - 1]} />
          </div>
        </div>
      </div>
    </SceneWindow>
  );
}
