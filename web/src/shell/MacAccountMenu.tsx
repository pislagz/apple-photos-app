import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { type LibrarySummary, type MeResponse, removeAvatar } from "../api";
import Avatar from "./Avatar";
import AvatarPicker from "./AvatarPicker";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeysDialog from "./PasskeysDialog";

type SubmenuKey = "library";

// Items that belong to this menu element itself, not to a nested submenu.
function ownItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (el) => el.closest('[role="menu"]') === menu,
  );
}

const OPEN_DELAY_MS = 150;
const SWITCH_GRACE_MS = 300;

type Point = { x: number; y: number };

// Is p inside triangle abc? Used as the "safe triangle" from the pointer to the
// near edge of an open submenu, so a diagonal move toward it is not read as
// leaving the parent item.
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const side = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="mac-menu__check" aria-hidden="true">
      {on ? "✓" : ""}
    </span>
  );
}

// Desktop sidebar footer: a real macOS-style menu (issue #292) instead of the
// card popover. It is portalled to <body> because the sidebar clips overflow
// and its backdrop-filter would otherwise trap position: fixed.
export default function MacAccountMenu({
  me,
  onLogout,
  libraries,
  activeLibraryId,
  onActiveLibraryChange,
  onAvatarChanged,
}: {
  me: MeResponse;
  onLogout: () => void;
  libraries?: LibrarySummary[];
  activeLibraryId?: number;
  onActiveLibraryChange?: (id: number) => void;
  onAvatarChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubmenuKey | null>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstOf = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoveredItem = useRef<Element | null>(null);
  const anchor = useRef<Point | null>(null);
  const subRef = useRef<SubmenuKey | null>(null);
  subRef.current = sub;

  const clearHoverTimer = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  const close = useCallback((returnFocus: boolean) => {
    clearHoverTimer();
    hoveredItem.current = null;
    setOpen(false);
    setSub(null);
    if (returnFocus) triggerRef.current?.focus();
  }, [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
  }, [open]);

  useEffect(() => {
    if (open && menuRef.current) ownItems(menuRef.current)[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, close]);

  // Focus the first item of a submenu once it has rendered.
  useEffect(() => {
    if (!sub || !menuRef.current) return;
    const submenu = menuRef.current.querySelector<HTMLElement>(`[data-submenu="${sub}"]`);
    if (submenu && focusFirstOf.current === submenu.parentElement) {
      ownItems(submenu)[0]?.focus();
      focusFirstOf.current = null;
    }
  }, [sub]);

  const openSub = (key: SubmenuKey, focus: boolean, wrap: HTMLElement | null) => {
    setSub(key);
    if (focus) focusFirstOf.current = wrap;
  };

  // Hover intent for root-level items. Entering a submenu parent opens it after
  // a short delay; leaving it toward the open submenu (inside the safe triangle)
  // keeps it open for a grace period instead of switching at once.
  const onRootMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const point = { x: event.clientX, y: event.clientY };
    const el = (event.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
    const own = el && el.closest('[role="menu"]') === root ? el : null;
    if (!own) {
      // Over padding or a separator: not a hover on any item; submenu pointer
      // travel is handled by the submenu's own mouseenter.
      if (!(event.target as HTMLElement).closest('[data-submenu]')) anchor.current = point;
      return;
    }
    if (hoveredItem.current === own) {
      anchor.current = point;
      return;
    }
    const previous = anchor.current;
    hoveredItem.current = own;
    anchor.current = point;
    const key = (own.dataset.opens as SubmenuKey | undefined) ?? null;
    if (key === subRef.current) {
      clearHoverTimer();
      return;
    }
    clearHoverTimer();
    const submenu = subRef.current
      ? root.querySelector<HTMLElement>(`[data-submenu="${subRef.current}"]`)
      : null;
    let delay = key ? OPEN_DELAY_MS : 0;
    if (submenu && previous) {
      const rect = submenu.getBoundingClientRect();
      const towardsSub = inTriangle(
        point,
        previous,
        { x: rect.left, y: rect.top },
        { x: rect.left, y: rect.bottom },
      );
      if (towardsSub) delay = SWITCH_GRACE_MS;
    }
    if (!subRef.current && !key) return;
    hoverTimer.current = window.setTimeout(() => setSub(key), delay);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = event.currentTarget;
    const items = ownItems(menu);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const isSub = menu.hasAttribute("data-submenu");
    const move = (next: number) => {
      event.preventDefault();
      event.stopPropagation();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return move(index + 1);
      case "ArrowUp":
        return move(index < 0 ? items.length - 1 : index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(items.length - 1);
      case "ArrowRight": {
        const key = (document.activeElement as HTMLElement | null)?.dataset.opens as SubmenuKey | undefined;
        if (key && !isSub) {
          event.preventDefault();
          event.stopPropagation();
          openSub(key, true, (document.activeElement as HTMLElement).parentElement);
        }
        return;
      }
      case "ArrowLeft":
        if (isSub) {
          event.preventDefault();
          event.stopPropagation();
          const parent = menu.parentElement?.querySelector<HTMLElement>(":scope > [data-opens]");
          setSub(null);
          parent?.focus();
        }
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (isSub) {
          const parent = menu.parentElement?.querySelector<HTMLElement>(":scope > [data-opens]");
          setSub(null);
          parent?.focus();
        } else {
          close(true);
        }
        return;
      case "Tab":
        close(true);
        return;
    }
  };

  const act = (fn: () => void) => () => {
    close(true);
    fn();
  };

  const submenuParent = (key: SubmenuKey, label: string, children: ReactNode) => (
    <div
      role="none"
      className="mac-menu__sub-wrap"
    >
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="mac-menu__item"
        data-opens={key}
        aria-haspopup="menu"
        aria-expanded={sub === key}
        onClick={(event) => openSub(key, true, event.currentTarget.parentElement)}
      >
        <Check on={false} />
        <span className="mac-menu__label">{label}</span>
        <span className="mac-menu__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {sub === key && (
        <div
          role="menu"
          aria-label={label}
          data-submenu={key}
          className="mac-menu mac-menu--sub"
          onKeyDown={onMenuKeyDown}
          onMouseEnter={() => {
            // The pointer made it into the submenu: cancel any pending switch.
            clearHoverTimer();
            hoveredItem.current = null;
          }}
        >
          {children}
        </div>
      )}
    </div>
  );

  const item = (label: string, onClick: () => void, extra?: { role?: string; checked?: boolean }) => (
    <button
      type="button"
      role={extra?.role ?? "menuitem"}
      aria-checked={extra?.checked}
      tabIndex={-1}
      className="mac-menu__item"
      onClick={onClick}
    >
      <Check on={extra?.checked === true} />
      <span className="mac-menu__label">{label}</span>
    </button>
  );

  const showLibraries = !!libraries && libraries.length > 0 && !!onActiveLibraryChange;

  return (
    <div className="account-menu account-menu--row">
      <button
        ref={triggerRef}
        type="button"
        className="account-menu__row-trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar username={me.username} version={me.avatar_version} />
        <span className="account-menu__row-username">{me.username}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            className="mac-menu mac-menu--root"
            style={{ left: pos.left, bottom: pos.bottom }}
            onKeyDown={onMenuKeyDown}
            onMouseMove={onRootMouseMove}
          >
            {me.role === "admin" && item("Admin…", act(() => window.location.assign("/admin")))}
            {showLibraries &&
              submenuParent(
                "library",
                "Library",
                libraries.map((library) => (
                  <div key={library.id} role="none" className="mac-menu__row">
                    {item(library.display_name, act(() => onActiveLibraryChange(library.id)), {
                      role: "menuitemradio",
                      checked: library.id === activeLibraryId,
                    })}
                  </div>
                )),
              )}
            <div role="separator" className="mac-menu__separator" />
            {me.libraries.length > 0 && item("Choose Avatar…", act(() => setChoosingAvatar(true)))}
            {me.avatar_version != null &&
              item(
                "Remove Avatar",
                act(() => {
                  removeAvatar().then(() => onAvatarChanged?.(), () => {});
                }),
              )}
            {item("Change Password…", act(() => setChangingPassword(true)))}
            {item("Passkeys…", act(() => setManagingPasskeys(true)))}
            <div role="separator" className="mac-menu__separator" />
            {item("Log Out", act(onLogout))}
          </div>,
          document.body,
        )}
      {choosingAvatar && (
        <AvatarPicker
          libraries={me.libraries}
          initialLibraryId={activeLibraryId}
          onClose={() => setChoosingAvatar(false)}
          onSaved={() => onAvatarChanged?.()}
        />
      )}
      {changingPassword && (
        <ChangePasswordDialog
          onClose={() => {
            setChangingPassword(false);
            triggerRef.current?.focus();
          }}
        />
      )}
      {managingPasskeys && (
        <PasskeysDialog
          onClose={() => {
            setManagingPasskeys(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
