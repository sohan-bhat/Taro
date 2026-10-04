// Small, faithful pictures of GitHub for the landing page: GitHub's own colors, type, and octicons,
// never tinted purple. The bodies render the markdown Taro writes, footer included.

import * as React from 'react';

// The name GitHub shows on everything Taro files: the GitHub App's slug (github.com/apps/<slug>).
const AUTHOR = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || 'taro';

const FRAME = 'm-0 min-w-0 overflow-hidden rounded-card border border-rule bg-paper shadow-artifact font-github text-gh-fg';

function IssueOpenedIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
    </svg>
  );
}

function PullRequestIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

function OpenState({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gh-open px-3 py-[5px] text-sm font-medium leading-5 text-white">
      {icon}
      Open
    </span>
  );
}

function Author() {
  return (
    <>
      <span className="font-semibold text-gh-fg">{AUTHOR}</span>
      <span className="rounded-full border border-gh-border px-[7px] text-xs font-medium leading-[18px] text-gh-muted">bot</span>
    </>
  );
}

function Branch({ children }: { children: string }) {
  return (
    <span className="rounded-[6px] bg-gh-accent-subtle px-[5px] font-github-mono text-xs leading-5 text-gh-accent wrap-anywhere">
      {children}
    </span>
  );
}

function Frame({
  repo,
  section,
  caption,
  children,
}: {
  repo: string;
  section: 'Issues' | 'Pull requests';
  caption: string;
  children: React.ReactNode;
}) {
  const [owner, name] = repo.split('/');
  return (
    <figure className={FRAME}>
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="flex flex-wrap items-center gap-x-1.5 border-b border-gh-border px-4 py-3 text-sm text-gh-muted md:px-5">
        <span className="font-semibold text-gh-fg">{owner}</span>
        <span>/</span>
        <span className="font-semibold text-gh-fg">{name}</span>
        <span className="ml-1">{`· ${section}`}</span>
      </div>
      <div className="px-4 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5">{children}</div>
    </figure>
  );
}

// Taro's comment: the issue or pull request body
function Comment({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[18px] rounded-[6px] border border-gh-border">
      <div className="flex flex-wrap items-center gap-1.5 rounded-t-[6px] border-b border-gh-border bg-gh-subtle px-4 py-2 text-sm text-gh-muted">
        <Author />
        <span>commented now</span>
      </div>
      <div className="px-4 py-4 text-sm leading-normal">{children}</div>
    </div>
  );
}

export function GithubIssueCard({
  repo,
  number,
  title,
  caption,
  children,
}: {
  repo: string;
  number: number;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <Frame repo={repo} section="Issues" caption={caption}>
      <h3 className="text-[22px] font-normal leading-[1.25] md:text-[26px]">
        {`${title} `}
        <span className="font-light text-gh-muted">{`#${number}`}</span>
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-gh-muted">
        <OpenState icon={<IssueOpenedIcon />} />
        <Author />
        <span>opened this issue now</span>
      </div>
      <Comment>{children}</Comment>
    </Frame>
  );
}

export function GithubPullCard({
  repo,
  number,
  title,
  base,
  head,
  commits,
  caption,
  children,
}: {
  repo: string;
  number: number;
  title: string;
  base: string;
  head: string;
  commits: number;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <Frame repo={repo} section="Pull requests" caption={caption}>
      <h3 className="text-[22px] font-normal leading-[1.25]">
        {`${title} `}
        <span className="font-light text-gh-muted">{`#${number}`}</span>
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm leading-6 text-gh-muted">
        <OpenState icon={<PullRequestIcon />} />
        <Author />
        <span>{`wants to merge ${commits === 1 ? '1 commit' : `${commits} commits`} into`}</span>
        <Branch>{base}</Branch>
        <span>from</span>
        <Branch>{head}</Branch>
      </div>
      <Comment>{children}</Comment>
    </Frame>
  );
}

const HEADING = 'mb-2 border-b border-gh-border pb-[0.3em] text-[1.25em] font-semibold leading-[1.25] text-gh-fg';
const BLOCK_START = /^(## |- |---$)/;

/**
 * The little GitHub markdown Taro writes: ## headings, paragraphs, bullet lists, "- [ ]" task
 * lists (drawn as disabled checkboxes, as GitHub does), a --- rule, and an _italic_ last line.
 * `inline` renders the text inside each block.
 */
export function GithubMarkdown({
  source,
  inline = (text) => text,
}: {
  source: string;
  inline?: (text: string) => React.ReactNode;
}) {
  const lines = source.trim().split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = i;
    if (!line.trim()) {
      i++;
    } else if (line.startsWith('## ')) {
      blocks.push(
        <h4 key={key} className={HEADING}>
          {inline(line.slice(3))}
        </h4>
      );
      i++;
    } else if (line.trim() === '---') {
      blocks.push(<hr key={key} className="my-4 h-1 border-0 bg-gh-border" />);
      i++;
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      if (items.every((item) => item.startsWith('[ ] '))) {
        blocks.push(
          <ul key={key} className="mb-3 list-none pl-0">
            {items.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <input type="checkbox" disabled aria-hidden="true" className="mt-[3px]" />
                {inline(item.slice(4))}
              </li>
            ))}
          </ul>
        );
      } else {
        blocks.push(
          <ul key={key} className="mb-3 list-disc pl-8">
            {items.map((item) => (
              <li key={item}>{inline(item)}</li>
            ))}
          </ul>
        );
      }
    } else {
      // A paragraph runs until a blank line or the next block
      const text: string[] = [];
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) text.push(lines[i++]);
      const paragraph = text.join(' ');
      const italic = /^_(.+)_$/.exec(paragraph);
      blocks.push(
        <p key={key} className="mb-3 last:mb-0">
          {italic ? <em>{inline(italic[1])}</em> : inline(paragraph)}
        </p>
      );
    }
  }
  return <>{blocks}</>;
}
