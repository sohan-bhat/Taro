import { Lato, Schibsted_Grotesk, Spline_Sans_Mono, Ysabeau_Office } from 'next/font/google';

// Words a person said aloud. Italic only; leaving out weight loads the variable font.
export const saidFace = Ysabeau_Office({ subsets: ['latin'], style: 'italic', variable: '--font-said', display: 'swap' });

// Taro's voice and the site's voice. Upright only, variable 400 to 900.
export const recordFace = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-record', display: 'swap' });

export const codeFace = Spline_Sans_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-code', display: 'swap', preload: false });

// Only the landing page applies this (Slack mocks).
export const slackFace = Lato({ subsets: ['latin'], weight: ['400', '700', '900'], variable: '--font-slack', display: 'swap', preload: false });
