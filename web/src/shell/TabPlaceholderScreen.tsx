// Albums and Search when there is nothing to show them for yet: no library,
// or the library is being updated (#263).
export default function TabPlaceholderScreen({ title, message }: { title: string; message: string }) {
  return (
    <div className="mobile-screen">
      <header className="mobile-screen__header mobile-screen__header--root">
        <h1 className="mobile-screen__title">{title}</h1>
      </header>
      <div className="mobile-screen__body">
        <p className="empty-state">{message}</p>
      </div>
    </div>
  );
}
