import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge has to know Taro's custom theme keys. Keep these lists in sync with tailwind.config.js.
const FONT_SIZES = [
  'said-hero', 'said-xl', 'said-lg', 'said-md', 'said-req', 'said-body', 'said-sm',
  'answer', 'answer-xl', 'h2', 'h2-aside', 'title', 'h1-app', 'h3', 'row-answer',
  'dialog-title', 'panel-title', 'lede', 'body', 'ui', 'meta',
];

const twMerge = extendTailwindMerge({
  extend: {
    theme: { borderRadius: ['code', 'control', 'menu', 'card', 'dialog'] },
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
      'font-weight': [{ font: ['450', '530', '650', '750'] }],
      shadow: [{ shadow: ['artifact', 'dialog', 'menu'] }],
      'max-w': [{ 'max-w': ['page', 'app', 'setup', 'measure', 'transcript'] }],
      animate: [{ animate: ['fade-in', 'fade-out', 'dialog-in', 'sheet-in', 'toast-in', 'progress'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
