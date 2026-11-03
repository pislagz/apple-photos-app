// Albums (user-created + shared albums, P2.1) and Search (P2.4) have their
// own tab and route now (#125), but no data until Phase 2 -- same
// "frame matches the reference, no data yet" treatment as `LibraryPlaceholder`.
export default function TabPlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">{title}</h1>
      </header>
      <div className="mobile-screen__body">
        <p>{title} lands in a later phase.</p>
      </div>
    </div>
  );
}
