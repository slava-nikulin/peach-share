/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Keep workspace interaction state in one place. */
import type { JSX, Setter } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { P2pChannel } from '../../../../bll/ports/p2p-channel';
import {
  createRoomSession,
  type FileDesc,
  type RoomSessionStatus,
  type SessionNotice,
  type TransferState,
} from '../../room/create-room-session';

export function RoomWorkspace(props: { channel: P2pChannel }): JSX.Element {
  const [myFiles, setMyFiles] = createSignal<FileDesc[]>([]);
  const [peerFiles, setPeerFiles] = createSignal<FileDesc[]>([]);
  const [transfers, setTransfers] = createSignal<TransferState[]>([]);
  const [sessionStatus, setSessionStatus] = createSignal<RoomSessionStatus>('connecting');
  const [isReadOnly, setReadOnly] = createSignal(true);
  const [sessionNotice, setSessionNotice] = createSignal<SessionNotice | null>(null);

  const [isAdding, setIsAdding] = createSignal(false);
  const [isDraggingFiles, setIsDraggingFiles] = createSignal(false);
  const [pendingUnshareIds, setPendingUnshareIds] = createSignal<Set<string>>(new Set());
  const [pendingDownloadIds, setPendingDownloadIds] = createSignal<Set<string>>(new Set());
  const [pendingCancelIds, setPendingCancelIds] = createSignal<Set<string>>(new Set());

  let dragCounter = 0;
  let workspaceRef: HTMLDivElement | undefined;
  let session: ReturnType<typeof createRoomSession> | null = null;

  const disposeSession = (): void => {
    if (!session) return;
    session.dispose();
    session = null;
  };

  const hot = (import.meta as ImportMeta & { hot?: { dispose(cb: () => void): void } }).hot;
  hot?.dispose(() => {
    disposeSession();
  });

  const isSessionReady = createMemo(() => sessionStatus() === 'ready' && !isReadOnly());
  const interactionsDisabled = createMemo(() => !isSessionReady());
  const addDisabled = createMemo(() => interactionsDisabled() || isAdding());

  const transferNameById = createMemo(() => {
    const byId = new Map<string, string>();
    for (const file of myFiles()) {
      byId.set(file.id, file.name);
    }
    for (const file of peerFiles()) {
      byId.set(file.id, file.name);
    }
    return byId;
  });

  const activeIncomingTransfersByFileId = createMemo(() => {
    const byFile = new Set<string>();
    for (const transfer of transfers()) {
      if (
        transfer.dir === 'recv' &&
        (transfer.status === 'preparing' || transfer.status === 'active')
      ) {
        byFile.add(transfer.fileId);
      }
    }
    return byFile;
  });

  const activeTransfersById = createMemo(() => {
    const active = new Set<string>();
    for (const transfer of transfers()) {
      if (transfer.status === 'preparing' || transfer.status === 'active') {
        active.add(transfer.transferId);
      }
    }
    return active;
  });

  const statusLabel = createMemo(() => {
    if (sessionStatus() === 'connecting') return 'Connecting';
    if (sessionStatus() === 'ready') return 'Ready';
    if (sessionStatus() === 'error') return 'Error';
    return 'Closed';
  });

  const statusDotClass = createMemo(() => {
    if (sessionStatus() === 'connecting') return 'bg-amber-500';
    if (sessionStatus() === 'ready') return 'bg-emerald-500';
    if (sessionStatus() === 'error') return 'bg-rose-500';
    return 'bg-slate-400';
  });

  const statusHint = createMemo(() => {
    if (sessionStatus() === 'connecting') return 'Connecting…';
    if (sessionStatus() === 'error') return 'Session has an error. Read-only mode is enabled.';
    if (sessionStatus() === 'closed') return 'Session closed. Reopen the room to continue.';
    return '';
  });

  const clearDragState = (): void => {
    dragCounter = 0;
    setIsDraggingFiles(false);
  };

  onMount(() => {
    const maxSessionBuildRetries = 10;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: todo refactor
    const startSession = (attempt: number = 0): void => {
      if (cancelled) return;

      try {
        session = createRoomSession({
          channel: props.channel,
          getMyFiles: myFiles,
          setMyFiles,
          getPeerFiles: peerFiles,
          setPeerFiles,
          getTransfers: transfers,
          setTransfers,
          setSessionStatus,
          setReadOnly,
          setSessionNotice,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isReaderLockError = message.includes('ReadableStream') && message.includes('locked');
        if (isReaderLockError && attempt < maxSessionBuildRetries) {
          retryTimer = setTimeout(() => startSession(attempt + 1), 50);
          return;
        }

        setSessionStatus('error');
        setReadOnly(true);
        setSessionNotice({
          scope: 'session',
          code: 'INTERNAL_ERROR',
          message,
          fatal: true,
        });
      }
    };

    startSession();

    const isWorkspaceTarget = (target: EventTarget | null): target is Node => {
      if (!workspaceRef) return false;
      return target instanceof Node && workspaceRef.contains(target);
    };

    const onWindowDragEnter = (event: DragEvent): void => {
      if (!hasFilePayload(event.dataTransfer)) return;
      if (!isWorkspaceTarget(event.target)) return;

      event.preventDefault();
      dragCounter += 1;
      setIsDraggingFiles(true);
    };

    const onWindowDragOver = (event: DragEvent): void => {
      if (!hasFilePayload(event.dataTransfer)) return;
      if (!isWorkspaceTarget(event.target)) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const onWindowDragLeave = (event: DragEvent): void => {
      if (!hasFilePayload(event.dataTransfer)) return;
      if (!isWorkspaceTarget(event.target)) return;

      event.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) {
        setIsDraggingFiles(false);
      }
    };

    const onWindowDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files;
      const insideWorkspace = isWorkspaceTarget(event.target);
      const hadWorkspaceDrag = isDraggingFiles();

      if (hasFilePayload(event.dataTransfer) && (insideWorkspace || hadWorkspaceDrag)) {
        event.preventDefault();
      }

      if (insideWorkspace) {
        if (files && files.length > 0) {
          void addFiles(files);
        }
      }

      clearDragState();
    };

    const onWindowDragEnd = (): void => clearDragState();
    const onWindowBlur = (): void => clearDragState();

    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('dragend', onWindowDragEnd);
    window.addEventListener('blur', onWindowBlur);

    onCleanup(() => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }

      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('dragend', onWindowDragEnd);
      window.removeEventListener('blur', onWindowBlur);
      disposeSession();
    });
  });

  createEffect(() => {
    const localIds = new Set(myFiles().map((file) => file.id));
    retainPendingIds(setPendingUnshareIds, (id) => localIds.has(id));
  });

  createEffect(() => {
    const activeTransferIds = activeTransfersById();
    retainPendingIds(setPendingCancelIds, (id) => activeTransferIds.has(id));
  });

  const addFiles = async (files: FileList): Promise<void> => {
    const activeSession = session;
    if (!activeSession) return;
    if (files.length === 0 || addDisabled()) return;

    setIsAdding(true);
    try {
      await activeSession.addMyFiles(files);
    } catch {
      // Errors are surfaced through sessionNotice in the adapter.
    } finally {
      setIsAdding(false);
    }
  };

  const onPickFiles: JSX.EventHandler<HTMLInputElement, Event> = async (
    e: Event & { currentTarget: HTMLInputElement; target: Element },
  ): Promise<void> => {
    const input = e.currentTarget;
    if (!input.files || input.files.length === 0) return;
    await addFiles(input.files);
    input.value = '';
  };

  const onUnshare = (fileId: string): void => {
    const activeSession = session;
    if (!activeSession) return;
    if (interactionsDisabled()) return;
    addPendingId(setPendingUnshareIds, fileId);
    const started = activeSession.unshare(fileId);
    if (!started) {
      removePendingId(setPendingUnshareIds, fileId);
    }
  };

  const onDownload = async (fileId: string): Promise<void> => {
    const activeSession = session;
    if (!activeSession) return;
    if (interactionsDisabled()) return;
    if (pendingDownloadIds().has(fileId)) return;
    if (activeIncomingTransfersByFileId().has(fileId)) return;

    addPendingId(setPendingDownloadIds, fileId);
    try {
      await activeSession.requestDownload(fileId);
    } catch {
      // Errors are surfaced through sessionNotice in the adapter.
    } finally {
      removePendingId(setPendingDownloadIds, fileId);
    }
  };

  const onCancelTransfer = (transferId: string): void => {
    const activeSession = session;
    if (!activeSession) return;
    if (interactionsDisabled()) return;
    if (pendingCancelIds().has(transferId)) return;

    addPendingId(setPendingCancelIds, transferId);
    activeSession.cancelTransfer(transferId);
  };

  return (
    <div class="relative space-y-4" ref={workspaceRef}>
      <Show when={isDraggingFiles()}>
        <div class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-sky-100/70 backdrop-blur-[1px]">
          <div class="rounded-xl border border-sky-300 bg-white px-5 py-4 shadow-sm">
            <div class="text-center font-medium text-sky-700 text-sm">Drop files to share</div>
          </div>
        </div>
      </Show>

      <div class="flex items-center justify-between rounded-2xl border border-white/70 bg-white/70 px-4 py-2 shadow-sm">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={`h-2.5 w-2.5 shrink-0 rounded-full border border-white ${statusDotClass()}`}
          />
          <span class="font-medium text-sm">Session: {statusLabel()}</span>
        </div>
        <Show when={statusHint()}>
          <span class="truncate text-slate-500 text-xs">{statusHint()}</span>
        </Show>
      </div>

      <Show when={sessionNotice()}>
        {(notice: () => SessionNotice) => (
          <div
            class={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
              notice().fatal
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
            aria-live="polite"
          >
            <div class="min-w-0 truncate">
              {notice().scope} {notice().code}: {notice().message}
            </div>
            <button
              type="button"
              class="shrink-0 rounded border border-current px-2 py-1 text-xs"
              onClick={() => setSessionNotice(null)}
            >
              Dismiss
            </button>
          </div>
        )}
      </Show>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Dropzone */}
        <div
          class="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm"
          data-testid="room-dropzone"
        >
          <label
            class={`flex h-44 w-full flex-col items-center justify-center rounded-xl border-2 border-gray-300 border-dashed bg-gray-50 md:h-56 ${
              addDisabled()
                ? 'cursor-not-allowed opacity-70'
                : 'hover:cursor-pointer hover:bg-gray-100'
            }`}
          >
            <Show
              when={isAdding()}
              fallback={
                <div class="text-center text-gray-600 text-sm">
                  <span class="font-medium">Click</span> to upload
                  <div class="text-gray-500 text-xs">Or drag files here</div>
                </div>
              }
            >
              <div class="inline-flex items-center gap-2 text-gray-700 text-sm">
                <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
                Adding files...
              </div>
            </Show>
            <input
              type="file"
              class="hidden"
              multiple
              disabled={addDisabled()}
              onChange={(e: Event & { currentTarget: HTMLInputElement; target: Element }): void =>
                void onPickFiles(e)
              }
            />
          </label>
        </div>

        {/* You */}
        <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm md:col-span-2">
          <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-emerald-500" />
              <span class="truncate font-medium text-sm">You</span>
            </div>
            <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
              {myFiles().length}
            </span>
          </div>

          <div class="p-2">
            <div class="max-h-56 space-y-1.5 overflow-y-auto">
              <Show
                when={myFiles().length > 0}
                fallback={
                  <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                    No files
                  </div>
                }
              >
                <For each={myFiles()}>
                  {(f: FileDesc) => (
                    <div class="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
                      <div class="min-w-0">
                        <div class="truncate text-sm">{f.name}</div>
                        <div class="text-slate-500 text-xs">{formatFileSize(f.size)}</div>
                      </div>
                      <button
                        type="button"
                        class="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={interactionsDisabled() || pendingUnshareIds().has(f.id)}
                        onClick={() => onUnshare(f.id)}
                      >
                        {pendingUnshareIds().has(f.id) ? 'Unsharing...' : 'Unshare'}
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* Guest */}
      <div class="flex flex-col rounded-2xl border border-white/70 bg-white/70 shadow-sm">
        <div class="flex items-center justify-between border-gray-200 border-b px-4 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-white bg-sky-500" />
            <span class="truncate font-medium text-sm">Guest</span>
          </div>
          <span class="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800">
            {peerFiles().length}
          </span>
        </div>

        <div class="p-2">
          <div class="max-h-56 space-y-1.5 overflow-y-auto">
            <Show
              when={peerFiles().length > 0}
              fallback={
                <div class="rounded-lg border border-gray-300 border-dashed bg-gray-50 px-3 py-6 text-center text-slate-500 text-sm">
                  No files
                </div>
              }
            >
              <For each={peerFiles()}>
                {(f: FileDesc) => (
                  <div class="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
                    <div class="min-w-0">
                      <div class="truncate text-sm">{f.name}</div>
                      <div class="text-slate-500 text-xs">{formatFileSize(f.size)}</div>
                    </div>
                    <button
                      type="button"
                      class="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={
                        interactionsDisabled() ||
                        pendingDownloadIds().has(f.id) ||
                        activeIncomingTransfersByFileId().has(f.id)
                      }
                      onClick={() => void onDownload(f.id)}
                    >
                      {pendingDownloadIds().has(f.id)
                        ? 'Starting...'
                        : activeIncomingTransfersByFileId().has(f.id)
                          ? 'In progress...'
                          : 'Download'}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>

      <div class="rounded-2xl border border-white/70 bg-white/70 p-3 text-sm">
        <div class="font-medium">Transfers</div>
        <Show
          when={transfers().length > 0}
          fallback={<div class="text-slate-500">No transfers</div>}
        >
          <For each={transfers()}>
            {(t: TransferState) => (
              <div class="flex items-center justify-between gap-2 border-gray-100 border-t py-2">
                <div class="min-w-0">
                  <div class="truncate">
                    <span class="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-[10px] uppercase">
                      {t.dir}
                    </span>{' '}
                    {transferNameById().get(t.fileId) ?? t.fileId} - {t.status}
                  </div>
                  <div class="text-slate-500 text-xs">
                    {formatFileSize(t.bytes)} / {formatFileSize(t.totalBytes)}
                  </div>
                  <Show when={t.error}>
                    <div class="truncate text-red-600 text-xs">{t.error}</div>
                  </Show>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <div class="text-xs tabular-nums">{t.percentage.toFixed(1)}%</div>
                  <Show when={t.status === 'preparing' || t.status === 'active'}>
                    <button
                      type="button"
                      class="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={interactionsDisabled() || pendingCancelIds().has(t.transferId)}
                      onClick={() => onCancelTransfer(t.transferId)}
                    >
                      {pendingCancelIds().has(t.transferId) ? 'Canceling...' : 'Cancel'}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function hasFilePayload(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.files && dataTransfer.files.length > 0) return true;
  if (!dataTransfer.types) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

function addPendingId(setter: Setter<Set<string>>, id: string): void {
  setter((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

function removePendingId(setter: Setter<Set<string>>, id: string): void {
  setter((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}

function retainPendingIds(setter: Setter<Set<string>>, predicate: (id: string) => boolean): void {
  setter((prev) => {
    let changed = false;
    const next = new Set<string>();

    for (const id of prev) {
      if (predicate(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    }

    return changed ? next : prev;
  });
}

function formatFileSize(bytes: number): string {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safe < 1024) return `${safe} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
