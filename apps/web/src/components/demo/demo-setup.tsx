'use client';

// The demo's Setup view (9.8): the dashboard's own cards and rows, read-only. Keys never leave a
// workspace, so one line stands in for the meeting bot, AI model, and transcription rows.

import * as React from 'react';
import { GITHUB_CAPABILITIES } from '@taro/shared';
import type { DemoSetup } from '@/demo/adapt';
import { Button } from '@/components/ui/button';
import { PermissionsDialog } from '@/components/dashboard/github-dialogs';
import { SetupCard, SetupRow } from '@/components/dashboard/setup';

export function DemoSetupView({ name, setup }: { name: string; setup: DemoSetup }) {
  const [permissionsOpen, setPermissionsOpen] = React.useState(false);
  const { slack, github } = setup;

  return (
    <div className="mx-auto max-w-setup">
      <h1 id="setup-title" tabIndex={-1} className="text-h1-app font-750 text-ink">
        Setup
      </h1>
      <p className="mt-2 max-w-[60ch] text-ui leading-[1.55] text-ink-2">
        Taro runs on your own accounts. Add these once and anyone in {name} can send Taro to a meeting. Keys are checked
        with the provider, encrypted, and never shown again.
      </p>

      <SetupCard id="required-title" title="Required" className="mt-6">
        <SetupRow
          label="Slack"
          state={slack.connected ? `In ${slack.teamName ?? name}` : 'Not set up'}
          stateTone={slack.connected ? 'ink' : 'taro'}
          purpose={
            slack.connected
              ? 'Taro watches public channels for meeting links and replies in the thread.'
              : 'Add Taro to Slack so it can find meeting links and post what it did.'
          }
        />
        {/* Lines up with the rows' text column from 768px. */}
        <li className="px-5 py-[18px] md:grid md:grid-cols-[150px_minmax(0,1fr)] md:gap-x-5 md:px-6">
          <p className="text-sm text-ink-2 md:col-start-2">
            Keys aren&apos;t part of the snapshot. In your workspace, this is where you add MeetingBaas, an AI model, and
            transcription.
          </p>
        </li>
      </SetupCard>

      <SetupCard id="optional-title" title="Optional" className="mt-5">
        {github.connected ? (
          <SetupRow
            label="GitHub"
            state={`Installed on ${github.accountLogin ?? 'GitHub'}`}
            purpose={
              github.repo ? (
                <>
                  Working in <span className="font-mono text-[0.88em] wrap-anywhere">{github.repo}</span>
                </>
              ) : undefined
            }
            meta={`${github.enabledActions.length} of ${GITHUB_CAPABILITIES.length} on`}
            actions={
              <Button variant="link" size="sm" onClick={() => setPermissionsOpen(true)}>
                View permissions
              </Button>
            }
          />
        ) : (
          <SetupRow
            label="GitHub"
            state="Not connected"
            purpose="Lets Taro file issues and open pull requests as its own bot, never as you."
          />
        )}
      </SetupCard>

      <PermissionsDialog
        open={permissionsOpen && github.connected}
        enabled={github.enabledActions}
        readOnly
        onClose={() => setPermissionsOpen(false)}
      />
    </div>
  );
}
