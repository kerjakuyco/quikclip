/** One undo stack for a project's edits. A drag keeps replacing the open step until it is closed. */
export type EditStack<T> = {
  past: T[];
  future: T[];
  open: boolean;
};

export const emptyStack = <T>(): EditStack<T> => ({ past: [], future: [], open: false });

const LIMIT = 50;

/** Remember `before` as a step. An open drag does not add another step. */
export function noteEdit<T>(stack: EditStack<T>, before: T, gesture: boolean): EditStack<T> {
  if (gesture && stack.open) return stack;
  return {
    past: [...stack.past, before].slice(-LIMIT),
    future: [],
    open: gesture,
  };
}

export function closeEdit<T>(stack: EditStack<T>): EditStack<T> {
  return stack.open ? { ...stack, open: false } : stack;
}

export function undoEdit<T>(
  stack: EditStack<T>,
  current: T,
): { stack: EditStack<T>; value: T } | null {
  const previous = stack.past.at(-1);
  if (previous === undefined) return null;
  return {
    stack: {
      past: stack.past.slice(0, -1),
      future: [current, ...stack.future],
      open: false,
    },
    value: previous,
  };
}

export function redoEdit<T>(
  stack: EditStack<T>,
  current: T,
): { stack: EditStack<T>; value: T } | null {
  const [next, ...future] = stack.future;
  if (next === undefined) return null;
  return {
    stack: { past: [...stack.past, current], future, open: false },
    value: next,
  };
}
