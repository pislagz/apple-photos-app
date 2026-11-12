import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LibrarySummary, MeResponse } from "../api";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeysDialog from "./PasskeysDialog";
import type { LayoutOverride } from "./useLayout";

const LAYOUT_CHOICES: { value: LayoutOverride; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "iPhone" },
];

type SubmenuKey = "library" | "layout";

// Items that belong to this menu element itself, not to a nested submenu.
function ownItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (el) => el.closest('[role="menu"]') === menu,
  );
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
  layoutOverride,
  onLayoutOverrideChange,
  onLogout,
  libraries,
  activeLibraryId,
  onActiveLibraryChange,
}: {
  me: MeResponse;
  layoutOverride: LayoutOverride;
  onLayoutOverrideChange: (value: LayoutOverride) => void;
  onLogout: () => void;
  libraries?: LibrarySummary[];
  activeLibraryId?: number;
  onActiveLibraryChange?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubmenuKey | null>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const [changingPassword, setChangingPassword] = useState(false);
  const [managingPasskeys, setManagingPasskeys] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstOf = useRef<HTMLElement | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setSub(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

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
      onMouseEnter={() => setSub(key)}
      onMouseLeave={() => setSub((current) => (current === key ? null : current))}
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
        <div role="menu" aria-label={label} data-submenu={key} className="mac-menu mac-menu--sub" onKeyDown={onMenuKeyDown}>
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
        <span className="account-menu__avatar" aria-hidden="true">
          {me.username.slice(0, 1).toUpperCase()}
        </span>
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
            {submenuParent(
              "layout",
              "Layout",
              LAYOUT_CHOICES.map((choice) => (
                <div key={choice.value} role="none" className="mac-menu__row">
                  {item(choice.label, act(() => onLayoutOverrideChange(choice.value)), {
                    role: "menuitemradio",
                    checked: layoutOverride === choice.value,
                  })}
                </div>
              )),
            )}
            <div role="separator" className="mac-menu__separator" />
            {item("Change Password…", act(() => setChangingPassword(true)))}
            {item("Passkeys…", act(() => setManagingPasskeys(true)))}
            <div role="separator" className="mac-menu__separator" />
            {item("Log Out", act(onLogout))}
          </div>,
          document.body,
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
