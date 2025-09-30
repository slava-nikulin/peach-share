import { createContext, useContext, createSignal } from "solid-js";
import type { JSX, Setter, Accessor } from "solid-js";

type HeaderActionsCtx = {
  navActions: Accessor<JSX.Element | null>;
  setNavActions: Setter<JSX.Element | null>;
};

const Ctx = createContext<HeaderActionsCtx>();

export function NavActionsProvider(props: { children: any }) {
  const [actions, setActions] = createSignal<JSX.Element | null>(null);
  return Ctx.Provider({ value: { navActions: actions, setNavActions: setActions }, get children() { return props.children; } });
}
export const useNavActions = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNavActions outside provider");
  return ctx;
};
