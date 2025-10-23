import { type Accessor, createSignal, onCleanup } from 'solid-js';

export interface DragOverlayController {
  isDragActive: Accessor<boolean>;
  onInputChange: (event: Event) => void;
  handleRootDragOver: (event: DragEvent) => void;
  handleFileDrop: (event: DragEvent) => void;
  cleanup: () => void;
}

interface DragOverlayState {
  isDragActive: Accessor<boolean>;
  onInputChange: (event: Event) => void;
  handleDragEnter: (event: DragEvent) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
  reset: () => void;
}

interface DragHandlerOptions {
  isFileDrag: (event: DragEvent) => boolean;
  setDragActive: (value: boolean) => void;
  dragDepth: { current: number };
  addFiles: (files: FileList | File[]) => Promise<void>;
}

export function createDragOverlayController(
  addFiles: (files: FileList | File[]) => Promise<void>,
): DragOverlayController {
  const state = createDragOverlayState(addFiles);
  const doc: Document | undefined = typeof document === 'undefined' ? undefined : document;
  const unregisterDocumentListeners = registerDocumentDragListeners(doc, {
    enter: state.handleDragEnter,
    over: state.handleDragOver,
    leave: state.handleDragLeave,
    drop: state.handleDrop,
  });

  const cleanup = (): void => {
    unregisterDocumentListeners();
    state.reset();
  };

  onCleanup(cleanup);

  return {
    isDragActive: state.isDragActive,
    onInputChange: state.onInputChange,
    handleRootDragOver: state.handleDragOver,
    handleFileDrop: state.handleDrop,
    cleanup,
  };
}

function createDragOverlayState(
  addFiles: (files: FileList | File[]) => Promise<void>,
): DragOverlayState {
  const [isDragActive, setDragActive] = createSignal(false);
  const dragDepth = { current: 0 };

  const isFileDrag = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  };

  const onInputChange = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.files) void addFiles(target.files);
    target.value = '';
  };

  const handlers = buildDragHandlers({ isFileDrag, setDragActive, dragDepth, addFiles });

  return {
    isDragActive,
    onInputChange,
    handleDragEnter: handlers.enter,
    handleDragOver: handlers.over,
    handleDragLeave: handlers.leave,
    handleDrop: handlers.drop,
    reset: handlers.reset,
  };
}

function buildDragHandlers(options: DragHandlerOptions): {
  enter: (event: DragEvent) => void;
  over: (event: DragEvent) => void;
  leave: (event: DragEvent) => void;
  drop: (event: DragEvent) => void;
  reset: () => void;
} {
  const withFileDrag = (event: DragEvent, action: (evt: DragEvent) => void): void => {
    if (!options.isFileDrag(event)) return;
    event.preventDefault();
    action(event);
  };

  const adjustDepth = (delta: number): void => {
    options.dragDepth.current = Math.max(options.dragDepth.current + delta, 0);
    options.setDragActive(options.dragDepth.current > 0);
  };

  const enter = (event: DragEvent): void => {
    withFileDrag(event, () => adjustDepth(1));
  };

  const over = (event: DragEvent): void => {
    withFileDrag(event, () => options.setDragActive(true));
  };

  const leave = (event: DragEvent): void => {
    withFileDrag(event, () => adjustDepth(-1));
  };

  const drop = (event: DragEvent): void => {
    withFileDrag(event, (evt) => {
      evt.stopPropagation();
      options.dragDepth.current = 0;
      options.setDragActive(false);
      const files = evt.dataTransfer?.files;
      if (files?.length) void options.addFiles(files);
    });
  };

  const reset = (): void => {
    options.dragDepth.current = 0;
    options.setDragActive(false);
  };

  return { enter, over, leave, drop, reset };
}

function registerDocumentDragListeners(
  doc: Document | undefined,
  handlers: {
    enter: (event: DragEvent) => void;
    over: (event: DragEvent) => void;
    leave: (event: DragEvent) => void;
    drop: (event: DragEvent) => void;
  },
): () => void {
  if (!doc) return () => {};

  const wrap = (callback: (event: DragEvent) => void): EventListener => {
    return (event: Event): void => {
      callback(event as DragEvent);
    };
  };

  const bindings: Array<[string, EventListener]> = [
    ['dragenter', wrap(handlers.enter)],
    ['dragover', wrap(handlers.over)],
    ['dragleave', wrap(handlers.leave)],
    ['drop', wrap(handlers.drop)],
  ];

  for (const [type, listener] of bindings) {
    doc.addEventListener(type, listener);
  }

  return (): void => {
    for (const [type, listener] of bindings) {
      doc.removeEventListener(type, listener);
    }
  };
}
