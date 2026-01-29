import type { Accessor, Context, JSX, ParentComponent, ParentProps, Setter } from 'solid-js';
import { createContext, createSignal, useContext } from 'solid-js';

interface HeaderActionsCtx {
  navActions: Accessor<JSX.Element | null>;
  setNavActions: Setter<JSX.Element | null>;
}

// явная типизация переменной контекста + undefined как дефолт
const Ctx: Context<HeaderActionsCtx | undefined> = createContext<HeaderActionsCtx | undefined>(
  undefined,
);

// провайдер без any: ParentComponent уже включает корректный тип children
export const NavActionsProvider: ParentComponent = (props: ParentProps): JSX.Element => {
  const [navActions, setNavActions] = createSignal<JSX.Element | null>(null);
  return Ctx.Provider({
    value: { navActions, setNavActions },
    get children(): JSX.Element {
      return props.children;
    },
  });
};

export function useNavActions(): HeaderActionsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('NavActions provider missing');
  }
  return ctx;
}
