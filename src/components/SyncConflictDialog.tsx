// Diálogo de conflito de sync: o arquivo externo (Android/outro dispositivo)
// mudou com alterações locais pendentes — o autosave segurou a cópia até o
// usuário decidir. Sem botão de fechar de propósito: recarregar ou sobrescrever
// é a ÚNICA saída (deixar em aberto congelaria a sincronização).

import { t } from "../lib/i18n";
import { useStore } from "../state/store";

export function SyncConflictDialog() {
  const reloadFromDisk = useStore((s) => s.reloadFromDisk);
  const forceSave = useStore((s) => s.forceSave);

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h3>{t("sync.title")}</h3>
        </div>
        <div className="modal-body">
          <p style={{ marginTop: 0 }}>{t("sync.body")}</p>
          <div className="sync-choice">
            <div>
              <button className="btn primary" onClick={() => void reloadFromDisk()}>
                {t("sync.reload")}
              </button>
              <div className="hint">{t("sync.reloadHint")}</div>
            </div>
            <div>
              <button className="btn" onClick={() => void forceSave()}>
                {t("sync.overwrite")}
              </button>
              <div className="hint">{t("sync.overwriteHint")}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
