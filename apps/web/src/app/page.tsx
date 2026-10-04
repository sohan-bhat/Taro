import { slackFace } from './fonts';
import { Closing } from '@/components/landing/closing';
import { NAV } from '@/components/landing/content';
import { Faq } from '@/components/landing/faq';
import { Footer } from '@/components/landing/footer';
import { Hero } from '@/components/landing/hero';
import { Keys } from '@/components/landing/keys';
import { Nav, NavSentinel } from '@/components/landing/nav';
import { Proof } from '@/components/landing/proof';
import { SayList } from '@/components/landing/say-list';
import { Security } from '@/components/landing/security';
import { Timeline } from '@/components/landing/timeline';

// Rendered on the server. The only client code is the nav's scroll rule, the sign-in buttons, and the
// ding. Lato is loaded here and nowhere else, for the Slack mocks.
export default function Home() {
  return (
    <div className={slackFace.variable}>
      <Nav sections={NAV.sections} demo={NAV.demo} />
      <main id="main">
        <NavSentinel />
        <Hero />
        <Proof />
        <Timeline />
        <SayList />
        <Keys />
        <Security />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
