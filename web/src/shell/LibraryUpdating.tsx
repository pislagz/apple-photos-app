// Shown instead of the grid while a library's package is missing, still
// copying, or not valid yet (P1.22). Nothing is deleted meanwhile; the
// library comes back as it was once a valid copy lands.
export default function LibraryUpdating({ name, reason }: { name: string; reason?: string | null }) {
  return (
    <div className="library-placeholder" role="status">
      <h2>{name} is being updated</h2>
      <p>This library will be back shortly. Nothing has been removed.</p>
      {reason && <p className="library-placeholder__reason">{reason}</p>}
    </div>
  );
}
