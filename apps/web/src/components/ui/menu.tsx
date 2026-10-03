'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface MenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  menuRef: React.MutableRefObject<HTMLDivElement | null>;
  menuId: string;
  // Which item takes focus when the menu opens: Arrow Up on the trigger opens at the last one
  openAt: React.MutableRefObject<'first' | 'last'>;
  close: (returnFocus: boolean) => void;
}

const MenuContext = React.createContext<MenuState | null>(null);

function useMenu(): MenuState {
  const state = React.useContext(MenuContext);
  if (!state) throw new Error('Menu parts must sit inside <Menu>.');
  return state;
}

const items = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

/**
 * A menu button: Arrow Up and Down move between items, Home and End jump, Escape closes and
 * returns focus to the trigger, Tab closes, and a click outside closes.
 *
 *   <Menu>
 *     <MenuTrigger>…</MenuTrigger>
 *     <MenuPopover label="Account" header={<MenuHeader name="Olivia Owens" detail="Owner · Acme" />}>
 *       <MenuItem onSelect={openMembers}>Members</MenuItem>
 *       <MenuLink href="/demo">See the demo</MenuLink>
 *       <MenuSeparator />
 *       <MenuItem onSelect={signOut}>Sign out</MenuItem>
 *     </MenuPopover>
 *   </Menu>
 */
export function Menu({ className, children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const openAt = React.useRef<'first' | 'last'>('first');
  const menuId = React.useId();

  // Focus goes back to the trigger before an item's action runs, so a dialog it opens returns focus there.
  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const state = React.useMemo(() => ({ open, setOpen, triggerRef, menuRef, menuId, openAt, close }), [open, menuId, close]);

  return (
    <MenuContext.Provider value={state}>
      <div ref={rootRef} className={cn('relative', className)}>
        {children}
      </div>
    </MenuContext.Provider>
  );
}

/** At least 44px tall on phones. The caller styles the rest and supplies the visible label. */
export const MenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, onKeyDown, className, ...props }, forwardedRef) => {
    const { open, setOpen, triggerRef, menuRef, menuId, openAt } = useMenu();
    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
          assignRef(forwardedRef, node);
        }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          openAt.current = 'first';
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
          e.preventDefault();
          openAt.current = e.key === 'ArrowUp' ? 'last' : 'first';
          if (!open) return setOpen(true);
          const list = items(menuRef.current);
          (openAt.current === 'last' ? list[list.length - 1] : list[0])?.focus();
        }}
        className={cn('min-h-11 md:min-h-0', className)}
        {...props}
      />
    );
  }
);
MenuTrigger.displayName = 'MenuTrigger';

/** The popover. `header` sits above the items, outside the menu role (the name, then "Owner · Acme"). */
export function MenuPopover({
  label,
  header,
  className,
  children,
}: {
  // The menu's accessible name, for example "Account"
  label: string;
  header?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, menuRef, menuId, openAt, close } = useMenu();

  React.useEffect(() => {
    if (!open) return;
    const list = items(menuRef.current);
    (openAt.current === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open, menuRef, openAt]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items(menuRef.current);
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') focus(at < 0 ? 0 : at + 1);
    else if (e.key === 'ArrowUp') focus(at < 0 ? list.length - 1 : at - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div
      className={cn(
        'absolute right-0 z-50 mt-2 w-64 rounded-menu border border-rule bg-paper p-1.5 shadow-menu motion-safe:animate-fade-in',
        className
      )}
    >
      {header ? (
        <>
          {header}
          <div aria-hidden="true" className="my-1 h-px bg-rule-soft" />
        </>
      ) : null}
      <div ref={menuRef} id={menuId} role="menu" aria-label={label} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}

/** The signed-in person: name, then role and workspace ("Owner · Acme"). */
export function MenuHeader({ name, detail }: { name: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="px-3 pb-2 pt-1.5">
      <p className="truncate text-ui font-semibold text-ink">{name}</p>
      {detail ? <p className="truncate text-meta text-ash">{detail}</p> : null}
    </div>
  );
}

const ITEM =
  'flex min-h-11 w-full items-center rounded-[8px] px-3 py-2 text-left text-ui text-ink-2 hover:bg-poi hover:text-ink ' +
  'focus-visible:bg-poi focus-visible:text-ink focus-visible:outline-none md:min-h-0';

export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  onSelect?: () => void;
}

/** An action. The menu closes and focus returns to the trigger before `onSelect` runs. */
export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(({ onSelect, onClick, className, ...props }, ref) => {
  const { close } = useMenu();
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        close(true);
        onSelect?.();
      }}
      className={cn(ITEM, className)}
      {...props}
    />
  );
});
MenuItem.displayName = 'MenuItem';

/** A destination, like "See the demo". */
export const MenuLink = React.forwardRef<HTMLAnchorElement, React.ComponentPropsWithoutRef<typeof Link>>(
  ({ onClick, className, ...props }, ref) => {
    const { close } = useMenu();
    return (
      <Link
        ref={ref}
        role="menuitem"
        tabIndex={-1}
        onClick={(e) => {
          onClick?.(e);
          close(false);
        }}
        className={cn(ITEM, className)}
        {...props}
      />
    );
  }
);
MenuLink.displayName = 'MenuLink';

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-rule-soft" />;
}
