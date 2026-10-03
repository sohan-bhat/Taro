'use client';

import type { WorkspaceOverview } from '@taro/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { KeySlot } from './keys';

interface Step {
  title: string;
  body: string;
  done: boolean;
  optional?: boolean;
  action?: { label: string; run: () => void };
  // Members may take this step too (adding Taro to Slack claims an unowned workspace)
  openToMembers?: boolean;
}

export function SetupGuide({
  overview,
  canEdit,
  finishing,
  onOpenKey,
  onAddSlack,
  onInstallGithub,
  onFinish,
}: {
  overview: WorkspaceOverview;
  canEdit: boolean;
  finishing: boolean;
  onOpenKey: (slot: KeySlot) => void;
  onAddSlack: () => void;
  onInstallGithub: () => void;
  onFinish: () => void;
}) {
  const { ready, github, workspace } = overview;
  const unclaimed = !workspace.claimed;
  const claimPending = unclaimed && ready.slack;
  const steps: Step[] = [
    {
      title: 'Add Taro to Slack',
      body: claimPending
        ? 'Nobody owns this workspace yet. Add Taro again to become its owner.'
        : unclaimed
          ? 'Whoever adds Taro becomes the owner.'
          : 'So Taro sees meeting links and posts results.',
      done: ready.slack && !unclaimed,
      action: { label: claimPending ? 'Add again' : 'Add to Slack', run: onAddSlack },
      openToMembers: unclaimed,
    },
    {
      title: 'Add a MeetingBaas key',
      body: 'The bot that joins your calls.',
      done: ready.meetingBot,
      action: { label: 'Add key', run: () => onOpenKey('meetingBot') },
    },
    {
      title: 'Choose an AI model',
      body: 'Claude, GPT, Gemini, Groq, OpenRouter, or your own.',
      done: ready.llm,
      action: { label: 'Choose model', run: () => onOpenKey('llm') },
    },
    {
      title: 'Turn on transcription',
      body: 'Whisper on Groq or OpenAI.',
      done: ready.stt,
      action: { label: 'Set up', run: () => onOpenKey('stt') },
    },
    ...(github.configured
      ? [
          {
            title: 'Connect GitHub',
            body: 'Optional. Issues and pull requests, as Taro’s own bot.',
            done: github.connected,
            optional: true,
            action: { label: 'Install', run: onInstallGithub },
          },
        ]
      : []),
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const allDone = doneCount === required.length;

  return (
    <div>
      <p className="text-ink-2">
        {doneCount} of {required.length} done.
      </p>
      <ol className="mt-3 border-y-[1.5px] border-ink">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="grid grid-cols-[1.8em_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-rule py-3 last:border-b-0"
          >
            <span className="text-ash">{i + 1}.</span>
            <span className="min-w-0">
              <span className={cn('block', step.done && 'text-ink-2')}>{step.title}</span>
              {!step.done && <span className="block text-sm text-ash">{step.body}</span>}
            </span>
            <span>
              {step.done ? (
                <span className="sc text-[1rem] text-ash">done</span>
              ) : step.action && (canEdit || step.openToMembers) ? (
                <Button size="sm" variant={step.optional ? 'secondary' : 'primary'} onClick={step.action.run}>
                  {step.action.label}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {canEdit ? (
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onFinish} disabled={!allDone} pending={finishing}>
            {finishing ? 'Finishing' : 'Finish setup'}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ash">
          {unclaimed ? 'Whoever adds Taro to Slack becomes the owner and finishes setup.' : 'An owner or admin finishes setup.'}
        </p>
      )}
    </div>
  );
}
