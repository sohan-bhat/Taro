import type { Metadata } from 'next';
import { LegalPage, LINK, Points, REPO_URL, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Taro collects, why, and what you can do about it.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 4, 2026"
      intro="Taro joins your meetings and does what people ask for in Slack and GitHub. This page explains what it collects and why. It covers Taro at trytaro.vercel.app. If your company runs its own copy of Taro, that company decides how its data is handled."
    >
      <Section title="What Taro collects">
        <Points
          items={[
            ['Your account.', 'Your name, email, and profile picture from Slack or Google when you sign in, and which workspace you belong to.'],
            ['Meetings.', 'The meeting link, the text of what Taro heard, what people asked for, and what Taro did, so your team can look back at it.'],
            ['Keys.', 'The provider keys your workspace adds. They are encrypted and never shown again.'],
            [
              'Your calendar.',
              "If you connect your Google Calendar, Taro reads your upcoming events to find meetings with a video link, and keeps only the ones it joins: each one's title, time, link, and organizer's email. You can disconnect it anytime.",
            ],
            ['Calendar invitations.', "If you invite Taro's address to an event: its time, title, organizer, and meeting link."],
            ['The Google Meet button.', "The browser extension reads only the meeting code from the page's address."],
          ]}
        />
      </Section>

      <Section title="What Taro doesn't keep or do">
        <p>
          Taro doesn&apos;t save meeting audio. It streams through to your transcription provider and is gone. Your meeting bot
          provider may keep its own recording under the settings of your account with them.
        </p>
        <p>Taro doesn&apos;t sell your data, show ads, or use your meetings to train AI models.</p>
        <p>
          Taro only reads your calendar and never changes it. It doesn&apos;t keep your other events, their descriptions, or
          who&apos;s invited. Taro&apos;s use of information it receives from Google APIs follows the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className={LINK}>
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          Taro works through services your workspace chooses and pays for directly: MeetingBaas for the meeting bot, your AI
          provider, and your transcription provider. For a meeting from your calendar, the meeting bot gets its link and
          start time so it can join. Slack and GitHub receive what Taro posts there. Taro itself runs on hosting and database
          services. Each of these handles data under its own privacy policy.
        </p>
      </Section>

      <Section title="How long it's kept">
        <p>
          Meeting history stays until you archive it or delete your workspace. Deleting a workspace removes its keys,
          connections, members, and meetings. Calendar meeting records expire a week after the meeting. Disconnecting your
          calendar revokes Taro&apos;s access at Google right away and deletes the token Taro used to read it.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can make Taro leave any meeting, skip one before it starts, disconnect Slack, GitHub, your calendar, or a browser,
          and delete your workspace in its settings. Let people in your meetings know Taro is listening. It also posts a note
          in the meeting chat when it joins.
        </p>
      </Section>

      <Section title="Changes and questions">
        <p>
          If this policy changes, we&apos;ll update it here and change the date above. Questions? Open an issue on{' '}
          <a href={REPO_URL} className={LINK}>
            GitHub
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
