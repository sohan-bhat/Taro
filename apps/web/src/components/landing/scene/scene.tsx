import { GithubWindow } from './github-window';
import { Meeting } from './meeting';
import { SlackWindow } from './slack-window';

/**
 * The #how scene: three app windows laid out like a tidy desk, which story.tsx moves a camera across.
 * The meeting on the left, Slack and GitHub stacked beside it. The desk is wide on landscape screens
 * from 768px; on portrait ones its windows are narrower, so the whole desk fills a tall stage, and on
 * phones each is phone width, so close shots sit near a scale of 1. It is a picture, so it's hidden
 * from screen readers and nothing in it takes focus; the steps' list is its text.
 */
export function Scene() {
  return (
    <div
      data-cam="desk"
      aria-hidden="true"
      className="story-scene grid-cols-[340px_340px] gap-4 md:grid-cols-[440px_440px] md:gap-6 md:landscape:grid-cols-[880px_540px]"
    >
      <Meeting />
      <SlackWindow />
      <GithubWindow />
    </div>
  );
}
