import type { Bag } from "./types.ts";

export function initBagger<T extends object>(src: T, end: Bag) {
  return <K extends Extract<keyof T, string>>(
    srcKey: K,
    endKey: string = srcKey,
    transform?: (val: T[K]) => unknown,
  ): void => {
    const val = src[srcKey];
    if (val && (!Array.isArray(val) || val.length)) {
      end[endKey] = transform ? transform(val) : val;
    }
  };
}
