// Class recipes the dashboard files share. Plain strings, so server and client components can both use them.

/** Inline text links inside sentences (5.14). Nothing else in the app looks like this. */
export const LINK = 'rounded-sm text-taro underline decoration-1 underline-offset-[3px] hover:text-taro-hover hover:decoration-2';

/** Setup rows and composer buttons: full width on phones, their own width from 768px. */
export const ROW_BUTTON = 'w-full md:w-auto';

/** Dialog footer buttons: full width on phones, their own width from 640px. */
export const FOOTER_BUTTON = 'w-full sm:w-auto';
