// Serialize navigation and keep the current draft intact if saving/loading fails.
export function createDraftTransition<T>() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(options: {
      saveCurrent: () => Promise<void>;
      loadNext: () => Promise<T>;
      activate: (next: T) => void;
      onBusyChange: (busy: boolean) => void;
    }): Promise<boolean> {
      if (busy) return false;
      busy = true;
      options.onBusyChange(true);
      try {
        await options.saveCurrent();
        const next = await options.loadNext();
        options.activate(next);
        return true;
      } finally {
        busy = false;
        options.onBusyChange(false);
      }
    },
  };
}
