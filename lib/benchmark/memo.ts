import { memo, type ComponentType } from "react";

export const MEMO_BENCHMARK_MODE = process.env.NEXT_PUBLIC_FORMA_DISABLE_MEMO === "1" ? "off" : "on";

export function benchmarkMemo<Props extends object>(component: ComponentType<Props>, compare?: (previous: Readonly<Props>, next: Readonly<Props>) => boolean) {
  return MEMO_BENCHMARK_MODE === "off" ? component : memo(component, compare);
}
