import { h } from '../core/dom';

export interface ConfirmOptions {
  title: string;
  body: (Node | string | null)[];
  confirmLabel: string;
  confirmDisabled?: boolean;
}

// Modal confirmation built on <dialog>. Resolves true only when the user presses the confirm button.
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const cancel = h('button', { type: 'button', class: 'cp-btn cp-btn-secondary' }, 'Cancel');
    const ok = h('button', { type: 'button', class: 'cp-btn cp-btn-primary', disabled: !!o.confirmDisabled }, o.confirmLabel);
    const dlg = h(
      'dialog',
      { class: 'cp-dialog', 'aria-labelledby': 'cp-dialog-title' },
      h('h2', { id: 'cp-dialog-title', class: 'cp-dialog-title' }, o.title),
      h('div', { class: 'cp-dialog-body' }, o.body),
      h('div', { class: 'cp-dialog-actions' }, cancel, ok),
    );
    (document.getElementById('csesplus-app') ?? document.body).append(dlg);
    const finish = (v: boolean) => {
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    dlg.showModal();
    cancel.focus();
  });
}
