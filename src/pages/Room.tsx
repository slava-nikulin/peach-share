import { useLocation, useNavigate, useParams } from '@solidjs/router';
import {
  type Accessor,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type Setter,
  Show,
} from 'solid-js';
import { useFirebaseCore } from '../components/FirebaseCoreProvider';
import type { RtcEndpoint } from '../lib/webrtc';
import { ErrorState } from './room/components/ErrorState';
import { MetaPanel } from './room/components/MetaPanel';
import { RoomFiles } from './room/components/RoomFiles';
import { RtdbConnector } from './room/lib/RtdbConnector';
import { startRoomFlow } from './room/room-init';
import type { Intent, RoomVM } from './room/types';

type RoomLocationState = { secret?: string; intent?: Intent } | undefined;

export function Room(): JSX.Element {
  const params = useParams<{ id: string }>();
  const location = useLocation<{ secret?: string; intent?: Intent }>();
  const navigate = useNavigate();

  const [error, setError] = createSignal<string | null>(null);
  const [vmRef, setVmRef] = createSignal<RoomVM | undefined>(undefined);
  const [endpoint, setEndpoint] = createSignal<RtcEndpoint | undefined>(undefined);

  const handleDisconnect = (reason: string): void => {
    setEndpoint(undefined);
    if (!error()) {
      const message =
        reason === 'channel_closed' ? 'Connection closed.' : `Connection closed (${reason})`;
      setError(message);
    }
  };

  const goHome = (): void => navigate('/');

  useRoomLifecycle(params.id, location.state ?? undefined, setError, setVmRef, setEndpoint);

  return (
    <RoomLayout
      error={error}
      vmRef={vmRef}
      endpoint={endpoint}
      onDisconnect={handleDisconnect}
      onHome={goHome}
    />
  );
}

function useRoomLifecycle(
  roomId: string,
  state: RoomLocationState,
  setError: Setter<string | null>,
  setVmRef: Setter<RoomVM | undefined>,
  setEndpoint: Setter<RtcEndpoint | undefined>,
): void {
  onMount(() => {
    const { app, auth } = useFirebaseCore();
    const rtdb = new RtdbConnector({
      app,
    });
    const authId = auth.currentUser?.uid;
    if (!authId) {
      setError('Authentication is not ready. Please refresh the page.');
      return;
    }
    const { actor, vm, stop } = startRoomFlow(
      {
        roomId,
        intent: state?.intent ?? 'join',
        secret: state?.secret ?? '',
        rtdb,
        authId,
      },
      setError,
    );

    setVmRef(vm);

    const subscription = actor.subscribe((snapshot) => {
      const ctx = snapshot.context as { rtcEndPoint?: RtcEndpoint } | undefined;
      if (ctx?.rtcEndPoint) {
        setEndpoint(() => ctx.rtcEndPoint);
      }
    });

    onCleanup(() => {
      subscription.unsubscribe();
      stop();
    });
  });
}

interface RoomLayoutProps {
  error: () => string | null;
  vmRef: () => RoomVM | undefined;
  endpoint: () => RtcEndpoint | undefined;
  onDisconnect: (reason: string) => void;
  onHome: () => void;
}

function RoomLayout(props: RoomLayoutProps): JSX.Element {
  const resolvedEndpoint = (): RtcEndpoint | undefined => {
    const vm = props.vmRef();
    const candidate = props.endpoint();
    return vm?.isRtcReady() && candidate ? candidate : undefined;
  };

  return (
    <Show
      when={!props.error()}
      fallback={
        <ErrorState
          title="Не удалось открыть комнату"
          message="Похоже, соединение не установилось. Попробуйте ещё раз или вернитесь на главную."
          details={props.error() ?? ''}
          onHome={props.onHome}
        />
      }
    >
      <div class="space-y-4">
        <MetaPanel vmRef={props.vmRef()} />
        <Show when={resolvedEndpoint()} fallback={<RtcSkeleton />}>
          {(endpoint: Accessor<RtcEndpoint>) => (
            <RoomFiles ep={endpoint()} onDisconnect={props.onDisconnect} />
          )}
        </Show>
      </div>
    </Show>
  );
}

const RtcSkeleton = (): JSX.Element => (
  <div class="animate-pulse space-y-4">
    <div class="h-6 w-1/3 rounded bg-gray-200" />
    <div class="h-4 w-2/3 rounded bg-gray-200" />
    <div class="h-48 rounded bg-gray-200" />
  </div>
);
