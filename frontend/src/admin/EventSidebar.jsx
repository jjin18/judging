export default function EventSidebar({ events, activeId, onSelect, onCreate, onLogout }) {
  return (
    <aside className="w-64 shrink-0 bg-white border-r border-ink-300/60 flex flex-col">
      <div className="p-4 border-b border-ink-300/60">
        <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">Organizer</div>
        <div className="font-semibold tracking-tight">Workspace</div>
      </div>
      <button
        onClick={onCreate}
        className="m-3 rounded-lg border border-dashed border-ink-300 text-ink-700 px-3 py-2 text-sm hover:border-accent-500 hover:text-accent-600"
      >
        + New event
      </button>
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {events.length === 0 && <div className="text-xs text-ink-500 px-3 py-2">No events yet.</div>}
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2
              ${e.id === activeId ? 'bg-accent-500/10 text-accent-600 font-medium' : 'text-ink-700 hover:bg-slate-100'}`}
          >
            <span className="text-lg">⚡</span>
            <span className="truncate">{e.name}</span>
          </button>
        ))}
      </nav>
      <button onClick={onLogout} className="m-3 mt-0 text-xs text-ink-500 hover:text-ink-900 px-3 py-2 text-left rounded">
        Sign out
      </button>
    </aside>
  );
}
