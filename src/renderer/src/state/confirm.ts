import { create } from 'zustand';

export interface ConfirmButton {
  id: string;
  label: string;
  kind?: 'primary' | 'danger';
}

interface ConfirmRequest {
  title: string;
  message: string;
  buttons: ConfirmButton[];
  resolve: (id: string) => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  ask(title: string, message: string, buttons: ConfirmButton[]): Promise<string>;
  answer(id: string): void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  request: null,
  ask(title, message, buttons) {
    return new Promise((resolve) => set({ request: { title, message, buttons, resolve } }));
  },
  answer(id) {
    const r = get().request;
    set({ request: null });
    r?.resolve(id);
  },
}));
