import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cn } from './utils';
import { buttonVariants } from '../components/ui/button';

const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive', 'danger', 'link', 'inverse', 'inverseOutline'] as const;

test('every Button variant and size keeps its color and its size', () => {
  for (const variant of VARIANTS)
    for (const size of ['sm', 'md', 'lg'] as const) {
      const out = cn(buttonVariants({ variant, size })).split(' ');
      assert.ok(out.some((c) => /^text-(white|ink|ink-2|beet|taro)$/.test(c)), `${variant} ${size} lost its color`);
      assert.ok(out.includes(size === 'sm' ? 'text-sm' : 'text-ui'), `${variant} ${size} lost its size`);
    }
});

test('custom tokens survive merging', () => {
  assert.equal(cn('font-mono font-530'), 'font-mono font-530');
  assert.equal(cn('text-panel-title text-ink-2'), 'text-panel-title text-ink-2');
  assert.equal(cn('rounded-card', 'rounded-dialog'), 'rounded-dialog');
  assert.equal(cn('max-w-measure', 'max-w-[40em]'), 'max-w-[40em]');
});
