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
  const [actions, setActions] = createSignal<JSX.Element | null>(null);
  return Ctx.Provider({
    value: { navActions: actions, setNavActions: setActions },
    get children(): JSX.Element {
      return props.children;
    },
  });
};

// явный возвращаемый тип и безопасная ошибка
export function useNavActions(): HeaderActionsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // вариант A: более «низкоэнтропийный» текст
    throw new Error('NavActions provider missing');
    // вариант B: оставить прежний текст и подавить правило:
    // /* biome-ignore lint/nursery/noSecrets -- static diagnostic message */
    // throw new Error('useNavActions outside provider');
  }
  return ctx;
}
