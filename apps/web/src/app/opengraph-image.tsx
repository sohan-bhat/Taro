import { ImageResponse } from 'next/og';

export const alt = 'Hey Taro, file an issue about that. Opened issue #142 in acme/web.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TARO = '#4E3564';

// Google Fonts CSS2 answers a non-browser request with TrueType files, which Satori can read.
async function font(family: string, spec: string, text: string) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:${spec}&text=${encodeURIComponent(text)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error('font');
  return (await fetch(url)).arrayBuffer();
}

export default async function Image() {
  const said = 'Hey Taro, file an issue about that.';
  const record = 'Weekly product sync · Google Meet Opened issue #142 in acme/web. taro A voice assistant for your meetings';
  const fonts = await Promise.all([
    font('Ysabeau+Office', 'ital,wght@1,500', said).then((data) => ({ name: 'Said', data, style: 'italic' as const, weight: 500 as const })),
    font('Schibsted+Grotesk', 'wght@600', record).then((data) => ({ name: 'Record', data, weight: 600 as const })),
    font('Schibsted+Grotesk', 'wght@700', record).then((data) => ({ name: 'Record', data, weight: 700 as const })),
    font('Schibsted+Grotesk', 'wght@800', record).then((data) => ({ name: 'Record', data, weight: 800 as const })),
  ]).catch(() => undefined); // fall back to the default font rather than fail the build
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, background: '#F4F0F6', display: 'flex', flexDirection: 'column', padding: 80, fontFamily: 'Record', position: 'relative' }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: '#6E6779' }}>Weekly product sync · Google Meet</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 44, fontFamily: 'Said', fontStyle: 'italic', fontSize: 92, lineHeight: 1, color: '#1D1724' }}>
          <div style={{ position: 'relative', display: 'flex', marginRight: 22 }}>
            <div style={{ position: 'absolute', left: -7, right: -7, bottom: 6, height: 46, background: '#E2D5ED' }} />
            <span style={{ position: 'relative' }}>Hey Taro,</span>
          </div>
          <span>file an issue about that.</span>
        </div>
        <div style={{ marginTop: 22, fontSize: 50, fontWeight: 700, letterSpacing: '-0.032em', color: '#1D1724' }}>Opened issue #142 in acme/web.</div>
        <div style={{ position: 'absolute', left: 80, bottom: 72, display: 'flex', alignItems: 'center' }}>
          {/* The master mark, 38 by 50 */}
          <svg width={38} height={50} viewBox="0 0 32 42">
            <g fill="none" stroke={TARO} strokeWidth={1.92} strokeLinecap="round">
              <path d="M16 8.94V1" />
              <path d="M16 4.58L11.14 1.26" />
              <path d="M16 4.58L20.86 1.26" />
            </g>
            <path
              fill={TARO}
              fillRule="evenodd"
              d="M16 8.42C21.63 8.81 28.93 16.49 28.93 25.96C28.93 34.66 22.91 41.06 16 41.06C9.09 41.06 3.07 34.66 3.07 25.96C3.07 16.49 10.37 8.81 16 8.42Z M6.98 22.95a1.09 1.09 0 0 1 2.18 0v3.96a1.09 1.09 0 0 1 -2.18 0Z M10.94 21.23a1.09 1.09 0 0 1 2.18 0v7.42a1.09 1.09 0 0 1 -2.18 0Z M14.91 19.95a1.09 1.09 0 0 1 2.18 0v9.98a1.09 1.09 0 0 1 -2.18 0Z M18.88 21.23a1.09 1.09 0 0 1 2.18 0v7.42a1.09 1.09 0 0 1 -2.18 0Z M22.85 22.95a1.09 1.09 0 0 1 2.18 0v3.96a1.09 1.09 0 0 1 -2.18 0Z"
            />
          </svg>
          <span style={{ marginLeft: 14, fontSize: 40, fontWeight: 800, letterSpacing: '-0.035em', color: '#1D1724' }}>taro</span>
          <span style={{ marginLeft: 16, fontSize: 28, fontWeight: 600, color: '#6E6779' }}>A voice assistant for your meetings</span>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
