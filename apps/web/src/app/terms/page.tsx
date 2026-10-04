import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LINK, REPO_URL, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using Taro.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 4, 2026"
      intro={
        <>
          These terms cover using Taro at trytaro.vercel.app. By signing in, you agree to them and to the{' '}
          <Link href="/privacy" className={LINK}>
            Privacy Policy
          </Link>
          .
        </>
      }
    >
      <Section title="Using Taro">
        <p>Taro is free to use. It is provided as is, without warranties of any kind, and it may change or stop at any time.</p>
      </Section>

      <Section title="Your accounts and costs">
        <p>
          You bring your own keys for the meeting bot, the AI model, and transcription, and you pay those providers directly.
          You are responsible for your accounts with them and with Slack, GitHub, Google, and Microsoft, and for following their
          terms.
        </p>
      </Section>

      <Section title="Meetings and consent">
        <p>
          Only bring Taro into meetings you&apos;re allowed to. Tell the people in the meeting that Taro is listening, and get
          their consent where the law requires it. Taro posts a note in the meeting chat when it joins, but that doesn&apos;t
          replace telling people.
        </p>
      </Section>

      <Section title="What Taro does for you">
        <p>
          Taro acts through its own Slack and GitHub apps, and only within the permissions your workspace allows. It uses AI and
          can get things wrong, so check its work. You are responsible for what you ask it to do.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Don&apos;t use Taro to break the law, record people without permission, harass anyone, send spam, or interfere with
          Taro or anyone else&apos;s workspace.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, the people who run Taro aren&apos;t liable for indirect or consequential damages, lost
          data, or anything the third-party services Taro uses do.
        </p>
      </Section>

      <Section title="Ending">
        <p>
          You can stop at any time by deleting your workspace. We may suspend a workspace that breaks these terms.
        </p>
      </Section>

      <Section title="Changes and questions">
        <p>
          We may update these terms and will change the date above when we do. Using Taro after an update means you accept it.
          Questions? Open an issue on{' '}
          <a href={REPO_URL} className={LINK}>
            GitHub
          </a>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
