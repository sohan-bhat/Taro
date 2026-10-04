import { HOW } from '../content';
import { GithubComment, GithubIssueHead, GithubIssueRow, GithubMarkdown, GithubPullHead } from '../mocks/github';
import { ALWAYS, at, cue } from './script';
import { result } from './steps';
import { SceneWindow } from './window';

const MARK = /\[([^\]]+)\]\{(\w+)\}/;
const PAGE = 'col-start-1 row-start-1 px-4 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5';

// Each page fills in, in its shot's dwell: the title, then the comment with its first section, then
// each later block (null arrives with the comment). Then the issue names, one at a time, who said the
// words Taro took from the call.
const ISSUE = { head: 1, comment: 7, blocks: [null, null, 12, 12, 17, 17], names: 23, nameFor: 9, nameGap: 2 };
const PULL = { head: 1, comment: 6, blocks: [null, null, 10, 10, 13] };
const MARKS = new RegExp(MARK.source, 'g');

/**
 * Renders the issue's marked phrases, dotted as in the list. Each person is named once, on the last
 * phrase Taro took from them, which in this issue begins its block's first line: the label above it
 * covers only a heading's rule, never the words of the line before. Not focusable: the scene is a picture.
 */
function phrases(body: string) {
  const whose = Array.from(body.matchAll(MARKS), (m) => m[2]);
  const named = whose.filter((who, i) => whose.lastIndexOf(who) === i);
  let n = 0;
  return (text: string) => {
    const parts = text.split(MARK);
    return parts.map((part, i) => {
      if (i % 3 === 0) return part;
      if (i % 3 === 2) return null;
      const who = parts[i + 1];
      const turn = whose.lastIndexOf(who) === n++ ? named.indexOf(who) : -1;
      const from = at('issue', ISSUE.names + turn * (ISSUE.nameFor + ISSUE.nameGap));
      return (
        <span key={i} className="prov">
          {part}
          {turn >= 0 && (
            <span className="prov-who cue" style={cue(from, from + ISSUE.nameFor, 2)}>
              {`${who} said this`}
            </span>
          )}
        </span>
      );
    });
  };
}

const arrives = (when: number) => ({ className: 'cue cue-rise', style: cue(when) });

/** Times the nth block of a page's markdown. */
const blocks = (page: { blocks: Array<number | null> }, id: 'issue' | 'pull') => (n: number) => {
  const when = page.blocks[n];
  return when == null ? {} : arrives(at(id, when));
};

/**
 * GitHub, bottom right: the repository's open issues, then the issue Taro opens as it fills in, then
 * the pull request, whose branch the camera ends on.
 */
export function GithubWindow() {
  const issue = result('issue', 'issue');
  const pull = result('pull', 'pull');

  return (
    <SceneWindow
      cam="github"
      className="col-start-2 row-start-2"
      title={
        <>
          <span className="font-semibold text-ink">GitHub</span>
          <span>{issue.repo}</span>
        </>
      }
    >
      <div className="grid flex-1 font-github text-gh-fg">
        <div className="cue col-start-1 row-start-1" style={cue(ALWAYS, at('issue', 0))}>
          <p className="border-b border-gh-border px-4 py-3 text-sm font-semibold">Issues</p>
          {HOW.scene.issues.map((row) => (
            <GithubIssueRow key={row.number} {...row} />
          ))}
        </div>
        <div className={`cue ${PAGE}`} style={cue(ALWAYS, at('pull', 0))}>
          <div {...arrives(at('issue', ISSUE.head))}>
            <GithubIssueHead title={issue.title} number={issue.number} />
          </div>
          <div {...arrives(at('issue', ISSUE.comment))}>
            <GithubComment>
              <GithubMarkdown source={issue.body} inline={phrases(issue.body)} block={blocks(ISSUE, 'issue')} />
            </GithubComment>
          </div>
        </div>
        <div className={PAGE}>
          <div {...arrives(at('pull', PULL.head))}>
            <GithubPullHead
              title={pull.title}
              number={pull.number}
              base={pull.base}
              head={pull.head}
              commits={pull.commits}
              branchCam="branch"
            />
          </div>
          <div {...arrives(at('pull', PULL.comment))}>
            <GithubComment>
              <GithubMarkdown source={pull.body} block={blocks(PULL, 'pull')} />
            </GithubComment>
          </div>
        </div>
      </div>
    </SceneWindow>
  );
}
