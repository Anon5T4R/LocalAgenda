import { useMemo, useState } from "react";
import { fmtTime, monthShort, parseLocal, startOfDay } from "../lib/datetime";
import { PRIORITY_COLORS } from "../lib/types";
import type { Task } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

type Bucket = "overdue" | "today" | "soon" | "noDue" | "done";
const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Atrasadas",
  today: "Hoje",
  soon: "Em breve",
  noDue: "Sem prazo",
  done: "Concluídas",
};
const ORDER: Bucket[] = ["overdue", "today", "soon", "noDue", "done"];

function bucketOf(t: Task): Bucket {
  if (t.doneAt) return "done";
  if (!t.due) return "noDue";
  const due = startOfDay(parseLocal(t.due));
  const today = startOfDay(new Date());
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return "soon";
}

export function TasksPanel() {
  const { tasks, saveTask, toggleTask, removeTask } = useStore();
  const openTask = useUi((s) => s.openTask);
  const [quick, setQuick] = useState("");

  const { roots, children } = useMemo(() => {
    const children = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const t of tasks) {
      if (t.parentId) {
        if (!children.has(t.parentId)) children.set(t.parentId, []);
        children.get(t.parentId)!.push(t);
      } else {
        roots.push(t);
      }
    }
    return { roots, children };
  }, [tasks]);

  const grouped = useMemo(() => {
    const g: Record<Bucket, Task[]> = { overdue: [], today: [], soon: [], noDue: [], done: [] };
    for (const t of roots) g[bucketOf(t)].push(t);
    for (const b of ORDER) {
      g[b].sort((a, b2) => {
        const da = a.due ? parseLocal(a.due).getTime() : Infinity;
        const db = b2.due ? parseLocal(b2.due).getTime() : Infinity;
        if (da !== db) return da - db;
        return a.sort - b2.sort;
      });
    }
    return g;
  }, [roots]);

  const add = () => {
    const title = quick.trim();
    if (!title) return;
    void saveTask({ title, due: "" });
    setQuick("");
  };

  return (
    <div className="tasks">
      <div className="tasks-head">
        <span>Tarefas</span>
        <button className="icon-btn" title="Nova tarefa detalhada" onClick={() => openTask({ due: "" })}>
          ＋
        </button>
      </div>
      <div className="tasks-add">
        <input
          placeholder="Adicionar tarefa…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn primary" onClick={add}>
          Add
        </button>
      </div>
      <div className="tasks-list">
        {ORDER.map((b) =>
          grouped[b].length ? (
            <div key={b}>
              <div className="task-group-h">
                {BUCKET_LABEL[b]} · {grouped[b].length}
              </div>
              {grouped[b].map((t) => (
                <div key={t.id}>
                  <TaskRow t={t} onToggle={toggleTask} onOpen={openTask} onDelete={removeTask} />
                  {(children.get(t.id) ?? []).map((c) => (
                    <TaskRow key={c.id} t={c} sub onToggle={toggleTask} onOpen={openTask} onDelete={removeTask} />
                  ))}
                </div>
              ))}
            </div>
          ) : null,
        )}
        {!tasks.length && <div className="empty-hint">Nenhuma tarefa ainda.</div>}
      </div>
    </div>
  );
}

function TaskRow({
  t,
  sub,
  onToggle,
  onOpen,
  onDelete,
}: {
  t: Task;
  sub?: boolean;
  onToggle(id: string): void;
  onOpen(t: Task): void;
  onDelete(id: string): void;
}) {
  const overdue = !t.doneAt && t.due && startOfDay(parseLocal(t.due)) < startOfDay(new Date());
  return (
    <div className={"task" + (t.doneAt ? " done" : "") + (sub ? " sub" : "")}>
      <button className="check" onClick={() => onToggle(t.id)}>
        ✓
      </button>
      <div className="body">
        <div className="ttitle" onClick={() => onOpen(t)}>
          {t.title}
        </div>
        {(t.due || t.priority > 0 || t.rrule) && (
          <div className="meta">
            {t.priority > 0 && <span className="pri" style={{ background: PRIORITY_COLORS[t.priority] }} />}
            {t.due && <span className={"due" + (overdue ? " over" : "")}>{fmtDue(t.due)}</span>}
            {t.rrule && <span>↻</span>}
          </div>
        )}
      </div>
      <button className="del icon-btn" style={{ width: 26, height: 26 }} onClick={() => onDelete(t.id)}>
        🗑
      </button>
    </div>
  );
}

function fmtDue(due: string): string {
  const d = parseLocal(due);
  const base = `${d.getDate()} ${monthShort(d.getMonth())}`;
  return due.includes("T") ? `${base}, ${fmtTime(d)}` : base;
}
