export interface RoomRecord {
  room_id: string;
  owner: string;
  guestId?: string;
  created_at: number | object;
  updated_at: number | object;
  // ниже можно расширять под PAKE и др. полями
  pake_state?: 'init' | 'keys_exchanged' | 'verified';
  pake_data?: unknown;
}
